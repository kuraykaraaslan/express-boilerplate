import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { INCIDENTS_TABLE, type IncidentStatus } from '../store/ai_firewall.store';
import type { ScoredDetection } from '../detect/ai_firewall.risk';
import {
  INCIDENT_MAX_SPAN_MS, INCIDENT_QUIET_HOURS, INCIDENT_QUIET_MS, expiredAt, isStale, mergeInto, mergeModels, openFrom, setsPeak,
  type IncidentModels, type IncidentRecord, type IncidentSeverity, type IncidentWrite,
} from './ai_firewall.incident-model';

/**
 * The incident grouping's writes (docs/phases/55-ai-firewall/02 §2.4, D55-36, D55-37): one scored detection into the actor's incident,
 * the nightly expiry of quiet incidents, and the row shape the pages read (`recordOf`). Every statement runs in the tenant's own transaction on its own
 * DataSource (RLS applies; the platform's incidents are the ROOT tenant's rows). Raw SQL over the table of migrations 001 and 003; the
 * rules are the pure `ai_firewall.incident-model.ts`.
 *
 * Deduplication across worker processes: the active incident of the actor is read FOR UPDATE; when there is none the INSERT meets the
 * partial unique index of migration 003 (`ON CONFLICT … DO NOTHING`) if another worker opened one meanwhile, and the scoring then joins
 * that one (read again: in READ COMMITTED a new statement sees the other transaction's committed row). Two tries, then `conflict`.
 */
export interface IncidentStoreDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
}

/** The database is imported on first use, so the retention job and the pure readers load this file without a connection. */
export const defaultIncidentStoreDeps: IncidentStoreDeps = {
  inTenant: async (tenantId, fn) => {
    await import('reflect-metadata');
    const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db');
    return withTenantTransactionFor(tenantId, (qr) => fn(qr));
  },
};

const T = `"${INCIDENTS_TABLE}"`;

/** Every column the grouping and the pages read. */
export const INCIDENT_SELECT = `"incidentId", "tenantId", "status", "severity", "actorKind", "actorId", "lane", "score", "peakScore", "peakAt",
  "reason", "openedAt", "lastSignalAt", "closedAt", "closedBy", "closeReason", "acknowledgedAt", "acknowledgedBy", "platform", "alertsOnly",
  "coldStart", "scorings", "detections", "explanation", "history", "models"`;

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
};

/** A database row as an IncidentRecord (times as ISO strings, jsonb parsed when the driver handed a string). */
export function recordOf(row: Record<string, unknown> | undefined): IncidentRecord | null {
  if (!row) return null;
  return {
    incidentId: String(row.incidentId),
    tenantId: String(row.tenantId),
    status: String(row.status) as IncidentStatus,
    severity: String(row.severity) as IncidentSeverity,
    actorKind: String(row.actorKind),
    actorId: String(row.actorId),
    lane: String(row.lane ?? 'unknown'),
    score: num(row.score),
    peakScore: num(row.peakScore),
    peakAt: iso(row.peakAt),
    reason: (row.reason as string | null) ?? null,
    openedAt: iso(row.openedAt) ?? new Date(0).toISOString(),
    lastSignalAt: iso(row.lastSignalAt) ?? new Date(0).toISOString(),
    closedAt: iso(row.closedAt),
    closedBy: (row.closedBy as string | null) ?? null,
    closeReason: (row.closeReason as string | null) ?? null,
    acknowledgedAt: iso(row.acknowledgedAt),
    acknowledgedBy: (row.acknowledgedBy as string | null) ?? null,
    platform: row.platform === true,
    alertsOnly: row.alertsOnly === true,
    coldStart: row.coldStart === true,
    scorings: num(row.scorings) ?? 0,
    detections: json(row.detections, {}),
    explanation: json(row.explanation, null),
    history: json(row.history, []),
    models: json<IncidentModels | null>(row.models, null),
  };
}

