import 'reflect-metadata';
import { In, IsNull, type QueryRunner, type Repository, type SelectQueryBuilder } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import Logger from '@kuraykaraaslan-labs/logger';
import { Announcement, type AnnouncementAudience, type AnnouncementStats } from './entities/announcement.entity';
import { AnnouncementReceipt } from './entities/announcement_receipt.entity';
import {
  AnnouncementViewSchema, ANNOUNCEMENT_SORTABLE,
  type AnnouncementView, type CreateAnnouncementDTO, type GetAnnouncementsQuery, type UpdateAnnouncementDTO,
} from './announcement.dto';
import {
  assertChannels, assertTimes, fanoutFailureReason, isCriticalPopup, liveChannels, textFor,
  CRITICAL_POPUP_INTERVAL_MS, FANOUT_MAX_RESTARTS, MAIL_DAILY_CAP, type Sender,
} from './announcement.rules';
import { audienceBatch, audienceTenants, countAudience, type AudienceMember } from './announcement.audience';
import { deliverBatch } from './announcement.delivery';
import { liveWorkspaces, publishLive } from './announcement.live';
import { MaintenanceStageEnum, type AnnouncementKind } from './announcement.enums';
import AnnouncementMessages from './announcement.messages';

/**
 * Announcements (docs/phases/47-announcements): one message from the platform operator to every user, or from a tenant
 * admin to their workspace, on the channels it names. Life cycle: draft → scheduled → sending → sent → expired, or
 * withdrawn; a fan-out that keeps failing ends failed (D23), from where the sender retries or withdraws it. Sending is a fan-out job (announcement.job) in batches of people; this file holds the model, the guards and
 * the job's body.
 *
 * Every read and write is on the SYSTEM connection (a platform row has no tenant) and filters on the sender itself: a
 * tenant sees and changes only its own rows, the platform only the rows without a tenant.
 */

const OPEN = ['DRAFT', 'SCHEDULED'];
const DAY_MS = 24 * 60 * 60 * 1000;

function announcements<T>(fn: (repo: Repository<Announcement>) => Promise<T>): Promise<T> {
  return withSystemRLS((qr) => fn(qr.manager.getRepository(Announcement)));
}

function receipts<T>(fn: (repo: Repository<AnnouncementReceipt>) => Promise<T>): Promise<T> {
  return withSystemRLS((qr) => fn(qr.manager.getRepository(AnnouncementReceipt)));
}

const senderWhere = (sender: Sender) => ({ tenantId: sender.tenantId ?? IsNull() });

/** What the critical-popup guard reads of a row; `announcementId` is null for one not stored yet. */
type GuardedRow = Pick<Announcement, 'tenantId' | 'severity' | 'channels'> & { announcementId: string | null };

/** A tenant's audience is its own workspace, by role only (D15); facets are the platform's. */
export function scopeAudience(sender: Sender, audience: AnnouncementAudience): AnnouncementAudience {
  if (sender.tenantId === null) return audience;
  return { tenantIds: [sender.tenantId], roles: audience.roles, plans: [], editions: [] };
}

/** The numbers of the people side: reached, seen, acknowledged, banner closed. */
export interface ReceiptNumbers {
  recipients: number;
  seen: number;
  acknowledged: number;
  dismissed: number;
}

export type AnnouncementWithNumbers = AnnouncementView & { numbers: ReceiptNumbers };

export default class AnnouncementService {

  // ── Reads ──────────────────────────────────────────────────────────────────

  static async get(sender: Sender, announcementId: string): Promise<AnnouncementWithNumbers> {
    const row = await this.ownRow(sender, announcementId);
    const numbers = (await this.numbersOf([row.announcementId])).get(row.announcementId) ?? emptyNumbers();
    return { ...AnnouncementViewSchema.parse(row), numbers };
  }

