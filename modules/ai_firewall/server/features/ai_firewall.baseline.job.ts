import 'reflect-metadata';
import type { Worker } from 'bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import type { SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import {
  activeActorsKey, actorPart, dayOf, erasedMarkKey, parseActiveMember, profileDistinctKey, profileKey, scopeTenant,
} from './ai_firewall.feature-windows';
import { dayProfileOf, isActiveDay, updateBaseline, updateRolePrior, type BaselineData } from './ai_firewall.baseline';
import { API_KEY_ROLE, ROLE_KIND, readBaselines, upsertBaselines, type BaselineRow } from './ai_firewall.baseline.store';

/**
 * The daily baseline job (docs/phases/55-ai-firewall/02 §2.1): at 00:20 UTC, on the leader, it folds YESTERDAY's day profiles (Redis,
 * written by the request and signal folds) into each active person's and API key's baseline (`ai_firewall_baselines`), then each
 * tenant's role priors (the cold-start prior: the EWMA of the mean of that day's baselines per role; no country, ASN or device).
 *
 *   1. the day's work list `fw:fa:<day>` is walked with SSCAN (BATCH members a step, at most MAX_ACTORS a run);
 *   2. per batch one pipeline: each actor's profile hash and its two distinct counts (subjects, addresses);
 *   3. per tenant (the scope's tenant; the platform's under ROOT) the stored rows of those actors and of the touched roles are read,
 *      updated (`updateBaseline`, a day already folded is skipped) and upserted in one statement in the tenant's own scope (RLS);
 *   4. a tenant that fails is logged and the run goes on; an actor whose day shows nothing is skipped, and so is an actor the privacy
 *      erasure marked (`fw:fx:<actor>`, D55-46: a flush that raced the erasure must not bring the person's baseline back).
 *
 * Re-running a day changes nothing (`lastDay`). Redis keys expire on their own (two days after their day), so a job that did not run
 * loses that day only. Least privilege: it reads only the feature store's own keys and writes only its own table.
 */
const QUEUE_NAME = 'ai-firewall-baselines';
export const BASELINE_BATCH = 500;
export const BASELINE_MAX_ACTORS = 200_000;

