import 'reflect-metadata';
import type { Worker } from 'bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { ACTIONS_TABLE, EVENTS_TABLE, INCIDENTS_TABLE, TERMINAL_ACTION_STATUSES } from './ai_firewall.store';
import { expireQuietIncidents } from '../incidents/ai_firewall.incident-store';
import { BASELINES_TABLE } from '../features/ai_firewall.baseline.store';
import { LABELS_TABLE } from '../labels/ai_firewall.label-store';
import { dayOf } from '../features/ai_firewall.feature-windows';

/**
 * The store's retention (docs/phases/55-ai-firewall/01 §1.7): every night, per tenant, what is older than the tenant's
 * `aiFirewallRetentionDays` (default 90 days, 7..365; the ROOT tenant's value for the platform's rows) is deleted:
 *
 *   - stored security events by `at`;
 *   - closed incidents by `closedAt` (an open or acknowledged incident is never deleted, however old);
 *   - ended action proposals (undone, expired, rejected, refused, failed, noop) by `endedAt` (a proposal still waiting and an executed
 *     action still in force are never deleted: its undo needs the row).
 *
 * Then (03 §3.1, D55-81, D55-97) the labels whose behaviour happened before the cutoff (`refAt`, the incident's opening or the event's
 * time; or, should a clock disagree, given before it, `labelledAt`): a label is training data about a person's or an address's behaviour
 * and is kept no longer than the events it was learnt from. A later verdict rewrites `labelledAt`, never `refAt`, so it cannot keep a label
 * (its actor id, its labeller) a further retention; an incident's labels go no later than the incident (its opening precedes its close).
 * Its own step, like the baselines'.
 *
 * Then (02 §2.1, §2.8, D55-46) the feature store's baselines (`ai_firewall_baselines`: a person's, a key's, a role's prior) whose last
 * folded day (`lastDay`) is older than the cutoff are deleted: someone who left, a deleted key or a role nobody holds any more keeps no
 * behaviour profile beyond the retention. Its own step: a failure is logged and the tenant's other work stands.
 *
 * Then (02 §2.4, §2.8, D55-37) every incident of the tenant quiet for 24 h, or opened more than 7 days ago, is closed as `expired`
 * (`expireQuietIncidents`, closed at the time it went quiet), so an incident about an address is deleted one retention after its last
 * activity, never kept open forever. It runs after the deletes of the tenant, which therefore never delete what it closed the same night.
 *
 * Each delete runs in batches of `batchSize` rows, one transaction each, in the tenant's own scope (RLS applies; the events are deleted
 * through the time-series access view in Timescale mode), at most `maxBatches` per table and tenant per run, so one large tenant cannot
 * hold the job: what is left is deleted the next night. Tenants are those a retention sweep may touch (`tenant.sweep`): a tenant under a
 * legal hold, migrating or relocated is skipped, and each tenant is checked again right before its work. A tenant that fails is logged
 * and the run goes on. The events table also has the platform's 365-day chunk-drop backstop (`ai_firewall.timeseries.ts`).
 *
 * Self-hosted: `scheduleFirewallRetentionJob()` (common:boot_task, scheduler phase, the leader only).
 */
const QUEUE_NAME = 'ai-firewall-retention';
const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_BATCH = 5_000;
export const RETENTION_MAX_BATCHES = 100;

export interface RetentionDeps {
  /** The tenants a retention sweep may work on now. */
  listTenants: (now: Date) => Promise<string[]>;
  /** Re-read right before a tenant's work (a hold placed after the listing is honoured). */
  eligibleNow: (tenantId: string, now: Date) => Promise<boolean>;
  retentionDays: (tenantId: string) => Promise<number>;
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  batchSize?: number;
  maxBatches?: number;
}

export interface TenantPruned {
  events: number;
  incidents: number;
  actions: number;
}

export interface RetentionSummary extends TenantPruned {
  /** Labels given before the cutoff (03 §3.1, D55-81). */
  labels: number;
  /** Baselines whose last folded day is older than the cutoff (D55-46). */
  baselines: number;
  /** Quiet incidents closed as expired (D55-37). */
  expired: number;
  tenants: number;
  skipped: number;
  failed: number;
}

