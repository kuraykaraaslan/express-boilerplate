import 'reflect-metadata';
import { Client } from 'pg';
import Logger from '@kuraykaraaslan-labs/logger';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { systemBatchesOn, type BatchRunner, type Queryable } from './db.encrypted-columns';
import { loadTenantKeyColumns, type TenantKeyColumnSet } from './db.tenant-key-columns';
import {
  backfillTenantKeyColumns, describeTenantKeyBackfill, type TenantKeyBackfillCursor, type TenantKeyBackfillKeys, type TenantKeyBackfillReport,
  type UserKeyBackfillKeys,
} from './db.tenant-key-backfill';
import type { UserKeyRetryResult } from './db.user-keys.service';

/**
 * `db-tenant-key-backfill` (P7-TDEK, decision F17): the online re-encryption backfill of the columns declared on `db:tenant_key_columns`
 * (db.tenant-key-backfill.ts), every 15 minutes, on the system database (shared schema; RLS bypassed per batch) and then on every dedicated tenant
 * database registered in `tenant_databases`. Each database's run is bounded (`DB_BUDGET_MS`); a database cut by its budget resumes from its cursor
 * on the next run of this process (a new process starts over, which only rescans: converted rows are never selected again). The user-scope sets
 * (decision F27: a person's secrets under the per-user key) are moved by the same pass with the user keys. A scheduler boot task:
 * single-owner across the cluster (the scheduler leader lock), never overlapping itself in-process. Each run first retries what a person's erasure
 * still owes their user keys (`runUserKeyErasureRetry`: a failed destroy, pending provider slots).
 */
const QUEUE_NAME = 'db-tenant-key-backfill';
const DB_BUDGET_MS = 4 * 60_000;

export interface TenantKeyBackfillSweepSummary {
  databases: number;
  failed: number;
  sealed: number;
  unreadable: number;
  incomplete: number;
  skipped?: 'no-key' | 'running' | 'no-columns';
}

export interface TenantKeyBackfillSweepDeps {
  sets?: () => Promise<TenantKeyColumnSet[]>;
  keys?: () => Promise<TenantKeyBackfillKeys>;
  /** The per-user keys for the user-scope sets (default: db.user-keys.service.ts `userKeys`). */
  userKeys?: () => Promise<UserKeyBackfillKeys>;
  /** The system database's batch runner (default: the system DataSource, RLS bypassed per batch). */
  systemBatches?: () => Promise<BatchRunner>;
  /**
   * The dedicated tenant databases, each with the tenant it belongs to (default: `tenant_databases`, DSNs opened under the node key). The
   * tenant is what each batch on that database runs as (`app.current_tenant`): the application role owns those tables and RLS is FORCED there,
   * so without it every SELECT of the backfill returns zero rows.
   */
  tenantDatabaseUrls?: () => Promise<TenantDatabaseTarget[]>;
  budgetMs?: number;
  pauseMs?: number;
}

export interface TenantDatabaseTarget { tenantId: string; url: string }

const cursors = new Map<string, TenantKeyBackfillCursor>();
let running = false;

/**
 * A batch runner on one pg client: each unit of work is one transaction. With `tenantId` (a tenant's own database), each transaction runs as that
 * tenant (`app.current_tenant`, transaction-local) with the RLS bypass also asked for, exactly as `systemBatchesOn` asks for it: the application
 * role owns the tenant tables and RLS is FORCED on them (manual/rls-force-enable.sql), so the owner sees only the rows of the tenant in context,
 * and the bypass applies to an `app_admin` member only. Without it the backfill and the purge-time reseal read zero rows there and seal nothing.
 */
