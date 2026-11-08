import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AnnouncementService from './announcement.service';
import { UpdateAnnouncementDTO } from './announcement.dto';
import { auditAnnouncement, authorizeSender } from './announcement.route.helpers';

type Params = { params: Promise<{ tenantId: string; announcementId: string }> };

/** GET /tenant/[tenantId]/api/announcements/[announcementId] — one of the sender's own, with its numbers. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, announcementId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender } = await authorizeSender(request, tenantId);
    return NextResponse.json({ success: true, data: await AnnouncementService.get(sender, announcementId) });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PATCH /tenant/[tenantId]/api/announcements/[announcementId] — change a draft or a scheduled one (a maintenance notice before it goes out). */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, announcementId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender, userId } = await authorizeSender(request, tenantId);
    const updated = await AnnouncementService.update(sender, announcementId, UpdateAnnouncementDTO.parse(await request.json()));
    auditAnnouncement(tenantId, userId, 'announcement.updated', announcementId, { channels: updated.channels, sendAt: updated.sendAt });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return normalizeError(e);
  }
}