const countOf = (result: unknown): number => Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0);

/** Deletes in batches until a batch comes back short or the bound is reached; answers the rows deleted. */
async function inBatches(
  tenantId: string, deps: RetentionDeps, statement: (db: SqlRunner) => Promise<{ sql: string; params: unknown[] }>,
): Promise<number> {
  const size = deps.batchSize ?? RETENTION_BATCH;
  let total = 0;
  for (let i = 0; i < (deps.maxBatches ?? RETENTION_MAX_BATCHES); i += 1) {
    const n = await deps.inTenant(tenantId, async (db) => {
      const { sql, params } = await statement(db);
      return countOf(await db.query(sql, [...params, size]));
    });
    total += n;
    if (n < size) break;
  }
  return total;
}

/** The three deletes of one tenant, older than `cutoff`. */
export async function pruneTenant(tenantId: string, cutoff: Date, deps: RetentionDeps): Promise<TenantPruned> {
  const at = cutoff.toISOString();
  const events = await inBatches(tenantId, deps, async (db) => {
    const rel = await deps.accessRel(db, EVENTS_TABLE);
    return {
      sql: `WITH d AS (DELETE FROM ${rel} WHERE ("tenantId", "at", "signalId") IN (
              SELECT "tenantId", "at", "signalId" FROM ${rel} WHERE "tenantId" = $1 AND "at" < $2::timestamptz ORDER BY "at" LIMIT $3
            ) RETURNING 1) SELECT count(*)::int AS n FROM d`,
      params: [tenantId, at],
    };
  });
  const incidents = await inBatches(tenantId, deps, async () => ({
    sql: `WITH d AS (DELETE FROM "${INCIDENTS_TABLE}" WHERE "incidentId" IN (
            SELECT "incidentId" FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1 AND "status" = 'closed' AND "closedAt" < $2::timestamptz
             ORDER BY "closedAt" LIMIT $3
          ) RETURNING 1) SELECT count(*)::int AS n FROM d`,
    params: [tenantId, at],
  }));
  const actions = await inBatches(tenantId, deps, async () => ({
    sql: `WITH d AS (DELETE FROM "${ACTIONS_TABLE}" WHERE "proposalId" IN (
            SELECT "proposalId" FROM "${ACTIONS_TABLE}" WHERE "tenantId" = $1 AND "status" = ANY($2::text[]) AND "endedAt" < $3::timestamptz
             ORDER BY "endedAt" LIMIT $4
          ) RETURNING 1) SELECT count(*)::int AS n FROM d`,
    params: [tenantId, [...TERMINAL_ACTION_STATUSES], at],
  }));
  return { events, incidents, actions };
}

/** The baselines of one tenant whose last folded day (`YYYYMMDD`, UTC) is before the cutoff's day (D55-46); answers the rows deleted. */
export async function pruneBaselines(tenantId: string, cutoff: Date, deps: RetentionDeps): Promise<number> {
  const day = dayOf(cutoff.getTime());
  return inBatches(tenantId, deps, async () => ({
    sql: `WITH d AS (DELETE FROM "${BASELINES_TABLE}" WHERE ("tenantId", "actorKind", "actorKey") IN (
            SELECT "tenantId", "actorKind", "actorKey" FROM "${BASELINES_TABLE}" WHERE "tenantId" = $1 AND "lastDay" < $2
             ORDER BY "lastDay" LIMIT $3
          ) RETURNING 1) SELECT count(*)::int AS n FROM d`,
    params: [tenantId, day],
  }));
}

/**
 * The labels of one tenant whose behaviour happened, or that were given, before the cutoff (03 §3.1, D55-81, D55-97); answers the rows
 * deleted. By `refAt` first (`idx_ai_firewall_labels_ref_at`, migration 007): a re-given verdict moves `labelledAt`, never `refAt`.
 */