  /** The history of a sender (phase 43 list contract), with the numbers of each row. */
  static async list(sender: Sender, query: GetAnnouncementsQuery): Promise<{ data: AnnouncementWithNumbers[]; total: number }> {
    const [rows, total] = await announcements((repo) => {
      const qb: SelectQueryBuilder<Announcement> = repo.createQueryBuilder('a');
      if (sender.tenantId === null) qb.where('a.tenantId IS NULL');
      else qb.where('a.tenantId = :tenantId', { tenantId: sender.tenantId });
      if (query.status?.length) qb.andWhere('a.status IN (:...status)', { status: query.status });
      if (query.kind?.length) qb.andWhere('a.kind IN (:...kind)', { kind: query.kind });
      if (query.severity?.length) qb.andWhere('a.severity IN (:...severity)', { severity: query.severity });
      if (query.createdFrom) qb.andWhere('a.createdAt >= :from', { from: new Date(`${query.createdFrom}T00:00:00.000Z`) });
      if (query.createdTo) qb.andWhere('a.createdAt < :to', { to: new Date(Date.parse(`${query.createdTo}T00:00:00.000Z`) + DAY_MS) });
      // the text of every language: a title or a body in any of them finds the row
      if (query.search) qb.andWhere('a.content::text ILIKE :q', { q: `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` });
      for (const s of query.sort ?? []) {
        const column = ANNOUNCEMENT_SORTABLE[s.field as keyof typeof ANNOUNCEMENT_SORTABLE];
        if (column) qb.addOrderBy(`a.${column}`, s.dir === 'desc' ? 'DESC' : 'ASC', 'NULLS LAST');
      }
      return qb.addOrderBy('a.announcementId', 'ASC').skip(query.page * query.pageSize).take(query.pageSize).getManyAndCount();
    });
    const numbers = await this.numbersOf(rows.map((r) => r.announcementId));
    return {
      data: rows.map((r) => ({ ...AnnouncementViewSchema.parse(r), numbers: numbers.get(r.announcementId) ?? emptyNumbers() })),
      total,
    };
  }

  private static async numbersOf(ids: string[]): Promise<Map<string, ReceiptNumbers>> {
    const out = new Map<string, ReceiptNumbers>();
    if (ids.length === 0) return out;
    const rows: Array<{ announcementId: string; recipients: string; seen: string; acknowledged: string; dismissed: string }> =
      await withSystemRLS((qr) => qr.query(
        `SELECT "announcementId", count(*)::text AS recipients, count("seenAt")::text AS seen,
                count("acknowledgedAt")::text AS acknowledged, count("dismissedAt")::text AS dismissed
         FROM "announcement_receipts" WHERE "announcementId" = ANY($1::uuid[]) GROUP BY "announcementId"`,
        [ids],
      ));
    for (const r of rows) {
      out.set(r.announcementId, {
        recipients: Number(r.recipients), seen: Number(r.seen), acknowledged: Number(r.acknowledged), dismissed: Number(r.dismissed),
      });
    }
    return out;
  }

