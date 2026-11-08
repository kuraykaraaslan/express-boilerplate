import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AnnouncementService from './announcement.service';
import { auditAnnouncement, authorizeSender } from './announcement.route.helpers';

/**
 * POST /tenant/[tenantId]/api/announcements/[announcementId]/withdraw — it never goes out, or (sent) the popup and the
 * banner stop and the unread bell entries are taken back. Mail already sent stays sent.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; announcementId: string }> }) {
  try {
    const { tenantId, announcementId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender, userId } = await authorizeSender(request, tenantId);
    const withdrawn = await AnnouncementService.withdraw(sender, announcementId);
    auditAnnouncement(tenantId, userId, 'announcement.withdrawn', announcementId, { sentAt: withdrawn.sentAt });
    return NextResponse.json({ success: true, data: withdrawn });
  } catch (e) {
    return normalizeError(e);
  }
}
