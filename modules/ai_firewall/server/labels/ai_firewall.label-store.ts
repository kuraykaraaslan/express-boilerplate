import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { INCIDENTS_TABLE } from '../store/ai_firewall.store';
import {
  incidentLabelViewOf, verdictCountsOf, type DetectorVerdictCounts, type IncidentLabel, type LabelWrite,
} from './ai_firewall.label-model';

/**
 * The label store's statements (docs/phases/55-ai-firewall/03 §3.1, `ai_firewall_labels`, migration 004). Every statement runs in the
 * caller's tenant transaction (RLS applies; the platform's labels are the ROOT tenant's rows). At most one label per reference and source
 * (`uq_ai_firewall_labels_ref`): a system source writes once and a redelivered event writes nothing twice (`keep`, ON CONFLICT DO
 * NOTHING); a person's later verdict on an incident replaces the earlier one (`replace`).
 */
export const LABELS_TABLE = 'ai_firewall_labels';

export const LABEL_COLUMNS = [
  'tenantId', 'refKind', 'refId', 'refAt', 'actorKind', 'actorId', 'lane', 'kind', 'detectors', 'labelClass', 'verdict', 'source',
  'confidence', 'labelledBy', 'labelledBySystem', 'labelledAt', 'runId', 'vectors',
] as const satisfies readonly (keyof LabelWrite)[];

/** Rows per INSERT: 18 parameters each, far under Postgres's 65 535. */
export const LABEL_INSERT_CHUNK = 200;

const CAST: Partial<Record<(typeof LABEL_COLUMNS)[number], string>> = {
  tenantId: '::uuid', refAt: '::timestamptz', detectors: '::jsonb', confidence: '::double precision', labelledBy: '::uuid', labelledAt: '::timestamptz',
};

/** What a person's later verdict replaces (the reference, the actor and the source stay; the vectors are the incident's peak's now). */
const REPLACED = ['detectors', 'labelClass', 'verdict', 'confidence', 'labelledBy', 'labelledBySystem', 'labelledAt', 'vectors'] as const;

/**
 * The value of one row's `vectors` (03 §3.5, D55-88): its own (an event label's, read when it was produced), else, for an incident, the
 * incident's peak vectors read in the same statement (null on a production install, which keeps none). The subquery reuses the row's
 * tenant and reference parameters with the types their own slots give them (uuid, varchar), so no parameter is deduced twice.
 */
function vectorsSlot(row: LabelWrite, own: number, tenant: number, ref: number): string {
  if (row.refKind !== 'incident') return `$${own}::jsonb`;
  return `COALESCE($${own}::jsonb, (SELECT i."peakVectors" FROM "${INCIDENTS_TABLE}" i WHERE i."tenantId" = $${tenant}::uuid AND i."incidentId"::text = $${ref}::varchar))`;
}

/** The INSERT of `rows` and its parameters, in LABEL_COLUMNS order. `keep`: a label already there stays; `replace`: it is replaced. */
export function labelInsertStatement(rows: readonly LabelWrite[], onConflict: 'keep' | 'replace'): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const slot: Partial<Record<(typeof LABEL_COLUMNS)[number], number>> = {};
    return `(${LABEL_COLUMNS.map((column) => {
      const value = row[column];
      params.push(column === 'detectors' ? JSON.stringify(value ?? []) : column === 'vectors' ? (value ? JSON.stringify(value) : null) : value);
      slot[column] = params.length;
      if (column === 'vectors') return vectorsSlot(row, params.length, slot.tenantId!, slot.refId!);
      return `$${params.length}${CAST[column] ?? ''}`;
    }).join(', ')})`;
  });
  const conflict = onConflict === 'keep'
    ? 'DO NOTHING'
    : `DO UPDATE SET ${REPLACED.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}, "updatedAt" = now()`;
  return {
    sql: `INSERT INTO "${LABELS_TABLE}" (${LABEL_COLUMNS.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}
      ON CONFLICT ("tenantId", "refKind", "refId", "source") ${conflict} RETURNING "labelId"`,
    params,
  };
}