export async function pruneLabels(tenantId: string, cutoff: Date, deps: RetentionDeps): Promise<number> {
  return inBatches(tenantId, deps, async () => ({
    sql: `WITH d AS (DELETE FROM "${LABELS_TABLE}" WHERE "labelId" IN (
            SELECT "labelId" FROM "${LABELS_TABLE}" WHERE "tenantId" = $1 AND ("refAt" < $2::timestamptz OR "labelledAt" < $2::timestamptz)
             ORDER BY "refAt" LIMIT $3
          ) RETURNING 1) SELECT count(*)::int AS n FROM d`,
    params: [tenantId, cutoff.toISOString()],
  }));
}

/** One run across tenants; never throws for one tenant. Shared by the worker job and tests. */
export async function runFirewallRetention(now: Date = new Date(), deps?: RetentionDeps): Promise<RetentionSummary> {
  const d = deps ?? (await defaultRetentionDeps());
  const summary: RetentionSummary = { tenants: 0, skipped: 0, failed: 0, events: 0, incidents: 0, actions: 0, labels: 0, baselines: 0, expired: 0 };
  let tenantIds: string[] = [];
  try {
    tenantIds = await d.listTenants(now);
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] tenant enumeration unavailable (empty run): ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const tenantId of tenantIds) {
    try {
      if (!(await d.eligibleNow(tenantId, now))) { summary.skipped += 1; continue; }
      const days = await d.retentionDays(tenantId);
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      const pruned = await pruneTenant(tenantId, cutoff, d);
      summary.tenants += 1;
      summary.events += pruned.events;
      summary.incidents += pruned.incidents;
      summary.actions += pruned.actions;
      try {
        summary.labels += await pruneLabels(tenantId, cutoff, d);
      } catch (err) {
        Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} label retention failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        summary.baselines += await pruneBaselines(tenantId, cutoff, d);
      } catch (err) {
        Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} baseline retention failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      // The expiry is its own step: a failure leaves the deletes counted and the incidents open until the next night.
      try {
        summary.expired += await expireQuietIncidents(tenantId, now, { inTenant: d.inTenant });
      } catch (err) {
        Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} incident expiry failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      summary.failed += 1;
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} retention failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  Logger.info(`[CronJob:${QUEUE_NAME}] tenants=${summary.tenants} skipped=${summary.skipped} failed=${summary.failed} events=${summary.events} incidents=${summary.incidents} actions=${summary.actions} labels=${summary.labels} baselines=${summary.baselines} expired=${summary.expired}`);
  return summary;
}

async function defaultRetentionDeps(): Promise<RetentionDeps> {
  const [{ withTenantTransactionFor }, { accessRel }, { listRetentionTenants, isRetentionEligibleNow }, { getAiFirewallPolicy }] = await Promise.all([
    import('@kuraykaraaslan-labs/db'),
    import('@kuraykaraaslan-labs/db/server/db.time-series.rollup'),
    import('@kuraykaraaslan-labs/tenant/server/tenant.sweep'),
    import('../ai_firewall.settings-policy'),
  ]);
  return {
    listTenants: async (now) => (await listRetentionTenants(now)).map((t) => t.tenantId),
    eligibleNow: (tenantId, now) => isRetentionEligibleNow(tenantId, now),
    retentionDays: async (tenantId) => (await getAiFirewallPolicy(tenantId)).retentionDays,
    inTenant: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
    accessRel,
  };
}

/* ──────────────────────────────── The schedule ──────────────────────────────── */

let worker: Worker | null = null;
let scheduled = false;

/** `common:boot_task` (scheduler phase; single-owner, so the leader runs it): the nightly run, one at a time. */
export async function scheduleFirewallRetentionJob(cronPattern = '50 3 * * *'): Promise<void> {
  if (scheduled) return;
  scheduled = true;
  const [{ createQueue, createWorker }, { registerWorkerDrain }, { runWithJobContext }] = await Promise.all([
    import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('@kuraykaraaslan-labs/logger/server/logger.request-context'),
  ]);
  const queue = createQueue(QUEUE_NAME, { defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } });
  worker ??= createWorker(QUEUE_NAME, async () => runWithJobContext(QUEUE_NAME, () => runFirewallRetention()), { concurrency: 1 });
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  await queue.add('prune', {}, { repeat: { pattern: cronPattern }, jobId: `${QUEUE_NAME}-recurring` });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`);
}