export const SELECT_ACTIVE_SQL = `SELECT ${INCIDENT_SELECT} FROM ${T}
  WHERE "tenantId" = $1 AND "actorKind" = $2 AND "actorId" = $3 AND "status" IN ('open', 'acknowledged') LIMIT 1 FOR UPDATE`;

export const EXPIRE_ONE_SQL = `UPDATE ${T} SET "status" = 'closed', "closeReason" = 'expired', "closedAt" = $3::timestamptz, "closedBy" = NULL,
  "updatedAt" = now() WHERE "tenantId" = $1 AND "incidentId" = $2 AND "status" IN ('open', 'acknowledged')`;

/** The columns a scoring writes, in INSERT and UPDATE order (after "tenantId", "actorKind", "actorId"). */
const WRITE_COLUMNS = [
  'status', 'severity', 'lane', 'score', 'peakScore', 'peakAt', 'reason', 'openedAt', 'lastSignalAt', 'platform', 'alertsOnly', 'coldStart',
  'scorings', 'detections', 'explanation', 'history',
] as const satisfies readonly (keyof IncidentWrite)[];
const CAST: Partial<Record<(typeof WRITE_COLUMNS)[number], string>> = {
  peakAt: '::timestamptz', openedAt: '::timestamptz', lastSignalAt: '::timestamptz', detections: '::jsonb', explanation: '::jsonb', history: '::jsonb',
};
const valueOf = (w: IncidentWrite, column: (typeof WRITE_COLUMNS)[number]): unknown =>
  (column === 'detections' || column === 'explanation' || column === 'history' ? JSON.stringify(w[column]) : w[column]);

export function insertIncidentStatement(tenantId: string, actorKind: string, actorId: string, w: IncidentWrite): { sql: string; params: unknown[] } {
  const params: unknown[] = [tenantId, actorKind, actorId, ...WRITE_COLUMNS.map((c) => valueOf(w, c))];
  const slots = ['$1::uuid', '$2', '$3', ...WRITE_COLUMNS.map((c, i) => `$${i + 4}${CAST[c] ?? ''}`)];
  return {
    sql: `INSERT INTO ${T} ("tenantId", "actorKind", "actorId", ${WRITE_COLUMNS.map((c) => `"${c}"`).join(', ')})
      VALUES (${slots.join(', ')})
      ON CONFLICT ("tenantId", "actorKind", "actorId") WHERE "status" IN ('open', 'acknowledged') DO NOTHING
      RETURNING "incidentId"`,
    params,
  };
}

export function updateIncidentStatement(tenantId: string, incidentId: string, w: IncidentWrite): { sql: string; params: unknown[] } {
  const params: unknown[] = [tenantId, incidentId, ...WRITE_COLUMNS.map((c) => valueOf(w, c))];
  const sets = WRITE_COLUMNS.map((c, i) => `"${c}" = $${i + 3}${CAST[c] ?? ''}`);
  return { sql: `UPDATE ${T} SET ${sets.join(', ')}, "updatedAt" = now() WHERE "tenantId" = $1 AND "incidentId" = $2`, params };
}

export type RecordResult = 'opened' | 'joined' | 'reopened' | 'conflict';

/**
 * The peak scoring's vectors (03 §3.5, D55-88, migration 006): written with the scoring that opened the incident or raised its peak, only
 * when the detection carries them (the evaluator attaches them on a staging or demo install only). A label of the incident copies them.
 */
export const PEAK_VECTORS_SQL = `UPDATE ${T} SET "peakVectors" = $3::jsonb WHERE "tenantId" = $1 AND "incidentId" = $2`;

/**
 * 04.6: the tree models' tracks in shadow (migration 008), written with a scoring that carries model scores (`mergeModels` over the
 * incident's own tracks, read FOR UPDATE with the incident). One extra UPDATE, only when a model scored.
 */
export const MODELS_SQL = `UPDATE ${T} SET "models" = $3::jsonb WHERE "tenantId" = $1 AND "incidentId" = $2`;

