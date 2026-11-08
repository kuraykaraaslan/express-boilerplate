import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query';
import AnnouncementService from './announcement.service';
import { CreateAnnouncementDTO, GetAnnouncementsQuery } from './announcement.dto';
import { allowedChannels } from './announcement.rules';
import { auditAnnouncement, authorizeSender } from './announcement.route.helpers';

/**
 * GET /tenant/[tenantId]/api/announcements — the sender's history (phase 43 list contract) with each one's numbers, and
 * the channels this sender may use (`channels`): the platform's in the root tenant, the workspace's elsewhere.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender } = await authorizeSender(request, tenantId);
    const query = readListQuery(request.nextUrl.searchParams, GetAnnouncementsQuery);
    const { data, total } = await AnnouncementService.list(sender, query);
    return NextResponse.json({ success: true, data, total, platform: sender.tenantId === null, channels: allowedChannels(sender) });
  } catch (e) {
    return normalizeError(e);
  }
}

/** POST /tenant/[tenantId]/api/announcements — a draft, a scheduled one, or one sent now (`send`). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { sender, userId } = await authorizeSender(request, tenantId);
    const dto = CreateAnnouncementDTO.parse(await request.json());
    const created = await AnnouncementService.create(sender, dto, userId);
    auditAnnouncement(tenantId, userId, dto.send === 'now' ? 'announcement.sent' : dto.send === 'schedule' ? 'announcement.scheduled' : 'announcement.drafted', created.announcementId, {
      platform: sender.tenantId === null, severity: created.severity, channels: created.channels, audience: created.audience,
      sendAt: created.sendAt, recipients: created.numbers.recipients,
    });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