  /** How many people `audience` reaches for this sender (the confirm's "send to 12 430 people"). */
  static async countAudience(sender: Sender, audience: AnnouncementAudience): Promise<number> {
    const scoped = scopeAudience(sender, audience);
    return countAudience(await audienceTenants(sender, scoped), scoped.roles);
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  static async create(sender: Sender, dto: CreateAnnouncementDTO, actorId: string | null): Promise<AnnouncementWithNumbers> {
    assertChannels(sender, dto.channels);
    assertTimes(dto.send === 'schedule' ? dto.sendAt : null, dto.expiresAt);
    const fields = {
      tenantId: sender.tenantId,
      kind: 'GENERAL' as const,
      status: dto.send === 'schedule' ? 'SCHEDULED' as const : 'DRAFT' as const,
      severity: dto.severity,
      content: dto.content,
      defaultLanguage: dto.defaultLanguage,
      linkUrl: dto.linkUrl ?? null,
      audience: scopeAudience(sender, dto.audience),
      channels: dto.channels,
      sendAt: dto.send === 'schedule' ? dto.sendAt ?? null : null,
      expiresAt: dto.expiresAt ?? null,
      stats: {},
      createdByUserId: actorId,
    };
    // The guard and the write in one transaction: a refused schedule is never stored, so it never goes out either.
    const saved = await withSystemRLS(async (qr) => {
      if (fields.status === 'SCHEDULED') await this.assertRateGuards(qr, { ...fields, announcementId: null }, fields.sendAt!);
      const repo = qr.manager.getRepository(Announcement);
      return repo.save(repo.create(fields));
    });
    if (dto.send === 'now') return this.send(sender, saved.announcementId, {});
    return this.get(sender, saved.announcementId);
  }

  /** Changes a draft or a scheduled one. A notice its window made is marked `edited`: the window no longer rewrites it. */
  static async update(sender: Sender, announcementId: string, dto: UpdateAnnouncementDTO): Promise<AnnouncementWithNumbers> {
    const row = await this.ownRow(sender, announcementId);
    if (!OPEN.includes(row.status)) throw new AppError(AnnouncementMessages.NOT_EDITABLE, 409, ErrorCode.CONFLICT);
    if (dto.channels) assertChannels(sender, dto.channels, row.channels);
    const patch: Partial<Announcement> = {};
    if (dto.severity !== undefined) patch.severity = dto.severity;
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.defaultLanguage !== undefined) patch.defaultLanguage = dto.defaultLanguage;
    if (dto.linkUrl !== undefined) patch.linkUrl = dto.linkUrl;
    if (dto.audience !== undefined && !row.windowId) patch.audience = scopeAudience(sender, dto.audience);
    if (dto.channels !== undefined) patch.channels = dto.channels;
    if (dto.sendAt !== undefined && !row.windowId) {
      patch.sendAt = dto.sendAt;
      // No send time any more: back to a draft (the console's "Keep as a draft" on a scheduled one).
      if (!dto.sendAt) patch.status = 'DRAFT';
    } else if (dto.sendAt && row.stage === 'scheduled') {
      // Only a window's "scheduled" notice has a time of its own; the others go out with the window's events.
      patch.sendAt = dto.sendAt;
    }
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt;
    const content = patch.content ?? row.content;
    const lang = patch.defaultLanguage ?? row.defaultLanguage;
    if (!content[lang]?.title) throw new AppError(AnnouncementMessages.CONTENT_MISSING_DEFAULT, 400, ErrorCode.VALIDATION_ERROR);
    if (patch.sendAt !== undefined || patch.expiresAt !== undefined) {
      assertTimes(patch.sendAt === undefined ? null : patch.sendAt, patch.expiresAt ?? row.expiresAt, new Date());
    }
    if (row.windowId) patch.edited = true;
    const next = { ...row, ...patch };
    // The guard before the write, in its transaction: a refused change is not stored. Conditional on the row still being
    // open: a send landing in between wins.
    await withSystemRLS(async (qr) => {
      if (next.status === 'SCHEDULED' && next.sendAt) await this.assertRateGuards(qr, next, next.sendAt);
      const res = await qr.manager.getRepository(Announcement).update({ announcementId, status: In(OPEN) }, patch as never);
      if (!res.affected) throw new AppError(AnnouncementMessages.NOT_EDITABLE, 409, ErrorCode.CONFLICT);
    });
    return this.get(sender, announcementId);
  }

