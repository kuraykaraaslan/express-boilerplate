import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AnnouncementService from './announcement.service';
import { AudienceCountDTO } from './announcement.dto';
import { audienceFacets } from './announcement.audience';
import { authorizeSender } from './announcement.route.helpers';

/**
 * GET /tenant/[tenantId]/api/announcements/audience — the composer's audience choices: the plan and edition facets
 * other modules answer (platform only; a workspace narrows by role alone).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender } = await authorizeSender(request, tenantId);
    return NextResponse.json({ success: true, data: { facets: sender.tenantId === null ? await audienceFacets() : [] } });
  } catch (e) {
    return normalizeError(e);
  }
}

/** POST /tenant/[tenantId]/api/announcements/audience — how many people an audience reaches (the confirm's number). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender } = await authorizeSender(request, tenantId);
    const { audience } = AudienceCountDTO.parse(await request.json());
    return NextResponse.json({ success: true, data: { recipients: await AnnouncementService.countAudience(sender, audience) } });
  } catch (e) {
    return normalizeError(e);
  }
}