/**
 * Writes system labels once (a reference already labelled by the same source is skipped); answers how many were new. Every row must
 * belong to `tenantId` (the policy's WITH CHECK refuses another tenant's row anyway).
 */
export async function insertLabels(db: SqlRunner, tenantId: string, rows: readonly LabelWrite[]): Promise<number> {
  if (rows.length === 0) return 0;
  if (rows.some((r) => r.tenantId !== tenantId)) throw new Error('insertLabels: every label must belong to the tenant it is written for');
  let inserted = 0;
  for (let i = 0; i < rows.length; i += LABEL_INSERT_CHUNK) {
    const { sql, params } = labelInsertStatement(rows.slice(i, i + LABEL_INSERT_CHUNK), 'keep');
    inserted += rowsOf(await db.query(sql, params)).length;
  }
  return inserted;
}

/** Writes a person's label of an incident, replacing their source's earlier one. */
export async function upsertIncidentLabel(db: SqlRunner, row: LabelWrite): Promise<void> {
  const { sql, params } = labelInsertStatement([row], 'replace');
  await db.query(sql, params);
}

/** The person's (source admin) label of one incident, or null. */
export async function readIncidentLabel(db: SqlRunner, tenantId: string, incidentId: string): Promise<IncidentLabel | null> {
  const rows = rowsOf<Record<string, unknown>>(await db.query(
    `SELECT "verdict", "labelClass", "confidence", "labelledBy", "labelledAt" FROM "${LABELS_TABLE}"
      WHERE "tenantId" = $1 AND "refKind" = 'incident' AND "refId" = $2 AND "source" = 'admin'`,
    [tenantId, incidentId],
  ));
  return incidentLabelViewOf(rows[0]);
}

/** Withdraws an incident's false-positive verdict (its reopen: the case is open again, D55-79); answers whether one was there. */
export async function withdrawFalsePositive(db: SqlRunner, tenantId: string, incidentId: string): Promise<boolean> {
  const rows = rowsOf(await db.query(
    `DELETE FROM "${LABELS_TABLE}" WHERE "tenantId" = $1 AND "refKind" = 'incident' AND "refId" = $2 AND "source" = 'admin'
       AND "verdict" = 'false_positive' RETURNING "labelId"`,
    [tenantId, incidentId],
  ));
  return rows.length > 0;
}

/** The per-detector counter's statement: every person's verdict on an incident, once under each detector the incident had. */
export const VERDICT_COUNTS_SQL = `SELECT d."detector", l."verdict", count(*)::int AS n
  FROM "${LABELS_TABLE}" l CROSS JOIN LATERAL jsonb_array_elements_text(l."detectors") AS d("detector")
 WHERE l."tenantId" = $1 AND l."refKind" = 'incident' AND l."source" = 'admin' AND l."verdict" IS NOT NULL
 GROUP BY d."detector", l."verdict"`;

export interface LabelCountDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
}

const defaultCountDeps: LabelCountDeps = {
  inTenant: async (tenantId, fn) => {
    await import('reflect-metadata');
    const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db');
    return withTenantTransactionFor(tenantId, (qr) => fn(qr));
  },
};

/**
 * The tenant's true positives, false positives and unsure verdicts per detector (`score.rules` for incidents of many weak signs), over
 * the labels the retention keeps: the read the per-tenant threshold calibration of 04.8 starts from. No calibration here (D55-80).
 */
export async function detectorVerdictCounts(tenantId: string, deps: LabelCountDeps = defaultCountDeps): Promise<DetectorVerdictCounts> {
  return deps.inTenant(tenantId, async (db) => verdictCountsOf(rowsOf<{ detector: unknown; verdict: unknown; n: unknown }>(await db.query(VERDICT_COUNTS_SQL, [tenantId]))));
}
