import 'reflect-metadata';
import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { baselineDataOf, type Baseline } from './ai_firewall.baseline';

/**
 * The baselines table (`ai_firewall_baselines`, migration 002): read and upsert in a tenant's own scope (RLS applies), and a small
 * in-process cache for the feature vector, which needs an actor's baseline and its role prior on every scoring.
 */
export const BASELINES_TABLE = 'ai_firewall_baselines';
export const BASELINE_ACTOR_KINDS = ['user', 'apiKey'] as const;
export const ROLE_KIND = 'role';
/** The prior of API keys (they have no member role). */
export const API_KEY_ROLE = 'API_KEY';

export interface BaselineRow extends Baseline {
  actorKind: string;
  actorKey: string;
  role: string | null;
}

interface DbRow {
  actorKind: string;
  actorKey: string;
  role: string | null;
  days: number | string;
  lastDay: string;
  data: unknown;
}

const toRow = (r: DbRow): BaselineRow => ({
  actorKind: r.actorKind, actorKey: r.actorKey, role: r.role ?? null, days: Number(r.days) || 0, lastDay: String(r.lastDay), data: baselineDataOf(r.data),
});

/** The stored rows of one tenant for these (kind, key) pairs. */
export async function readBaselines(db: SqlRunner, tenantId: string, keys: ReadonlyArray<{ kind: string; key: string }>): Promise<BaselineRow[]> {
  if (keys.length === 0) return [];
  const result = await db.query(
    `SELECT b."actorKind", b."actorKey", b."role", b."days", b."lastDay", b."data"
       FROM "${BASELINES_TABLE}" b
       JOIN jsonb_to_recordset($2::jsonb) AS k("kind" text, "key" text) ON b."actorKind" = k."kind" AND b."actorKey" = k."key"
      WHERE b."tenantId" = $1`,
    [tenantId, JSON.stringify(keys.map((k) => ({ kind: k.kind, key: k.key })))],
  );
  return rowsOf<DbRow>(result).map(toRow);
}

/**
 * Writes rows of one tenant in one statement. A row whose stored `lastDay` is already the same or later is left as it is (two runs of
 * the job for one day, or a run that raced another, never fold a day twice). Answers the rows written.
 */
export async function upsertBaselines(db: SqlRunner, tenantId: string, rows: readonly BaselineRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await db.query(
    `WITH w AS (
       INSERT INTO "${BASELINES_TABLE}" ("tenantId", "actorKind", "actorKey", "role", "days", "lastDay", "data", "updatedAt")
       SELECT $1::uuid, r."actorKind", r."actorKey", r."role", r."days", r."lastDay", r."data", now()
         FROM jsonb_to_recordset($2::jsonb) AS r("actorKind" text, "actorKey" text, "role" text, "days" int, "lastDay" text, "data" jsonb)
       ON CONFLICT ("tenantId", "actorKind", "actorKey") DO UPDATE SET
         "role" = EXCLUDED."role", "days" = EXCLUDED."days", "lastDay" = EXCLUDED."lastDay", "data" = EXCLUDED."data", "updatedAt" = now()
       WHERE "${BASELINES_TABLE}"."lastDay" < EXCLUDED."lastDay"
       RETURNING 1)
     SELECT count(*)::int AS n FROM w`,
    [tenantId, JSON.stringify(rows.map((r) => ({
      actorKind: r.actorKind, actorKey: r.actorKey, role: r.role, days: r.days, lastDay: r.lastDay, data: r.data,
    })))],
  );
  return Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0);
}

/* ──────────────────────────────── The scoring side's cache ──────────────────────────────── */

export const BASELINE_CACHE_MS = 10 * 60_000;
const CACHE_MAX = 10_000;
const cache = new Map<string, { until: number; value: { baseline: Baseline | null; prior: Baseline | null } }>();

export interface BaselineLookupDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  now?: () => number;
}

async function defaultInTenant<T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>): Promise<T> {
  const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db');
  return withTenantTransactionFor(tenantId, (qr) => fn(qr));
}

/**
 * An actor's own baseline and its role's prior (cached BASELINE_CACHE_MS; baselines change once a day). Never throws: a database that
 * cannot answer gives none (the behaviour features are then missing, FWA-7).
 */
export async function baselineAndPrior(
  tenantId: string, actor: { kind: string; key: string }, role: string | null, deps: Partial<BaselineLookupDeps> = {},
): Promise<{ baseline: Baseline | null; prior: Baseline | null }> {
  const now = (deps.now ?? Date.now)();
  const priorKey = actor.kind === 'apiKey' ? API_KEY_ROLE : role;
  const id = `${tenantId}|${actor.kind}|${actor.key}|${priorKey ?? ''}`;
  const hit = cache.get(id);
  if (hit && hit.until > now) return hit.value;
  try {
    const keys = [{ kind: actor.kind, key: actor.key }, ...(priorKey ? [{ kind: ROLE_KIND, key: priorKey }] : [])];
    const rows = await (deps.inTenant ?? defaultInTenant)(tenantId, (db) => readBaselines(db, tenantId, keys));
    const own = rows.find((r) => r.actorKind === actor.kind && r.actorKey === actor.key) ?? null;
    const prior = priorKey ? rows.find((r) => r.actorKind === ROLE_KIND && r.actorKey === priorKey) ?? null : null;
    const value = { baseline: own, prior };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(id, { until: now + BASELINE_CACHE_MS, value });
    return value;
  } catch {
    return { baseline: null, prior: null };
  }
}

/** Test seam. */
export function clearBaselineCache(): void {
  cache.clear();
}
