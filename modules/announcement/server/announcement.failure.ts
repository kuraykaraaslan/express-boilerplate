import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { createServerT } from '@kuraykaraaslan-labs/i18n/server/messages';
import Logger from '@kuraykaraaslan-labs/logger';
import { dictionaries } from '../dictionaries';
import { textFor } from './announcement.rules';
import type { Announcement } from './entities/announcement.entity';

/**
 * What happens around a fan-out the tick gave up (D23, status FAILED): the audit log records it, and the sender hears it
 * on the bell and by mail, in their language, with the reason and the way out (retry or withdraw on the Maintenance
 * page's Announcements). The sender is the person who made it while they are still an active owner or admin of the
 * sending workspace (the root tenant for a platform announcement); otherwise (a window's notice nobody made by hand, a
 * creator who left) the workspace's owners and admins, and with them a creator who stayed with a lower role (told, though
 * the way out may no longer be theirs). Both are side effects: a failure here is logged and never undoes the FAILED
 * mark.
 */

const t = createServerT(dictionaries);

/** Where the bell entry opens: the Maintenance page with its Announcements drawer. */
export const FAILURE_PATH = '/admin/maintenance?panel=announcements';

const MAX_TOLD = 50;

interface Told {
  userId: string;
  email: string | null;
  language: string | null;
}

/**
 * The people to tell: the creator while still an active owner or admin of the sending workspace (who may retry or
 * withdraw it), else its owners and admins, with a creator still a member at a lower role.
 */
async function sendersOf(row: Pick<Announcement, 'tenantId' | 'createdByUserId'>): Promise<Told[]> {
  const rows: Array<Told & { creator: boolean; admin: boolean }> = await withSystemRLS((qr) => qr.query(
    `SELECT m."userId", u."email", p."language", COALESCE(m."userId" = $2::uuid, false) AS creator,
            m."memberRole" IN ('OWNER', 'ADMIN') AS admin
     FROM "tenant_members" m
     JOIN "users" u ON u."userId" = m."userId" AND u."userStatus" = 'ACTIVE'
     LEFT JOIN "user_preferences" p ON p."userId" = m."userId"
     WHERE m."tenantId" = $1 AND m."memberStatus" = 'ACTIVE' AND m."deletedAt" IS NULL
       AND (m."userId" = $2::uuid OR m."memberRole" IN ('OWNER', 'ADMIN'))
     ORDER BY creator DESC, m."userId"
     LIMIT $3`,
    [row.tenantId ?? ROOT_TENANT_ID, row.createdByUserId, MAX_TOLD],
  ));
  const creator = rows.filter((r) => r.creator && r.admin).slice(0, 1);
  const people = creator.length ? creator : rows.filter((r, i) => rows.findIndex((o) => o.userId === r.userId) === i);
  return people.map((r) => ({
    userId: r.userId,
    email: r.email && !r.email.toLowerCase().endsWith('.invalid') ? r.email : null,
    language: r.language || null,
  }));
}

/** Records the give-up in the audit log and tells the sender. Never throws. */
export async function reportFanoutFailure(
  row: Announcement, failure: { reason: string; at: string; restarts: number }, recipients: number,
): Promise<void> {
  const tenantId = row.tenantId ?? ROOT_TENANT_ID;
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log({
      tenantId, actorId: null, actorType: 'SYSTEM', action: 'announcement.failed', severity: 'high',
      resourceType: 'Announcement', resourceId: row.announcementId,
      metadata: { platform: row.tenantId === null, kind: row.kind, stage: row.stage, reason: failure.reason, restarts: failure.restarts, recipients },
    });
  } catch (error) {
    Logger.warn(`[announcement] audit of the failed fan-out ${row.announcementId} not written: ${error}`);
  }

  try {
    const people = await sendersOf(row);
    if (people.length === 0) return;
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    const byLanguage = new Map<string, Told[]>();
    for (const p of people) {
      const lang = p.language && dictionaries[p.language.split('-')[0]!] ? p.language.split('-')[0]! : 'en';
      byLanguage.set(lang, [...(byLanguage.get(lang) ?? []), p]);
    }
    for (const [lang, group] of byLanguage) {
      const announcement = textFor(row.content, row.defaultLanguage, lang).title;
      const title = t('announcement.failure.title', lang, undefined, { title: announcement });
      const body = t('announcement.failure.body', lang, undefined, { reason: failure.reason, count: recipients });
      await NotificationService.notify(tenantId, group.map((p) => ({ userId: p.userId, ...(p.email ? { email: p.email } : {}) })), {
        event: 'announcement.failed', title, body,
        data: { announcementId: row.announcementId, path: FAILURE_PATH, subject: title },
      }, { channels: ['inapp', 'mail'], purpose: 'TRANSACTIONAL', idempotencyKey: `announcement-failed:${row.announcementId}:${failure.at}` });
    }
  } catch (error) {
    Logger.warn(`[announcement] the sender of the failed fan-out ${row.announcementId} could not be told: ${error}`);
  }
}
