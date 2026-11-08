import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuthMagicLinkService from "@kuraykaraaslan-labs/auth/server/auth.magic-link.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { MagicLinkRequestDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { resolveLocale } from "@kuraykaraaslan-labs/auth/server/auth.i18n";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * POST …/api/auth/magic-link — "email me a sign-in link".
 *
 * Always answers `200` with the same message, whatever the address is: an
 * account that exists, one that does not, a suspended one, a non-member, or the
 * feature switched off all look identical from here. A different response is an
 * enumeration oracle — the same reason `forgot-password` says nothing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');
    // Public route governed by ABAC (GUEST floor; permit-by-default, admin policy may deny).
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.session.login', scope: 'GUEST' });

    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const parsed = MagicLinkRequestDTO.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((e) => e.message).join(', ') }, { status: 400 });
    }

    await AuthMagicLinkService.request({
      email: parsed.data.email,
      tenantId,
      ipAddress: clientIpOf(request.headers),
      userAgent: request.headers.get('user-agent') ?? undefined,
      locale: resolveLocale(request.headers.get('accept-language')),
    });

    return NextResponse.json({ message: AuthMessages.MAGIC_LINK_SENT }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