export function clientBatches(client: { query(sql: string, params?: unknown[]): Promise<unknown> }, tenantId?: string): BatchRunner {
  const q: Queryable = { query: (sql, params) => client.query(sql, params) };
  return async (fn) => {
    await client.query('BEGIN');
    try {
      if (tenantId) {
        await client.query("SELECT set_config('app.bypass_rls', 'on', true), set_config('app.current_tenant', $1, true)", [tenantId]);
      }
      const out = await fn(q); await client.query('COMMIT'); return out;
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; }
  };
}

async function defaultTenantDatabaseUrls(): Promise<TenantDatabaseTarget[]> {
  const [{ default: TenantDatabaseService }, { resolveTenantDatabaseUrl }] = await Promise.all([
    import('./db.tenant-provision.service'), import('./db.tenant-database.url'),
  ]);
  const rows = (await TenantDatabaseService.listAll()).filter((r) => r.status !== 'DROPPED');
  return rows.flatMap((r) => {
    try { return [{ tenantId: r.tenantId, url: resolveTenantDatabaseUrl(r, (m) => Logger.warn(m)) }]; } catch (err) {
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant database unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  });
}

function tally(summary: TenantKeyBackfillSweepSummary, report: TenantKeyBackfillReport): void {
  summary.databases += 1;
  for (const c of Object.values(report.columns)) { summary.sealed += c.sealed; summary.unreadable += c.unreadable; }
  if (!report.complete) summary.incomplete += 1;
}

/** One full pass over every database. Shared by the worker and tests. */
export async function runTenantKeyBackfillSweep(deps: TenantKeyBackfillSweepDeps = {}): Promise<TenantKeyBackfillSweepSummary> {
  const summary: TenantKeyBackfillSweepSummary = { databases: 0, failed: 0, sealed: 0, unreadable: 0, incomplete: 0 };
  if (running) return { ...summary, skipped: 'running' };
  running = true;
  try {
    const sets = await (deps.sets ?? loadTenantKeyColumns)();
    if (sets.length === 0) return { ...summary, skipped: 'no-columns' };
    const keys = await (deps.keys ?? (async () => (await import('./db.tenant-keys.service')).tenantKeys))();
    if (!(await keys.canEncrypt())) return { ...summary, skipped: 'no-key' };
    const userKeys = sets.some((s) => s.keyScope === 'user')
      ? await (deps.userKeys ?? (async () => (await import('./db.user-keys.service')).userKeys))()
      : undefined;
    const opts = { budgetMs: deps.budgetMs ?? DB_BUDGET_MS, pauseMs: deps.pauseMs, userKeys };

    const runOne = async (name: string, batch: BatchRunner): Promise<void> => {
      try {
        const report = await backfillTenantKeyColumns(batch, sets, keys, { ...opts, resume: cursors.get(name) ?? null });
        if (report.cursor) cursors.set(name, report.cursor); else cursors.delete(name);
        tally(summary, report);
        Logger.info(`[CronJob:${QUEUE_NAME}] ${name}: ${describeTenantKeyBackfill(report)}`);
      } catch (err) {
        summary.failed += 1;
        Logger.warn(`[CronJob:${QUEUE_NAME}] ${name} failed (the next run resumes): ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const systemBatches = deps.systemBatches ?? (async () => systemBatchesOn(await (await import('./db.datasource')).getSystemDataSource()));
    await runOne('system', await systemBatches());

    let targets: TenantDatabaseTarget[] = [];
    try { targets = await (deps.tenantDatabaseUrls ?? defaultTenantDatabaseUrls)(); } catch (err) {
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant databases unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { parseDbUrl } = await import('./db.utils');
    for (const { tenantId, url: raw } of targets) {
      const { url, schema } = parseDbUrl(raw);
      const client = new Client({ connectionString: url });
      try {
        await client.connect();
        if (schema) await client.query(`SET search_path TO "${schema.replace(/"/g, '""')}", public`);
        await runOne(`tenant-db-${tenantId}`, clientBatches(client, tenantId));
      } catch (err) {
        summary.failed += 1;
        Logger.warn(`[CronJob:${QUEUE_NAME}] tenant database failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await client.end().catch(() => undefined);
      }
    }
    return summary;
  } finally {
    running = false;
  }
}

export interface TenantKeyResealResult {
  /** Why nothing ran: no declared column, or the node cannot hold tenant keys. */
  skipped?: 'no-columns' | 'no-key';
  /** Databases passed over (the system database, and the tenant's own one when it has one). */
  databases: number;
  /** Values this pass sealed under the tenant's key: they were legacy plaintext, v1 or node-key envelopes until now. */
  sealed: number;
  /** Values that did not open (counted, left as they are). */
  unreadable: number;
  /** Values that could not be sealed because the tenant's keys are destroyed already (a rerun after the purge). */
  purged: number;
}

export interface TenantKeyResealDeps {
  sets?: () => Promise<TenantKeyColumnSet[]>;
  keys?: () => Promise<TenantKeyBackfillKeys>;
  systemBatches?: () => Promise<BatchRunner>;
  /** The tenant's own database URL, or null when it lives in the shared schema (default: `tenant_databases`, DSN opened under the node key). */
  tenantDatabaseUrl?: (tenantId: string) => Promise<string | null>;
  pauseMs?: number;
}

async function defaultTenantDatabaseUrl(tenantId: string): Promise<string | null> {
  const [{ default: TenantDatabaseService }, { resolveTenantDatabaseUrl }] = await Promise.all([
    import('./db.tenant-provision.service'), import('./db.tenant-database.url'),
  ]);
  const row = await TenantDatabaseService.getForTenant(tenantId);
  return row && row.status !== 'DROPPED' ? resolveTenantDatabaseUrl(row, (m) => Logger.warn(m)) : null;
}

/**
 * The backfill for ONE tenant, to the end, on the system database and on the tenant's own database (P7-TDEK). The purge runs it right before it
 * destroys the tenant's data keys (tenant.purge-keys.ts): every value of the tenant's declared columns that is still legacy plaintext, a v1 or a
 * node-key envelope is sealed under the tenant's key first, so the destroy shreds it too instead of leaving it readable in the live database. What
 * it sealed was in the old shape until now, so a backup taken before still holds it that way: the caller reports it. Throws on a database or
 * key-store fault (the caller then keeps the keys and retries); no budget, no cursor.
 */
export async function resealTenantKeyColumns(tenantId: string, deps: TenantKeyResealDeps = {}): Promise<TenantKeyResealResult> {
  const out: TenantKeyResealResult = { databases: 0, sealed: 0, unreadable: 0, purged: 0 };
  const sets = await (deps.sets ?? loadTenantKeyColumns)();
  if (sets.length === 0) return { ...out, skipped: 'no-columns' };
  const keys = await (deps.keys ?? (async () => (await import('./db.tenant-keys.service')).tenantKeys))();
  if (!(await keys.canEncrypt())) return { ...out, skipped: 'no-key' };
  const add = (report: TenantKeyBackfillReport) => {
    out.databases += 1;
    for (const c of Object.values(report.columns)) { out.sealed += c.sealed; out.unreadable += c.unreadable; out.purged += c.purged; }
  };
  const opts = { tenantId, pauseMs: deps.pauseMs ?? 0 };
  const systemBatches = deps.systemBatches ?? (async () => systemBatchesOn(await (await import('./db.datasource')).getSystemDataSource()));
  add(await backfillTenantKeyColumns(await systemBatches(), sets, keys, opts));
  const raw = await (deps.tenantDatabaseUrl ?? defaultTenantDatabaseUrl)(tenantId);
  if (raw) {
    const { parseDbUrl } = await import('./db.utils');
    const { url, schema } = parseDbUrl(raw);
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      if (schema) await client.query(`SET search_path TO "${schema.replace(/"/g, '""')}", public`);
      add(await backfillTenantKeyColumns(clientBatches(client, tenantId), sets, keys, opts));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  return out;
}

export interface UserKeyResealDeps {
  sets?: () => Promise<TenantKeyColumnSet[]>;
  keys?: () => Promise<TenantKeyBackfillKeys>;
  userKeys?: () => Promise<UserKeyBackfillKeys>;
  systemBatches?: () => Promise<BatchRunner>;
}

/**
 * The backfill for ONE user's rows of the user-scope sets (decision F27), to the end, on the system database (where every user-level table lives).
 * The erasure of a person runs it right before their keys are destroyed (privacy.user-keys.ts, user.crud.service.ts `remove`), as the tenant purge
 * runs `resealTenantKeyColumns`: a legacy plaintext, v1 or node-key envelope of theirs is sealed under their key first, so the destroy shreds it in
 * the live database too, and `sealed` says how many values a backup taken before still holds in their old shape (the caller then never claims the
 * backups shredded). Throws on a database or key-store fault; no budget, no cursor.
 */
export async function resealUserKeyColumns(userId: string, deps: UserKeyResealDeps = {}): Promise<TenantKeyResealResult> {
  const out: TenantKeyResealResult = { databases: 0, sealed: 0, unreadable: 0, purged: 0 };
  const sets = (await (deps.sets ?? loadTenantKeyColumns)()).filter((s) => s.keyScope === 'user');
  if (sets.length === 0) return { ...out, skipped: 'no-columns' };
  const keys = await (deps.keys ?? (async () => (await import('./db.tenant-keys.service')).tenantKeys))();
  if (!(await keys.canEncrypt())) return { ...out, skipped: 'no-key' };
  const userKeys = await (deps.userKeys ?? (async () => (await import('./db.user-keys.service')).userKeys))();
  const systemBatches = deps.systemBatches ?? (async () => systemBatchesOn(await (await import('./db.datasource')).getSystemDataSource()));
  const report = await backfillTenantKeyColumns(await systemBatches(), sets, keys, { userId, userKeys, pauseMs: 0 });
  out.databases = 1;
  for (const c of Object.values(report.columns)) { out.sealed += c.sealed; out.unreadable += c.unreadable; out.purged += c.purged; }
  return out;
}

/**
 * The user-key retry (decision F27), run by this job's worker before each backfill pass: the destroys an erasure still owes and the provider slots
 * a destroy left (db.user-keys.service.ts `retryErasures`). Never throws: a failure is logged and the next run retries.
 */
export async function runUserKeyErasureRetry(
  retry: () => Promise<UserKeyRetryResult> = async () => (await import('./db.user-keys.service')).userKeys.retryErasures(),
): Promise<UserKeyRetryResult | null> {
  try {
    const r = await retry();
    if (r.erasures || r.slotUsers) Logger.info(`[CronJob:${QUEUE_NAME}] user-key retry: ${JSON.stringify(r)}`);
    if (r.failed || r.pendingSlots) Logger.warn(`[CronJob:${QUEUE_NAME}] user-key retry left ${r.failed} failure(s) and ${r.pendingSlots} pending slot(s): the next run retries`);
    return r;
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] user-key retry failed (the next run retries): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Test seam: forget the in-process cursors. */
export function resetTenantKeyBackfillCursors(): void { cursors.clear(); }

let _scheduled = false;

export async function scheduleTenantKeyBackfillJob(cronPattern = '*/15 * * * *'): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  const [{ Queue, Worker }, { getBullMQConnection }] = await Promise.all([
    import('bullmq'),
    import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
  ]);
  const queue = new Queue(QUEUE_NAME, { connection: getBullMQConnection(), defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } });
  const worker = new Worker(QUEUE_NAME, async () => {
    await runUserKeyErasureRetry();
    return runTenantKeyBackfillSweep();
  }, { connection: getBullMQConnection(), concurrency: 1 });
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  await queue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: `${QUEUE_NAME}-recurring` });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`);
}