  /**
   * Sends now (`sendAt` absent) or schedules. Refused for a sent or withdrawn one, a channel the sender may not use, a
   * second critical popup within the hour, or by mail beyond the day's cap of its kind.
   */
  static async send(sender: Sender, announcementId: string, opts: { sendAt?: Date | null }): Promise<AnnouncementWithNumbers> {
    const row = await this.ownRow(sender, announcementId);
    if (!OPEN.includes(row.status)) throw new AppError(AnnouncementMessages.NOT_SENDABLE, 409, ErrorCode.CONFLICT);
    // A window's reminder, start and end notices go out with its events: sent early, "it is over" would come before it began.
    if (row.windowId && row.stage !== 'scheduled') throw new AppError(AnnouncementMessages.FOLLOWS_WINDOW, 409, ErrorCode.CONFLICT);
    if (!row.content[row.defaultLanguage]?.title) throw new AppError(AnnouncementMessages.CONTENT_MISSING_DEFAULT, 400, ErrorCode.VALIDATION_ERROR);
    if (opts.sendAt) {
      const sendAt = opts.sendAt;
      assertTimes(sendAt, row.expiresAt);
      await withSystemRLS(async (qr) => {
        await this.assertRateGuards(qr, row, sendAt);
        const res = await qr.manager.getRepository(Announcement).update({ announcementId, status: In(OPEN) }, { status: 'SCHEDULED', sendAt } as never);
        if (!res.affected) throw new AppError(AnnouncementMessages.NOT_SENDABLE, 409, ErrorCode.CONFLICT);
      });
      return this.get(sender, announcementId);
    }
    if (row.channels.includes('mail') && (await this.mailCapReached(row))) {
      throw new AppError(AnnouncementMessages.MAIL_DAILY_CAP, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }
    await this.startFanout(announcementId, OPEN, (qr) => this.assertRateGuards(qr, row, new Date()));
    return this.get(sender, announcementId);
  }

  /**
   * Withdraws it. Not sent yet: it never goes out. Sent: the popup and the banner stop at once and the bell entries
   * nobody read yet are taken back (a job); mail already sent cannot be recalled (the console's confirm says so).
   */
  static async withdraw(sender: Sender, announcementId: string): Promise<AnnouncementWithNumbers> {
    const row = await this.ownRow(sender, announcementId);
    const from = ['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED'];
    const res = await announcements((repo) => repo.update({ announcementId, status: In(from) }, { status: 'WITHDRAWN', withdrawnAt: new Date() } as never));
    if (!res.affected) throw new AppError(AnnouncementMessages.ALREADY_CLOSED, 409, ErrorCode.CONFLICT);
    // A failed one may have reached part of its audience before it gave up: theirs are taken back too.
    if (row.status === 'SENDING' || row.status === 'SENT' || row.status === 'FAILED') {
      const { enqueueRecall } = await import('./announcement.job');
      await enqueueRecall(announcementId);
    }
    return this.get(sender, announcementId);
  }

  /**
   * Sends a FAILED one again (D23): back to SENDING with its restart count cleared, and its fan-out queued from the cursor
   * where it stopped, so the people already reached are not reached again (the dispatcher's idempotency keys hold too).
   * Refused past its expiry (withdraw it instead), for a window's notice its window has moved on from (a later notice of
   * it went out or was withdrawn: the window started, ended or was cancelled, and the old text would mislead), for a
   * second critical popup within the hour, and, when no batch went out yet, by mail beyond the day's cap of its kind (as a
   * send by hand is).
   */
  static async retry(sender: Sender, announcementId: string, now = new Date()): Promise<AnnouncementWithNumbers> {
    const row = await this.ownRow(sender, announcementId);
    if (row.status !== 'FAILED') throw new AppError(AnnouncementMessages.NOT_RETRYABLE, 409, ErrorCode.CONFLICT);
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) {
      throw new AppError(AnnouncementMessages.RETRY_EXPIRED, 409, ErrorCode.CONFLICT);
    }
    if (row.windowId && row.stage && (await this.windowMovedOn(row.windowId, row.stage))) {
      throw new AppError(AnnouncementMessages.RETRY_WINDOW_MOVED_ON, 409, ErrorCode.CONFLICT);
    }
    if (row.fanoutCursor === null && row.stats.mailCapped === undefined && row.channels.includes('mail') && (await this.mailCapReached(row, now))) {
      throw new AppError(AnnouncementMessages.MAIL_DAILY_CAP, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }
    const stats = { ...row.stats };
    delete stats.restarts;
    delete stats.restartCursor;
    delete stats.failure;
    await withSystemRLS(async (qr) => {
      await this.assertRateGuards(qr, row, now);
      const res = await qr.manager.getRepository(Announcement).update({ announcementId, status: 'FAILED' }, { status: 'SENDING', stats } as never);
      if (!res.affected) throw new AppError(AnnouncementMessages.NOT_RETRYABLE, 409, ErrorCode.CONFLICT);
    });
    const { requeueFanout } = await import('./announcement.job');
    await requeueFanout(announcementId);
    return this.get(sender, announcementId);
  }

  /**
   * Sends it to the sender alone, on its dispatcher channels, marked as a test (the shell channels are previewed in the
   * console). Its own idempotency key, so the real send still reaches the sender.
   */
  static async testSend(sender: Sender, announcementId: string, actor: { userId: string; tenantId: string }): Promise<{ delivered: string[] }> {
    const row = await this.ownRow(sender, announcementId);
    const [person]: Array<{ email: string | null; phone: string | null; language: string | null }> = await withSystemRLS((qr) => qr.query(
      `SELECT u."email", u."phone", p."language" FROM "users" u LEFT JOIN "user_preferences" p ON p."userId" = u."userId" WHERE u."userId" = $1`,
      [actor.userId],
    ));
    const member: AudienceMember = {
      userId: actor.userId,
      tenantId: actor.tenantId,
      email: person?.email && !person.email.toLowerCase().endsWith('.invalid') ? person.email : null,
      phone: person?.phone || null,
      language: person?.language || null,
    };
    const test: Announcement = {
      ...row,
      content: Object.fromEntries(Object.entries(row.content).map(([l, t]) => [l, { ...t, title: `[Test] ${t.title}` }])),
    };
    const outcome = await deliverBatch(test, [member], { mail: true, key: `announcement-test:${announcementId}:${Date.now()}` });
    return { delivered: [...(outcome.channelsByUser.get(actor.userId) ?? [])] };
  }

  // ── Guards ─────────────────────────────────────────────────────────────────

  /**
   * A critical popup at most once an hour per sender: around `at`, no other one sent or scheduled. Runs on the
   * transaction that then stores the send or the schedule, and holds the sender's lock until it commits, so two at once
   * cannot both pass.
   */
  private static async assertRateGuards(qr: QueryRunner, row: GuardedRow, at: Date): Promise<void> {
    if (!isCriticalPopup(row)) return;
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`announcement:critical-popup:${row.tenantId ?? 'platform'}`]);
    const from = new Date(at.getTime() - CRITICAL_POPUP_INTERVAL_MS);
    const to = new Date(at.getTime() + CRITICAL_POPUP_INTERVAL_MS);
    const [hit]: Array<{ announcementId: string }> = await qr.query(
      `SELECT "announcementId" FROM "announcements"
       WHERE "tenantId" IS NOT DISTINCT FROM $1::uuid AND ($2::uuid IS NULL OR "announcementId" <> $2::uuid)
         AND "severity" = 'critical' AND "channels" ? 'popup'
         AND "status" IN ('SCHEDULED', 'SENDING', 'SENT', 'EXPIRED', 'FAILED')
         AND COALESCE("sentAt", "sendAt") > $3 AND COALESCE("sentAt", "sendAt") < $4
       LIMIT 1`,
      [row.tenantId, row.announcementId, from, to],
    );
    if (hit) throw new AppError(AnnouncementMessages.CRITICAL_POPUP_RATE, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
  }

