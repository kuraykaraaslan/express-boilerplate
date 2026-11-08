import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { SHADOW_MODELS, type ShadowModelId } from '../detect/ai_firewall.risk';
import type { GateVerdict, ModelStateRecord, StoredDrift, StateChange } from './ai_firewall.promotion-model';

/**
 * The promotion store's statements (docs/phases/55-ai-firewall/04-tree-models.md 4.7, `ai_firewall_model_states`, migration 008): one row
 * per tree model, the platform's, under the ROOT tenant, read and written in ROOT's own transaction (RLS applies). A writer reads the row
 * FOR UPDATE first, so the daily gate and an owner's hold never overwrite each other.
 *
 * Audited (FWD-12: the pipeline promotes on its own, so every change it makes is on record): `ai_firewall.model_promoted` and
 * `ai_firewall.model_demoted` by the gate (a SYSTEM row) or a hold, `ai_firewall.model_held` and `ai_firewall.model_released` by a ROOT
 * owner (a USER row with the owner's reason). Each is also a signal kind of this module.
 */
export const MODEL_STATES_TABLE = 'ai_firewall_model_states';

export const AUDIT_MODEL_PROMOTED = 'ai_firewall.model_promoted';
export const AUDIT_MODEL_DEMOTED = 'ai_firewall.model_demoted';
export const AUDIT_MODEL_HELD = 'ai_firewall.model_held';
export const AUDIT_MODEL_RELEASED = 'ai_firewall.model_released';

const T = `"${MODEL_STATES_TABLE}"`;

export const STATE_COLUMNS = [
  'modelSha256', 'state', 'shadowStartedAt', 'promotedAt', 'demotedAt', 'demotedReason', 'heldAt', 'lastEvaluatedAt', 'verdict', 'drift',
] as const satisfies readonly (keyof ModelStateRecord)[];
const CAST: Partial<Record<(typeof STATE_COLUMNS)[number], string>> = {
  shadowStartedAt: '::timestamptz', promotedAt: '::timestamptz', demotedAt: '::timestamptz', heldAt: '::timestamptz',
  lastEvaluatedAt: '::timestamptz', verdict: '::jsonb', drift: '::jsonb',
};

export const STATE_SELECT_SQL = `SELECT "model", ${STATE_COLUMNS.map((c) => `"${c}"`).join(', ')} FROM ${T} WHERE "tenantId" = $1 ORDER BY "model"`;
export const STATE_LOCK_SQL = `SELECT "model", ${STATE_COLUMNS.map((c) => `"${c}"`).join(', ')} FROM ${T} WHERE "tenantId" = $1 AND "model" = $2 FOR UPDATE`;

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const json = <X>(v: unknown): X | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as X; } catch { return null; }
  }
  return typeof v === 'object' ? (v as X) : null;
};

/** A database row as a state record (null for a row of an unknown model). Pure. */
export function stateRecordOf(row: Record<string, unknown> | undefined): ModelStateRecord | null {
  if (!row || !(SHADOW_MODELS as readonly unknown[]).includes(row.model)) return null;
  return {
    model: row.model as ShadowModelId,
    modelSha256: typeof row.modelSha256 === 'string' && row.modelSha256 ? row.modelSha256.toLowerCase() : null,
    state: row.state === 'promoted' ? 'promoted' : 'shadow',
    shadowStartedAt: iso(row.shadowStartedAt),
    promotedAt: iso(row.promotedAt),
    demotedAt: iso(row.demotedAt),
    demotedReason: typeof row.demotedReason === 'string' ? row.demotedReason : null,
    heldAt: iso(row.heldAt),
    lastEvaluatedAt: iso(row.lastEvaluatedAt),
    verdict: json<GateVerdict>(row.verdict),
    drift: json<StoredDrift>(row.drift),
  };
}

/** The INSERT … ON CONFLICT DO UPDATE of one state row (ROOT's). Pure. */
export function upsertStateStatement(r: ModelStateRecord): { sql: string; params: unknown[] } {
  const params: unknown[] = [ROOT_TENANT_ID, r.model, ...STATE_COLUMNS.map((c) => (c === 'verdict' || c === 'drift' ? (r[c] ? JSON.stringify(r[c]) : null) : r[c]))];
  const slots = STATE_COLUMNS.map((c, i) => `$${i + 3}${CAST[c] ?? ''}`);
  return {
    sql: `INSERT INTO ${T} ("tenantId", "model", ${STATE_COLUMNS.map((c) => `"${c}"`).join(', ')}) VALUES ($1::uuid, $2, ${slots.join(', ')})
      ON CONFLICT ("tenantId", "model") DO UPDATE SET ${STATE_COLUMNS.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}, "updatedAt" = now()`,
    params,
  };
}

export async function readStates(db: SqlRunner): Promise<Map<ShadowModelId, ModelStateRecord>> {
  const rows = rowsOf<Record<string, unknown>>(await db.query(STATE_SELECT_SQL, [ROOT_TENANT_ID]));
  const out = new Map<ShadowModelId, ModelStateRecord>();
  for (const row of rows) {
    const r = stateRecordOf(row);
    if (r) out.set(r.model, r);
  }
  return out;
}

export async function lockState(db: SqlRunner, model: ShadowModelId): Promise<ModelStateRecord | null> {
  return stateRecordOf(rowsOf<Record<string, unknown>>(await db.query(STATE_LOCK_SQL, [ROOT_TENANT_ID, model]))[0]);
}

export async function writeState(db: SqlRunner, r: ModelStateRecord): Promise<void> {
  const { sql, params } = upsertStateStatement(r);
  await db.query(sql, params);
}

export interface PromotionStoreDeps {
  /** ROOT's own transaction (the platform's rows). */
  inRoot: <X>(fn: (db: SqlRunner) => Promise<X>) => Promise<X>;
  audit: (row: Record<string, unknown>) => Promise<void>;
}

/** The database and the audit log are imported on first use. */
export const defaultPromotionStoreDeps: PromotionStoreDeps = {
  inRoot: async (fn) => {
    await import('reflect-metadata');
    const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db');
    return withTenantTransactionFor(ROOT_TENANT_ID, (qr) => fn(qr));
  },
  audit: async (row) => {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log(row as never);
  },
};

/** The audit row of a change of state (pure): what changed, the model, its short sha and why; never a feature value or an actor. */
export function stateAuditRow(
  model: ShadowModelId, change: Exclude<StateChange, 'reset' | 'none'> | 'held' | 'released', record: ModelStateRecord,
  reason: string | null, actorId: string | null, note: string | null = null,
): Record<string, unknown> {
  const action = change === 'promoted' ? AUDIT_MODEL_PROMOTED : change === 'demoted' ? AUDIT_MODEL_DEMOTED : change === 'held' ? AUDIT_MODEL_HELD : AUDIT_MODEL_RELEASED;
  return {
    tenantId: ROOT_TENANT_ID,
    actorId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    action,
    // A promotion lets the cascade act on requests: high. A demotion or a hold takes protection away from the models (the rules stay): medium.
    severity: change === 'promoted' ? 'high' : 'medium',
    resourceType: 'ai_firewall_model',
    resourceId: model,
    metadata: {
      model,
      sha: record.modelSha256 ? record.modelSha256.slice(0, 12) : null,
      state: record.state,
      ...(reason ? { reason: reason.slice(0, 256) } : {}),
      ...(note ? { note: note.slice(0, 200) } : {}),
    },
  };
}
