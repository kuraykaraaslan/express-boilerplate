// path: app/tenant/[ROOT]/api/limiter/ip-bans/route.ts  (system scope)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import IpStrikeService, { type IpBan } from '@kuraykaraaslan-labs/limiter/server/limiter.ip-strikes';
import { banCovers, banTargetOf } from './limiter.ban-target';
import { IpBanCreateDTO, IpBanLiftQueryDTO } from './limiter.ip-bans.dto';

// The installation's address bans (docs/phases/55-ai-firewall 00 §0.2): manual ban and lift, for the root super-admin behind the KD-13
// admin gate (GLOBAL scope). Bans are installation-wide (Redis + the RLS-exempt `security_ip_bans` table), so the URL tenant is only
// where the dispatcher mounts the route and decides nothing. The page is Platform -> AI firewall (ai_firewall/ui/ai-firewall.page.tsx).
// Every write is audited by the strike store (`security.ip_banned` / `security.ip_unbanned`, the actor's user id).

/** A ban as the page lists it (ai_firewall IpBanView): times as ISO strings. */
function view(ban: IpBan) {
  return {
    bucket: ban.bucket, reason: ban.reason, offense: ban.offense,
    bannedAt: new Date(ban.bannedAt).toISOString(), until: new Date(ban.until).toISOString(), manual: ban.manual,
  };
}

function targetOf(input: string): string {
  const parsed = banTargetOf(input);
  if (parsed.ok) return parsed.target;
  throw new AppError(
    parsed.reason === 'too_broad'
      ? 'This block is too wide for a ban (IPv4 /16, IPv6 /32 at most). Use the global blocklist for a whole network.'
      : 'Enter an IP address or a CIDR block.',
    400,
    ErrorCode.VALIDATION_ERROR,
    { details: { reason: parsed.reason === 'too_broad' ? 'IP_BAN_TOO_BROAD' : 'IP_BAN_INVALID_TARGET' } },
  );
}

/**
 * POST { target, reason, minutes } — ban an address or CIDR block now. 409 when the ban would cover the caller's own address (the
 * ban gate refuses every page and API of a banned address, so the caller could not lift it again from here).
 */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'limiter.ip_bans.manage', scope: 'GLOBAL' });
    const dto = IpBanCreateDTO.parse(await request.json());
    const target = targetOf(dto.target);
    const own = Limiter.getIpFromRequest(request);
    if (banCovers(target, own)) {
      throw new AppError(
        `This ban would cover your own address (${own}) and lock you out. Ban another address or a narrower block.`,
        409,
        ErrorCode.CONFLICT,
        { details: { reason: 'IP_BAN_COVERS_CALLER' } },
      );
    }
    const { ban, persisted } = await IpStrikeService.place(target, dto.reason, {
      manual: true, source: 'manual', seconds: dto.minutes * 60, actorId: user?.userId ?? undefined,
    });
    return NextResponse.json({ success: true, ban: view(ban), persisted, at: new Date().toISOString() }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** DELETE ?target= — lift the ban on an address or CIDR block, and forget its strikes and offense history. 404 when none stands. */
export async function DELETE(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'limiter.ip_bans.manage', scope: 'GLOBAL' });
    const { target: raw } = IpBanLiftQueryDTO.parse({ target: request.nextUrl.searchParams.get('target') ?? '' });
    const target = targetOf(raw);
    const lifted = await IpStrikeService.unban(target, user?.userId ?? undefined);
    if (!lifted) throw new AppError('No ban stands on this address.', 404, ErrorCode.NOT_FOUND, { details: { reason: 'IP_BAN_NOT_FOUND' } });
    return NextResponse.json({ success: true, target, at: new Date().toISOString() });
  } catch (e) {
    return normalizeError(e);
  }
}