  /**
   * Has the window gone past `stage`: one of its later notices is no longer waiting (sent, failed, expired or withdrawn).
   * The window's own events also run a failed earlier notice out (announcement.maintenance); this holds when one of them
   * was missed.
   */
  private static async windowMovedOn(windowId: string, stage: string): Promise<boolean> {
    const later = MaintenanceStageEnum.options.slice(MaintenanceStageEnum.options.indexOf(stage as never) + 1);
    if (later.length === 0) return false;
    const rows = await announcements((repo) => repo.find({ where: { windowId, stage: In(later) }, select: { announcementId: true, status: true } }));
    return rows.some((r) => !OPEN.includes(r.status));
  }

  /** Has the sender sent as many announcements of this kind by mail in the last day as the cap allows. */
  static async mailCapReached(row: Pick<Announcement, 'announcementId' | 'tenantId' | 'kind'>, now = new Date()): Promise<boolean> {
    const [r]: Array<{ count: string }> = await withSystemRLS((qr) => qr.query(
      `SELECT count(*)::text AS count FROM "announcements"
       WHERE "tenantId" IS NOT DISTINCT FROM $1::uuid AND "announcementId" <> $2::uuid AND "kind" = $3
         AND "channels" ? 'mail' AND "sentAt" > $4 AND COALESCE(("stats"->>'mailCapped')::boolean, false) = false`,
      [row.tenantId, row.announcementId, row.kind, new Date(now.getTime() - DAY_MS)],
    ));
    return Number(r?.count ?? 0) >= MAIL_DAILY_CAP[row.kind as AnnouncementKind];
  }

