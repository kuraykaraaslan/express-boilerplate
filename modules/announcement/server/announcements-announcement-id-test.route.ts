import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AnnouncementService from './announcement.service';
import { auditAnnouncement, authorizeSender } from './announcement.route.helpers';

/** POST /tenant/[tenantId]/api/announcements/[announcementId]/test — a test send to the sender alone, marked "[Test]". */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; announcementId: string }> }) {
  try {
    const { tenantId, announcementId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender, userId } = await authorizeSender(request, tenantId);
    const result = await AnnouncementService.testSend(sender, announcementId, { userId, tenantId });
    auditAnnouncement(tenantId, userId, 'announcement.test_sent', announcementId, { delivered: result.delivered });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return normalizeError(e);
  }
}
