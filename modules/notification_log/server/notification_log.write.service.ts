import { And, Any, MoreThan, type FindOperator, type Repository } from 'typeorm';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import {
  NotificationLog,
  NotificationChannel,
  NotificationStatus,
} from './entities/notification_log.entity';
import type { NotificationLogOpts } from './notification_log.types';
import { REDACTED, recipientConditions, sealRecipient } from './notification_log.recipient';

/**
 * What anonymising a row writes: the recipient replaced by the marker, its blind index, the subject and the provider error text cleared. The two
 * free-text columns are set to SQL NULL explicitly (D5): TypeORM drops an `undefined` from a SET, so the earlier `subject: undefined` left an
 * invoice number, a name or an address in every "anonymised" row.
 */
/** Rows the erasure handles per statement. */
export const ERASE_PAGE = 1000;

const SCRUBBED = { recipient: REDACTED, recipientHash: null, subject: null, error: null };

export async function log(
  tenantId: string,
  channel: NotificationChannel,
  recipient: string,
  status: NotificationStatus,
  opts: NotificationLogOpts = {},
): Promise<NotificationLog | null> {
  if (!tenantId || !recipient) return null;

  try {
    // Sealed before the tenant block opens (the key service may create the tenant's key on the control database), inside the try: a seal
    // failure (a purged tenant's straggling send) loses the log row, never the send.
    const sealed = await sealRecipient(tenantId, recipient);
    // `return await`, not `return`: a rejected promise returned un-awaited
    // would skip this catch, and a log write must never fail a send.
    return await withTenantRepositoryFor(tenantId, NotificationLog, async (repo) => {
      const row = repo.create({
        tenantId,
        channel,
        recipient: sealed.recipient,
        recipientHash: sealed.recipientHash,
        status,
        subject: opts.subject,
        provider: opts.provider || 'unknown',
        providerMessageId: opts.providerMessageId,
        error: opts.error,
        attempts: opts.attempts ?? 1,
        eventType: opts.eventType,
        recipientCountry: opts.recipientCountry,
        latencyMs: opts.latencyMs,
      });
      return repo.save(row);
    });
  } catch (error) {
    Logger.warn(
      `NotificationLogService.log failed (${channel}/${status}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** Rows the retention sweep handles per batch, each batch its own short transaction. */
export const PRUNE_BATCH = 1000;
/** Batches per phase per run (50 000 rows); the daily schedule drains a larger backlog over the next runs. */
export const PRUNE_MAX_BATCHES = 50;

type PruneCursor = { sent: string; id: string } | null;
/** An extra predicate of one phase; its placeholders start at $4 ($1 tenant, $2 cutoff, $3 batch size). */
type PruneFilter = { sql: string; params: unknown[] };

/**
 * One keyset batch of the retention sweep (its own `withTenantRepositoryFor` block, so its own short transaction): the next `PRUNE_BATCH` rows of
 * the tenant older than `cutoff` that `extra` still selects, ordered by (sentAt, id) after `cursor`, handed to `apply`. The cursor's time is read
 * back as text, so PostgreSQL's microseconds survive the round trip (a JS Date would truncate them and select the last row again).
 */
async function pruneBatch(
  tenantId: string, cutoff: Date, extra: PruneFilter, cursor: PruneCursor,
  apply: (repo: Repository<NotificationLog>, ids: string[]) => Promise<number>,
): Promise<{ affected: number; selected: number; cursor: PruneCursor }> {
  return withTenantRepositoryFor(tenantId, NotificationLog, async (repo) => {
    const params: unknown[] = [tenantId, cutoff, PRUNE_BATCH, ...extra.params];
    let after = '';
    if (cursor) {
      params.push(cursor.sent, cursor.id);
      after = ` AND ("sentAt", "notificationLogId") > ($${params.length - 1}::timestamp, $${params.length}::uuid)`;
    }
    const rows = await repo.query(
      `SELECT "notificationLogId" AS id, "sentAt"::text AS sent FROM "notification_logs"
        WHERE "tenantId" = $1 AND "sentAt" < $2${extra.sql}${after}
        ORDER BY "sentAt", "notificationLogId" LIMIT $3`,
      params,
    ) as Array<{ id: string; sent: string }>;
    if (rows.length === 0) return { affected: 0, selected: 0, cursor };
    const affected = await apply(repo, rows.map((r) => r.id));
    const last = rows[rows.length - 1]!;
    return { affected, selected: rows.length, cursor: { sent: last.sent, id: last.id } };
  });
}

async function pruneInBatches(
  tenantId: string, cutoff: Date, extra: PruneFilter, apply: (repo: Repository<NotificationLog>, ids: string[]) => Promise<number>,
): Promise<number> {
  let total = 0;
  let cursor: PruneCursor = null;
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch++) {
    const res = await pruneBatch(tenantId, cutoff, extra, cursor, apply);
    total += res.affected;
    cursor = res.cursor;
    if (res.selected < PRUNE_BATCH) break;
  }
  return total;
}

/**
 * Retention pruning with PII protection: rows older than `anonymizeAfterDays` have their recipient/subject/error scrubbed (delivery stats kept for
 * analytics); rows older than `deleteAfterDays` are removed entirely. Meant to run from a scheduled job. Returns counts. `deleteAfterDays = 0`
 * disables hard deletion.
 *
 * Batched (P7-SWEEPERS review): keyset batches of `PRUNE_BATCH` rows by (sentAt, id), each batch its own short transaction, at most
 * `PRUNE_MAX_BATCHES` per phase per run, so a first run over a years-long ledger neither holds one huge lock nor one huge transaction. Deletion
 * runs first, so rows about to go are not scrubbed first. A run that changed anything leaves one audit row for the tenant
 * (`notification_log.retention.pruned`, counts only).
 */
export async function pruneAndAnonymize(
  tenantId: string,
  opts: { anonymizeAfterDays?: number; deleteAfterDays?: number } = {},
): Promise<{ anonymized: number; deleted: number }> {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let anonymized = 0;
  let deleted = 0;

  const deleteDays = opts.deleteAfterDays ?? 0;
  if (deleteDays > 0) {
    deleted = await pruneInBatches(tenantId, new Date(now - deleteDays * DAY), { sql: '', params: [] }, async (repo, ids) =>
      (await repo.delete({ tenantId, notificationLogId: Any(ids) })).affected ?? 0);
  }

  const anonDays = opts.anonymizeAfterDays ?? 90;
  if (anonDays > 0) {
    // a row the pre-D5 code "anonymised" still holds its subject and error text: selected again until they are gone
    const unscrubbed: PruneFilter = { sql: ' AND ("recipient" <> $4 OR "subject" IS NOT NULL OR "error" IS NOT NULL)', params: [REDACTED] };
    anonymized = await pruneInBatches(tenantId, new Date(now - anonDays * DAY), unscrubbed, async (repo, ids) => {
      const res = await repo.createQueryBuilder()
        .update(NotificationLog)
        .set(SCRUBBED)
        .where('tenantId = :tenantId', { tenantId })
        .andWhere('notificationLogId = ANY(:ids)', { ids })
        .execute();
      return res.affected ?? 0;
    });
  }

  if (anonymized > 0 || deleted > 0) {
    await auditPrune(tenantId, { anonymized, deleted, anonymizeAfterDays: anonDays, deleteAfterDays: deleteDays });
  }
  return { anonymized, deleted };
}

/** The sweep's audit row: counts and the windows only, never a recipient. Best effort: a failed audit never fails the sweep. */
async function auditPrune(tenantId: string, metadata: Record<string, number>): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log({
      tenantId,
      actorId: null,
      actorType: 'SYSTEM',
      action: 'notification_log.retention.pruned',
      resourceType: 'notification_log',
      resourceId: tenantId,
      metadata,
    });
  } catch { /* best effort */ }
}

/**
 * Right-to-erasure for a recipient (email / phone / userId): scrubs PII from
 * matching rows while keeping delivery stats, or hard-deletes when mode=DELETE.
 * A sealed row is found by its blind index under any key the node can still open, a legacy row by its plaintext
 * (notification_log.recipient.ts); a row under a destroyed key is already unreadable and cannot be found by value.
 */
export async function eraseForRecipient(
  tenantId: string, recipient: string, mode: 'ANONYMIZE' | 'DELETE' = 'ANONYMIZE',
): Promise<number> {
  const where = await recipientConditions(tenantId, recipient, { tenantId });
  return withTenantRepositoryFor(tenantId, NotificationLog, async (repo) => {
    // Pages by id, each page bound as ONE array parameter (`= ANY($n)`): an unbounded `IN (...)` binds one parameter per row and PostgreSQL
    // refuses more than 65535, so the heaviest recipients (an ops inbox) would be exactly the ones whose erasure fails. The cursor also keeps a
    // scrubbed row from being selected again.
    let total = 0;
    let after: string | null = null;
    for (;;) {
      const cursor: string | null = after;
      const page: typeof where = cursor === null ? where : where.map((c) => ({
        ...c,
        notificationLogId: c.notificationLogId ? And(c.notificationLogId as FindOperator<string>, MoreThan(cursor)) : MoreThan(cursor),
      }));
      const ids: string[] = (await repo.find({ where: page, select: { notificationLogId: true }, order: { notificationLogId: 'ASC' }, take: ERASE_PAGE }))
        .map((r) => r.notificationLogId);
      if (!ids.length) return total;
      if (mode === 'DELETE') {
        total += (await repo.delete({ tenantId, notificationLogId: Any(ids) })).affected ?? 0;
      } else {
        const res = await repo.createQueryBuilder()
          .update(NotificationLog)
          .set(SCRUBBED)
          .where('tenantId = :tenantId', { tenantId })
          .andWhere('notificationLogId = ANY(:ids)', { ids })
          .execute();
        total += res.affected ?? 0;
      }
      if (ids.length < ERASE_PAGE) return total;
      after = ids[ids.length - 1]!;
    }
  });
}