  // ── Fan-out ────────────────────────────────────────────────────────────────

  /**
   * Moves the row to SENDING (from `from`) and queues its fan-out. False when it was not in `from` any more. `guard` runs
   * first on the same transaction (the critical-popup guard of a send now).
   */
  static async startFanout(announcementId: string, from: string[], guard?: (qr: QueryRunner) => Promise<void>): Promise<boolean> {
    const affected = await withSystemRLS(async (qr) => {
      if (guard) await guard(qr);
      return (await qr.manager.getRepository(Announcement).update(
        { announcementId, status: In(from) }, { status: 'SENDING', sentAt: new Date(), sendAt: null, fanoutCursor: null } as never,
      )).affected;
    });
    if (!affected) return false;
    const { enqueueFanout } = await import('./announcement.job');
    await enqueueFanout(announcementId);
    return true;
  }

  /**
   * The fan-out job's body: batch after batch of people from the row's cursor, each written as a receipt, delivered on
   * the dispatcher channels and signalled to their workspaces' open shells; then SENT. A retried job resumes at the
   * cursor, and a person already delivered is not delivered again. Stops when the row was withdrawn meanwhile.
   */
  static async runFanout(announcementId: string): Promise<{ recipients: number }> {
    const row = await announcements((repo) => repo.findOne({ where: { announcementId } }));
    if (!row || row.status !== 'SENDING') return { recipients: 0 };
    const sender: Sender = { tenantId: row.tenantId };
    const tenants = await audienceTenants(sender, row.audience);
    const stats: AnnouncementStats = { ...row.stats };
    // Decided once, at the first batch, and kept: a resumed job must not start mailing half the audience.
    if (row.fanoutCursor === null && row.channels.includes('mail') && stats.mailCapped === undefined) {
      stats.mailCapped = await this.mailCapReached(row);
      if (stats.mailCapped) Logger.warn(`[announcement] ${announcementId}: the day's mail cap of ${row.kind} is reached, sent without mail`);
    }
    const live = liveChannels(row.channels).length > 0;
    let cursor = row.fanoutCursor;
    for (;;) {
      const batch = await audienceBatch(tenants, row.audience.roles, cursor);
      if (batch.length === 0) break;
      await receipts((repo) => repo.createQueryBuilder().insert().into(AnnouncementReceipt)
        .values(batch.map((m) => ({ announcementId, userId: m.userId, tenantId: m.tenantId, channels: [] })))
        .orIgnore().execute());
      const pendingIds = new Set((await receipts((repo) => repo.find({
        select: { userId: true },
        where: { announcementId, userId: In(batch.map((m) => m.userId)), deliveredAt: IsNull() },
      }))).map((r) => r.userId));
      const pending = batch.filter((m) => pendingIds.has(m.userId));
      const outcome = await deliverBatch(row, pending, { mail: !stats.mailCapped });
      await this.markDelivered(announcementId, pending, outcome.channelsByUser);
      stats.recipients = (stats.recipients ?? 0) + pending.length;
      stats.delivered = mergeCounts(stats.delivered, outcome.delivered);
      stats.failed = mergeCounts(stats.failed, outcome.failed);
      cursor = batch[batch.length - 1]!.userId;
      const res = await announcements((repo) => repo.update(
        { announcementId, status: 'SENDING' }, { fanoutCursor: cursor, stats } as never,
      ));
      if (!res.affected) {
        // Withdrawn while this batch went out. The recall job may have read these receipts before they carried their
        // channels, so the batch takes back its own bell entries; the recall job takes the rest.
        await announcements((repo) => repo.update({ announcementId }, { stats } as never));
        const belled = pending.filter((m) => outcome.channelsByUser.get(m.userId)?.has('inapp'));
        const { recallInApp } = await import('./announcement.recall');
        for (const m of belled) await recallInApp(m.tenantId, m.userId, `announcement:${announcementId}`);
        await publishLive(await liveWorkspaces(row, batch.map((m) => m.userId)), 'recall');
        return { recipients: stats.recipients ?? 0 };
      }
      if (live) await publishLive(await liveWorkspaces(row, batch.map((m) => m.userId)));
    }
    await announcements((repo) => repo.update({ announcementId, status: 'SENDING' }, { status: 'SENT', stats } as never));
    return { recipients: stats.recipients ?? 0 };
  }

