import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { announcementLiveChannel, ANNOUNCEMENT_RECALL_SIGNAL } from '@kuraykaraaslan-labs/common/server/announcement-live.channel';
import type { AnnouncementText } from './entities/announcement.entity';
import AnnouncementMessages from './announcement.messages';

/**
 * The shell's side of announcements: what this person has to see now (a popup to acknowledge, a banner, a toast), and
 * what they did with it. Read from their receipts, so someone who signs in after the send still gets the popup and the
 * banner (plan C), and a popup acknowledged in one workspace is gone in all of them (D17: once per person).
 */

/** A toast is live news: only within this long of the send (whoever is online then, or opens the app right after). */
export const TOAST_WINDOW_MS = 10 * 60 * 1000;

export interface LiveAnnouncement {
  announcementId: string;
  kind: string;
  severity: string;
  content: Record<string, AnnouncementText>;
  defaultLanguage: string;
  linkUrl: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  /** Show the popup: it has one and the person has not acknowledged it. */
  popup: boolean;
  /** Show the banner: it has one and the person has not closed it. */
  banner: boolean;
  /** The banner cannot be closed: a maintenance window in progress (D17: on every page until it ends). */
  bannerRequired: boolean;
  /** Show the toast: it has one, it is fresh, and nothing of it was shown to the person yet. */
  toast: boolean;
}

/** What `userId` has to see in `tenantId`'s shell: platform announcements and this tenant's own. */
export async function liveFor(tenantId: string, userId: string, now = new Date()): Promise<LiveAnnouncement[]> {
  const rows: Array<{
    announcementId: string; kind: string; severity: string; content: Record<string, AnnouncementText>; defaultLanguage: string;
    linkUrl: string | null; channels: string[]; sentAt: Date | null; expiresAt: Date | null; stage: string | null;
    seenAt: Date | null; acknowledgedAt: Date | null; dismissedAt: Date | null;
  }> = await withSystemRLS((qr) => qr.query(
    `SELECT a."announcementId", a."kind", a."severity", a."content", a."defaultLanguage", a."linkUrl", a."channels",
            a."sentAt", a."expiresAt", a."stage", r."seenAt", r."acknowledgedAt", r."dismissedAt"
     FROM "announcement_receipts" r
     JOIN "announcements" a ON a."announcementId" = r."announcementId"
     WHERE r."userId" = $1 AND a."status" IN ('SENDING', 'SENT', 'FAILED')
       AND (a."tenantId" IS NULL OR a."tenantId" = $2)
       AND (a."expiresAt" IS NULL OR a."expiresAt" > $3)
       AND a."channels" ?| array['popup', 'banner', 'toast']
     ORDER BY a."sentAt" DESC NULLS LAST
     LIMIT 20`,
    [userId, tenantId, now],
  ));
  return rows.flatMap((r) => {
    const bannerRequired = r.kind === 'MAINTENANCE' && r.stage === 'start';
    const item: LiveAnnouncement = {
      announcementId: r.announcementId,
      kind: r.kind,
      severity: r.severity,
      content: r.content,
      defaultLanguage: r.defaultLanguage,
      linkUrl: r.linkUrl,
      sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
      expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
      popup: r.channels.includes('popup') && !r.acknowledgedAt,
      banner: r.channels.includes('banner') && (bannerRequired || !r.dismissedAt),
      bannerRequired,
      toast: r.channels.includes('toast') && !r.seenAt && !!r.sentAt && now.getTime() - new Date(r.sentAt).getTime() < TOAST_WINDOW_MS,
    };
    return item.popup || item.banner || item.toast ? [item] : [];
  });
}

/**
 * Records what the person did: `seen` (shown), `acknowledge` (OK on the popup), `dismiss` (the banner closed). A banner
 * that must stay (maintenance in progress) cannot be dismissed. Only their own receipt, and only of what `tenantId`'s
 * shell shows (a platform announcement or this workspace's own, as `liveFor`); anything else is not found.
 */
export async function act(tenantId: string, userId: string, announcementId: string, action: 'seen' | 'acknowledge' | 'dismiss'): Promise<void> {
  const column = action === 'acknowledge' ? '"acknowledgedAt"' : action === 'dismiss' ? '"dismissedAt"' : null;
  const rows: Array<{ kind: string; stage: string | null }> = await withSystemRLS((qr) => qr.query(
    `SELECT a."kind", a."stage" FROM "announcement_receipts" r JOIN "announcements" a ON a."announcementId" = r."announcementId"
     WHERE r."announcementId" = $1 AND r."userId" = $2 AND (a."tenantId" IS NULL OR a."tenantId" = $3)`,
    [announcementId, userId, tenantId],
  ));
  if (!rows.length) throw new AppError(AnnouncementMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  if (action === 'dismiss' && rows[0]!.kind === 'MAINTENANCE' && rows[0]!.stage === 'start') {
    throw new AppError('This banner stays while the maintenance is in progress', 409, ErrorCode.CONFLICT);
  }
  await withSystemRLS((qr) => qr.query(
    `UPDATE "announcement_receipts" SET "seenAt" = COALESCE("seenAt", now())${column ? `, ${column} = COALESCE(${column}, now())` : ''}
     WHERE "announcementId" = $1 AND "userId" = $2`,
    [announcementId, userId],
  ));
}

/**
 * The workspaces whose open shells show `row` to these people (`userIds`; absent = everyone it reached): a workspace
 * announcement only its own; a platform one every workspace each person is an active member of, since `liveFor` shows it
 * in all of them, not only in the one the receipt names.
 */
export async function liveWorkspaces(row: { announcementId: string; tenantId: string | null }, userIds?: string[]): Promise<string[]> {
  if (row.tenantId) return [row.tenantId];
  const rows: Array<{ tenantId: string }> = await withSystemRLS((qr) => (userIds
    ? qr.query(
      `SELECT DISTINCT "tenantId" FROM "tenant_members"
       WHERE "userId" = ANY($1::uuid[]) AND "memberStatus" = 'ACTIVE' AND "deletedAt" IS NULL`,
      [userIds],
    )
    : qr.query(
      `SELECT DISTINCT m."tenantId" FROM "announcement_receipts" r
       JOIN "tenant_members" m ON m."userId" = r."userId" AND m."memberStatus" = 'ACTIVE' AND m."deletedAt" IS NULL
       WHERE r."announcementId" = $1`,
      [row.announcementId],
    )));
  return rows.map((r) => r.tenantId);
}

/**
 * Tells the open shells of these tenants to read their list again; `recall` (a withdrawal) has the bell read its list
 * again too. Best-effort: a missed signal waits for the next load.
 */
export async function publishLive(tenantIds: string[], signal: 'sent' | 'recall' = 'sent'): Promise<void> {
  const message = signal === 'recall' ? ANNOUNCEMENT_RECALL_SIGNAL : '{}';
  for (const tenantId of tenantIds) {
    await redis.publish(announcementLiveChannel(tenantId), message).catch((error: unknown) =>
      Logger.warn(`[announcement] live signal for ${tenantId} failed: ${error}`));
  }
}
