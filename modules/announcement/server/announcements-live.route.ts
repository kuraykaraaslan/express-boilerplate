import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { liveFor } from './announcement.live';
import { VIEW_PERM } from './announcement.route.helpers';

/**
 * GET /tenant/[tenantId]/api/announcements/live — what the signed-in person has to see in this workspace's shell now:
 * popups to acknowledge, banners, fresh toasts (with every language's text; the shell picks the reader's).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: VIEW_PERM, scope: 'TENANT' });
    return NextResponse.json({ success: true, data: await liveFor(tenantId, user.userId) });
  } catch (e) {
    return normalizeError(e);
  }
}