  private static async markDelivered(announcementId: string, people: AudienceMember[], byUser: Map<string, Set<string>>): Promise<void> {
    if (people.length === 0) return;
    // One UPDATE per distinct channel set (a handful), not one per person.
    const bySet = new Map<string, string[]>();
    for (const p of people) {
      const key = JSON.stringify([...(byUser.get(p.userId) ?? [])].sort());
      bySet.set(key, [...(bySet.get(key) ?? []), p.userId]);
    }
    for (const [key, userIds] of bySet) {
      await withSystemRLS((qr) => qr.query(
        `UPDATE "announcement_receipts" SET "deliveredAt" = now(), "channels" = $3::jsonb
         WHERE "announcementId" = $1 AND "userId" = ANY($2::uuid[])`,
        [announcementId, userIds, key],
      ));
    }
  }

  /**
   * After a withdrawal: the bell entries nobody read are taken back, and the open shells of the workspaces that show it
   * are told, so the popup and the banner go at once and the bell reads its list again.
   */
  static async runRecall(announcementId: string): Promise<{ recalled: number }> {
    const row = await announcements((repo) => repo.findOne({ where: { announcementId } }));
    if (!row) return { recalled: 0 };
    let recalled = 0;
    let after: string | null = null;
    const { recallInApp } = await import('./announcement.recall');
    for (;;) {
      const rows: Array<{ userId: string; tenantId: string; channels: string[] }> = await withSystemRLS((qr) => qr.query(
        `SELECT "userId", "tenantId", "channels" FROM "announcement_receipts"
         WHERE "announcementId" = $1 AND ($2::uuid IS NULL OR "userId" > $2::uuid) ORDER BY "userId" LIMIT 500`,
        [announcementId, after],
      ));
      if (rows.length === 0) break;
      for (const r of rows) {
        if (r.channels.includes('inapp')) recalled += await recallInApp(r.tenantId, r.userId, `announcement:${announcementId}`);
      }
      after = rows[rows.length - 1]!.userId;
    }
    // Every workspace that shows it, not only the receipts' one; the bell lists read again too.
    await publishLive(await liveWorkspaces(row), 'recall');
    return { recalled };
  }

