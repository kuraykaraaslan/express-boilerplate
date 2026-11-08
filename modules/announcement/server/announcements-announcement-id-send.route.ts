import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AnnouncementService from './announcement.service';
import { SendAnnouncementDTO } from './announcement.dto';
import { auditAnnouncement, authorizeSender } from './announcement.route.helpers';

/**
 * POST /tenant/[tenantId]/api/announcements/[announcementId]/send — send now, or schedule at `sendAt`. The console asks
 * first in the ConfirmDialog with the recipient count and the channels.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; announcementId: string }> }) {
  try {
    const { tenantId, announcementId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender, userId } = await authorizeSender(request, tenantId);
    const body = SendAnnouncementDTO.parse(await request.json().catch(() => ({})));
    const sent = await AnnouncementService.send(sender, announcementId, { sendAt: body.sendAt ?? null });
    auditAnnouncement(tenantId, userId, body.sendAt ? 'announcement.scheduled' : 'announcement.sent', announcementId, {
      platform: sender.tenantId === null, severity: sent.severity, channels: sent.channels, audience: sent.audience, sendAt: sent.sendAt,
    });
    return NextResponse.json({ success: true, data: sent });
  } catch (e) {
    return normalizeError(e);
  }
}