/**
 * One scored detection into its actor's incident, in the detection's store tenant: joins the live active incident, or closes a stale
 * one as `expired` and opens a new one. Throws when the database throws (the recorder counts it; FWA-7: nothing waits on it).
 */
export async function recordDetection(d: ScoredDetection, nowMs: number = Date.now(), deps: IncidentStoreDeps = defaultIncidentStoreDeps): Promise<RecordResult> {
  const { tenantId } = d;
  return deps.inTenant(tenantId, async (db) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let active = recordOf(rowsOf<Record<string, unknown>>(await db.query(SELECT_ACTIVE_SQL, [tenantId, d.actor.kind, d.actor.id]))[0]);
      if (active && isStale(active, nowMs)) {
        await db.query(EXPIRE_ONE_SQL, [tenantId, active.incidentId, expiredAt(active, nowMs)]);
        active = null;
      }
      if (active) {
        const peaked = setsPeak(active, d);
        const w = mergeInto(active, d);
        const { sql, params } = updateIncidentStatement(tenantId, active.incidentId, w);
        await db.query(sql, params);
        if (d.vectors && peaked) await db.query(PEAK_VECTORS_SQL, [tenantId, active.incidentId, JSON.stringify(d.vectors)]);
        if (d.models) {
          const models = mergeModels(active.models ?? null, d);
          if (models) await db.query(MODELS_SQL, [tenantId, active.incidentId, JSON.stringify(models)]);
        }
        return w.status !== active.status ? 'reopened' : 'joined';
      }
      const { sql, params } = insertIncidentStatement(tenantId, d.actor.kind, d.actor.id, openFrom(d));
      const opened = rowsOf<{ incidentId?: unknown }>(await db.query(sql, params));
      if (opened.length > 0) {
        const incidentId = opened[0]?.incidentId;
        if (d.vectors && typeof incidentId === 'string' && incidentId) await db.query(PEAK_VECTORS_SQL, [tenantId, incidentId, JSON.stringify(d.vectors)]);
        if (d.models && typeof incidentId === 'string' && incidentId) {
          const models = mergeModels(null, d);
          if (models) await db.query(MODELS_SQL, [tenantId, incidentId, JSON.stringify(models)]);
        }
        return 'opened';
      }
    }
    return 'conflict';
  });
}

/**
 * The nightly expiry of one tenant (run by the retention job, ai_firewall.retention.job.ts): every active incident quiet for
 * INCIDENT_QUIET_HOURS, or opened more than INCIDENT_MAX_SPAN_MS ago, is closed as `expired`, `closedAt` = when it went quiet (never
 * later than now). The retention then deletes it once that is past the tenant's retention (2.8: an address in an incident is kept no
 * longer than the retention after its last activity, plus the quiet window). Answers how many it closed.
 */
export function expireQuietStatement(tenantId: string, now: Date): { sql: string; params: unknown[] } {
  return {
    sql: `WITH u AS (UPDATE ${T} SET "status" = 'closed', "closeReason" = 'expired', "closedBy" = NULL, "updatedAt" = now(),
            "closedAt" = LEAST("lastSignalAt" + interval '${INCIDENT_QUIET_HOURS} hours', $2::timestamptz)
          WHERE "tenantId" = $1 AND "status" IN ('open', 'acknowledged') AND ("lastSignalAt" < $3::timestamptz OR "openedAt" < $4::timestamptz)
          RETURNING 1) SELECT count(*)::int AS n FROM u`,
    params: [tenantId, now.toISOString(), new Date(now.getTime() - INCIDENT_QUIET_MS).toISOString(), new Date(now.getTime() - INCIDENT_MAX_SPAN_MS).toISOString()],
  };
}

export async function expireQuietIncidents(tenantId: string, now: Date, deps: IncidentStoreDeps = defaultIncidentStoreDeps): Promise<number> {
  return deps.inTenant(tenantId, async (db) => {
    const { sql, params } = expireQuietStatement(tenantId, now);
    return Number(rowsOf<{ n: number | string }>(await db.query(sql, params))[0]?.n ?? 0);
  });
}
