import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AnnouncementService from './announcement.service';
import { auditAnnouncement, authorizeSender } from './announcement.route.helpers';

/**
 * POST /tenant/[tenantId]/api/announcements/[announcementId]/retry — sends a FAILED one again (D23), from where its
 * fan-out stopped: the people already reached are not reached again. The console asks first in the ConfirmDialog.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; announcementId: string }> }) {
  try {
    const { tenantId, announcementId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender, userId } = await authorizeSender(request, tenantId);
    const retried = await AnnouncementService.retry(sender, announcementId);
    auditAnnouncement(tenantId, userId, 'announcement.retried', announcementId, {
      platform: sender.tenantId === null, channels: retried.channels, recipients: retried.stats.recipients ?? 0,
    });
    return NextResponse.json({ success: true, data: retried });
  } catch (e) {
    return normalizeError(e);
  }
}