  /**
   * One scheduler pass: scheduled ones that are due go out, sent ones past their expiry expire, and a fan-out whose job
   * was lost or gave up (SENDING untouched for five minutes) is queued again; one still waiting or running is left be.
   * A fan-out queued again `FANOUT_MAX_RESTARTS` times without getting further is given up instead (D23): FAILED with
   * the reason, audited, and its sender told.
   */
  static async tick(now = new Date()): Promise<{ started: number; expired: number; requeued: number; failed: number }> {
    let started = 0;
    const due = await announcements((repo) => repo.createQueryBuilder('a')
      .where('a.status = :s', { s: 'SCHEDULED' }).andWhere('a.sendAt IS NOT NULL').andWhere('a.sendAt <= :now', { now })
      .orderBy('a.sendAt', 'ASC').take(100).getMany());
    for (const a of due) if (await this.startFanout(a.announcementId, ['SCHEDULED'])) started++;
    const expired = (await announcements((repo) => repo.createQueryBuilder().update(Announcement)
      .set({ status: 'EXPIRED' }).where('status = :s', { s: 'SENT' }).andWhere('"expiresAt" IS NOT NULL AND "expiresAt" <= :now', { now })
      .execute())).affected ?? 0;
    const stuck = await announcements((repo) => repo.createQueryBuilder('a')
      .where('a.status = :s', { s: 'SENDING' }).andWhere('a.updatedAt < :t', { t: new Date(now.getTime() - 5 * 60_000) })
      .take(100).getMany());
    let requeued = 0;
    let failed = 0;
    if (stuck.length) {
      const { fanoutJobState, requeueFanout } = await import('./announcement.job');
      for (const a of stuck) {
        const job = await fanoutJobState(a.announcementId);
        // Still waiting, delayed or running: its own attempts are not used up yet.
        if (job && job.state !== 'failed' && job.state !== 'completed') continue;
        const progressed = a.stats.restartCursor !== undefined && a.stats.restartCursor !== a.fanoutCursor;
        const restarts = progressed ? 0 : (a.stats.restarts ?? 0);
        if (restarts >= FANOUT_MAX_RESTARTS) {
          if (await this.giveUp(a, restarts, job?.failedReason ?? null, now)) failed++;
          continue;
        }
        // The count is claimed on the row before the job is queued, and only while the fan-out is where it was read.
        const claimed = await withSystemRLS(async (qr) => (await qr.query(
          `UPDATE "announcements" SET "stats" = "stats" || jsonb_build_object('restarts', $2::int, 'restartCursor', $3::text),
                  "updatedAt" = now()
           WHERE "announcementId" = $1 AND "status" = 'SENDING' AND "fanoutCursor" IS NOT DISTINCT FROM $4::uuid`,
          [a.announcementId, restarts + 1, a.fanoutCursor, a.fanoutCursor],
        ))[1] as number);
        if (claimed && (await requeueFanout(a.announcementId))) requeued++;
      }
    }
    return { started, expired, requeued, failed };
  }

  /**
   * Gives a fan-out up (D23): FAILED with the reason its sender may read (the raw error goes to the server log only), then
   * the audit entry and the word to the sender. The people it reached keep what they got (the shell still shows it) until
   * the sender retries or withdraws it. False when the row was no longer sending.
   */
  private static async giveUp(row: Announcement, restarts: number, error: string | null, now: Date): Promise<boolean> {
    const failure = { reason: fanoutFailureReason(error), at: now.toISOString(), restarts };
    Logger.error(`[announcement] ${row.announcementId}: the fan-out gave up after ${restarts} restarts: ${error ?? 'the job was lost'}`);
    const affected = await withSystemRLS(async (qr) => (await qr.query(
      `UPDATE "announcements" SET "status" = 'FAILED', "stats" = "stats" || jsonb_build_object('failure', $2::jsonb), "updatedAt" = now()
       WHERE "announcementId" = $1 AND "status" = 'SENDING'`,
      [row.announcementId, JSON.stringify(failure)],
    ))[1] as number);
    if (!affected) return false;
    const { reportFanoutFailure } = await import('./announcement.failure');
    await reportFanoutFailure(row, failure, row.stats.recipients ?? 0);
    return true;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** The sender's own row, or 404 (another tenant's row is not found, never forbidden: no existence leak). */
  static async ownRow(sender: Sender, announcementId: string): Promise<Announcement> {
    const row = await announcements((repo) => repo.findOne({ where: { announcementId, ...senderWhere(sender) } as never }));
    if (!row) throw new AppError(AnnouncementMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    return row;
  }

  /** The text of a row in a language (D19 fallback), for callers that show one. */
  static textOf(row: Pick<Announcement, 'content' | 'defaultLanguage'>, language: string | null) {
    return textFor(row.content, row.defaultLanguage, language);
  }
}

function emptyNumbers(): ReceiptNumbers {
  return { recipients: 0, seen: 0, acknowledged: 0, dismissed: 0 };
}

function mergeCounts(a: Record<string, number> | undefined, b: Record<string, number>): Record<string, number> {
  const out = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}
