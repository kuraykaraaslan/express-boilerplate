import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { act } from './announcement.live';
import { ReceiptActionDTO } from './announcement.dto';
import { VIEW_PERM } from './announcement.route.helpers';

/**
 * POST /tenant/[tenantId]/api/announcements/live/[announcementId] — the person saw it, acknowledged the popup, or closed
 * the banner. Their own receipt only, of what this workspace's shell shows.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; announcementId: string }> }) {
  try {
    const { tenantId, announcementId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: VIEW_PERM, scope: 'TENANT' });
    const { action } = ReceiptActionDTO.parse(await request.json());
    await act(tenantId, user.userId, announcementId, action);
    return NextResponse.json({ success: true });
  } catch (e) {
    return normalizeError(e);
  }
}