export interface BaselineJobRedis {
  sscan(key: string, cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
  pipeline(): {
    hgetall(key: string): unknown;
    pfcount(key: string): unknown;
    exists(key: string): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
}

export interface BaselineJobDeps {
  redis: BaselineJobRedis;
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  batch?: number;
  maxActors?: number;
}

export interface BaselineJobSummary {
  day: string;
  actors: number;
  written: number;
  priors: number;
  skipped: number;
  failedTenants: number;
}

export interface ActorDay {
  kind: string;
  hash: string;
  hashFields: Record<string, string>;
  subjects: number;
  addresses: number;
}

/** Replies per actor in a batch's pipeline: the profile, its two distinct counts, the erasure mark. */
const PER_ACTOR = 4;

/** Reads one batch of actors' day profiles, grouped by tenant; `erased` counts the actors the erasure marked (left out). */
async function readBatch(
  redis: BaselineJobRedis, day: string, members: readonly string[], erased: { n: number },
): Promise<Map<string, ActorDay[]>> {
  const actors = members.map(parseActiveMember).filter((m): m is NonNullable<typeof m> => !!m && (m.kind === 'user' || m.kind === 'apiKey'));
  const out = new Map<string, ActorDay[]>();
  if (actors.length === 0) return out;
  const pipe = redis.pipeline();
  for (const a of actors) {
    const part = actorPart(a.scope, a.kind, a.hash);
    pipe.hgetall(profileKey(day, part));
    pipe.pfcount(profileDistinctKey(day, part, 'subj'));
    pipe.pfcount(profileDistinctKey(day, part, 'addr'));
    pipe.exists(erasedMarkKey(part));
  }
  const replies = (await pipe.exec()) ?? [];
  actors.forEach((a, i) => {
    const tenantId = scopeTenant(a.scope, ROOT_TENANT_ID);
    if (!tenantId) return;
    const [e1, hash] = replies[i * PER_ACTOR] ?? [new Error('short'), null];
    const [, subj] = replies[i * PER_ACTOR + 1] ?? [null, 0];
    const [, addr] = replies[i * PER_ACTOR + 2] ?? [null, 0];
    // an unreadable mark is treated as a mark: folding an erased person's day is worse than missing one day of a baseline
    const [e4, mark] = replies[i * PER_ACTOR + 3] ?? [new Error('short'), 1];
    if (e4 || Number(mark) > 0) { erased.n += 1; return; }
    if (e1 || !hash || typeof hash !== 'object') return;
    const list = out.get(tenantId) ?? [];
    list.push({ kind: a.kind, hash: a.hash, hashFields: hash as Record<string, string>, subjects: Number(subj) || 0, addresses: Number(addr) || 0 });
    out.set(tenantId, list);
  });
  return out;
}

/** Folds one tenant's actors of the day; answers rows written and priors written. */
export async function foldTenantDay(
  tenantId: string, day: string, actors: readonly ActorDay[], inTenant: BaselineJobDeps['inTenant'],
): Promise<{ written: number; priors: number; skipped: number }> {
  return inTenant(tenantId, async (db) => {
    const days = actors.map((a) => ({ a, profile: dayProfileOf(a.hashFields, a.subjects, a.addresses) }));
    const active = days.filter((d) => isActiveDay(d.profile));
    const skipped = days.length - active.length;
    if (active.length === 0) return { written: 0, priors: 0, skipped };
    const roles = new Set(active.map((d) => (d.a.kind === 'apiKey' ? API_KEY_ROLE : d.profile.role)).filter((r): r is string => !!r));
    const stored = await readBaselines(db, tenantId, [
      ...active.map((d) => ({ kind: d.a.kind, key: d.a.hash })),
      ...[...roles].map((r) => ({ kind: ROLE_KIND, key: r })),
    ]);
    const byKey = new Map(stored.map((r) => [`${r.actorKind}|${r.actorKey}`, r]));
    const rows: BaselineRow[] = [];
    const byRole = new Map<string, BaselineData[]>();
    for (const { a, profile } of active) {
      const prev = byKey.get(`${a.kind}|${a.hash}`) ?? null;
      const next = updateBaseline(prev, profile, day);
      if (next === prev) continue;
      const role = a.kind === 'apiKey' ? API_KEY_ROLE : profile.role;
      rows.push({ actorKind: a.kind, actorKey: a.hash, role: a.kind === 'apiKey' ? null : profile.role, ...next });
      if (role) byRole.set(role, [...(byRole.get(role) ?? []), next.data]);
    }
    let priors = 0;
    for (const [role, members] of byRole) {
      const prev = byKey.get(`${ROLE_KIND}|${role}`) ?? null;
      const next = updateRolePrior(prev, members, day);
      if (!next || next === prev) continue;
      rows.push({ actorKind: ROLE_KIND, actorKey: role, role: null, ...next });
      priors += 1;
    }
    const written = await upsertBaselines(db, tenantId, rows);
    return { written: Math.max(0, written - priors), priors, skipped };
  });
}

/** One run for `day` (default yesterday, UTC). Never throws for one tenant. Shared by the worker job and tests. */
export async function runBaselineJob(now: Date = new Date(), deps?: BaselineJobDeps, day: string = dayOf(now.getTime() - 86_400_000)): Promise<BaselineJobSummary> {
  const d = deps ?? (await defaultDeps());
  const summary: BaselineJobSummary = { day, actors: 0, written: 0, priors: 0, skipped: 0, failedTenants: 0 };
  const batch = d.batch ?? BASELINE_BATCH;
  const max = d.maxActors ?? BASELINE_MAX_ACTORS;
  let cursor = '0';
  do {
    let members: string[];
    try {
      [cursor, members] = await d.redis.sscan(activeActorsKey(day), cursor, 'COUNT', batch);
    } catch (err) {
      Logger.warn(`[CronJob:${QUEUE_NAME}] the day's work list is unreadable (run ends): ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    const take = members.slice(0, Math.max(0, max - summary.actors));
    summary.actors += take.length;
    if (take.length) {
      let tenants: Map<string, ActorDay[]>;
      const erased = { n: 0 };
      try {
        tenants = await readBatch(d.redis, day, take, erased);
        summary.skipped += erased.n;
      } catch (err) {
        Logger.warn(`[CronJob:${QUEUE_NAME}] a batch of day profiles is unreadable: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const [tenantId, actors] of tenants) {
        try {
          const r = await foldTenantDay(tenantId, day, actors, d.inTenant);
          summary.written += r.written;
          summary.priors += r.priors;
          summary.skipped += r.skipped;
        } catch (err) {
          summary.failedTenants += 1;
          Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} baselines failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } while (cursor !== '0' && summary.actors < max);
  Logger.info(`[CronJob:${QUEUE_NAME}] day=${day} actors=${summary.actors} written=${summary.written} priors=${summary.priors} skipped=${summary.skipped} failedTenants=${summary.failedTenants}`);
  return summary;
}

async function defaultDeps(): Promise<BaselineJobDeps> {
  const [{ default: redis }, { withTenantTransactionFor }] = await Promise.all([
    import('@kuraykaraaslan-labs/redis'),
    import('@kuraykaraaslan-labs/db'),
  ]);
  return {
    redis: redis as unknown as BaselineJobRedis,
    inTenant: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
  };
}

/* ──────────────────────────────── The schedule ──────────────────────────────── */

let worker: Worker | null = null;
let scheduled = false;

/** `common:boot_task` (scheduler phase; single-owner, so the leader runs it): the daily run, one at a time. */
export async function scheduleBaselineJob(cronPattern = '20 0 * * *'): Promise<void> {
  if (scheduled) return;
  scheduled = true;
  const [{ createQueue, createWorker }, { registerWorkerDrain }, { runWithJobContext }] = await Promise.all([
    import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('@kuraykaraaslan-labs/logger/server/logger.request-context'),
  ]);
  const queue = createQueue(QUEUE_NAME, { defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } });
  worker ??= createWorker(QUEUE_NAME, async () => runWithJobContext(QUEUE_NAME, () => runBaselineJob()), { concurrency: 1 });
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  await queue.add('fold', {}, { repeat: { pattern: cronPattern }, jobId: `${QUEUE_NAME}-recurring` });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`);
}
