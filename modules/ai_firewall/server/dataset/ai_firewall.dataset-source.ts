import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { LABELS_TABLE } from '../labels/ai_firewall.label-store';
import type { LabelSource } from '../labels/ai_firewall.label-model';
import type { ExportLabelRow } from './ai_firewall.dataset-export';

/**
 * The dataset export's reads (docs/phases/55-ai-firewall/03 §3.5): the labels of each tenant that kept vectors, in that tenant's own
 * transaction (tenant RLS applies: least privilege, no bypass role; the platform's labels are the ROOT tenant's rows). Only the columns
 * the pure core turns into allow-listed values are selected: never `labelledBy`, `kind`, `detectors` or anything else. Bounded per
 * tenant (EXPORT_TENANT_MAX, oldest first, the cut counted); a tenant whose read fails is counted and the export goes on. Only the label
 * sources the install's role exports are read (`EXPORT_SOURCES`, D55-92: the demo its benign traffic only); the others are counted.
 */
export const EXPORT_TENANT_MAX = 200_000;

const T = `"${LABELS_TABLE}"`;

export const EXPORT_SELECT_SQL = `SELECT "tenantId", "refKind", "refId", "refAt", "actorKind", "actorId", "lane", "labelClass", "verdict", "source",
    "confidence", "runId", "vectors"
  FROM ${T} WHERE "tenantId" = $1 AND "vectors" IS NOT NULL AND "refAt" >= $2::timestamptz AND "source" = ANY($4::text[])
  ORDER BY "refAt", "labelId" LIMIT $3`;

export const EXPORT_WITHOUT_VECTORS_SQL = `SELECT count(*)::int AS n FROM ${T}
  WHERE "tenantId" = $1 AND "vectors" IS NULL AND "refAt" >= $2::timestamptz AND "source" = ANY($3::text[])`;

/** The labels of a source the role does not export (counted, never read). */
export const EXPORT_SOURCE_REFUSED_SQL = `SELECT count(*)::int AS n FROM ${T}
  WHERE "tenantId" = $1 AND "refAt" >= $2::timestamptz AND NOT ("source" = ANY($3::text[]))`;

export interface DatasetSourceDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
}

export const defaultDatasetSourceDeps: DatasetSourceDeps = {
  inTenant: async (tenantId, fn) => {
    await import('reflect-metadata');
    const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db');
    return withTenantTransactionFor(tenantId, (qr) => fn(qr));
  },
};

export interface ExportSource {
  rows: ExportLabelRow[];
  withoutVectors: number;
  /** Labels of a source the role does not export. */
  sourceRefused: number;
  tenantsFailed: number;
  tenantsTruncated: number;
}

const countOf = (rows: unknown): number => Number(rowsOf<{ n: unknown }>(rows)[0]?.n ?? 0) || 0;

/**
 * Every listed tenant's labels of `sources` with vectors whose behaviour happened at or after `since`. Never throws for one tenant.
 * `sources` is required (the caller passes `EXPORT_SOURCES[role]`): an empty list reads nothing.
 */
export async function readExportLabels(
  tenantIds: readonly string[], since: Date, sources: readonly LabelSource[],
  deps: DatasetSourceDeps = defaultDatasetSourceDeps, perTenant: number = EXPORT_TENANT_MAX,
): Promise<ExportSource> {
  const out: ExportSource = { rows: [], withoutVectors: 0, sourceRefused: 0, tenantsFailed: 0, tenantsTruncated: 0 };
  const sinceIso = since.toISOString();
  const allowed = [...new Set(sources)];
  for (const tenantId of [...new Set(tenantIds)]) {
    try {
      const { rows, without, refused } = await deps.inTenant(tenantId, async (db) => ({
        rows: rowsOf<ExportLabelRow>(await db.query(EXPORT_SELECT_SQL, [tenantId, sinceIso, perTenant + 1, allowed])),
        without: countOf(await db.query(EXPORT_WITHOUT_VECTORS_SQL, [tenantId, sinceIso, allowed])),
        refused: countOf(await db.query(EXPORT_SOURCE_REFUSED_SQL, [tenantId, sinceIso, allowed])),
      }));
      if (rows.length > perTenant) out.tenantsTruncated += 1;
      for (const r of rows.slice(0, perTenant)) out.rows.push(r);
      out.withoutVectors += without;
      out.sourceRefused += refused;
    } catch {
      out.tenantsFailed += 1;
    }
  }
  return out;
}
