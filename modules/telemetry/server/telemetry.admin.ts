import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { BINDINGS_TABLE, KEYS_TABLE, latestTableOf } from './telemetry.classes';
import { ensureTelemetryKindsLoaded, laneOf, registeredTelemetryKinds } from './telemetry.kinds';
import { telemetryListenerStats } from './telemetry.listeners';
import { describeKind } from './telemetry.read';
import { TELEMETRY_LANES } from './telemetry.timeseries';
import { rawChunkInterval } from './telemetry.chunk-interval';

/** The admin page's data (docs/phases/42-telemetry/02 §2.7), read in the tenant's own scope. */
export interface StoreOverview {
  kinds: ReturnType<typeof describeKind>[];
  lanes: string[];
  rawChunkInterval: string;
  bindings: Array<{ kind: string; classDays: number; validFrom: string; validTo: string | null }>;
  keyCount: number;
  /** Latest rows (entity × key) per kind, by kind name. */
  latestRows: Array<{ kind: string; rows: number; entities: number }>;
  listeners: { queued: number; dropped: number; listeners: number };
}

export interface StoreOverviewDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
}

export async function readStoreOverview(d: StoreOverviewDeps, tenantId: string): Promise<StoreOverview> {
  await ensureTelemetryKindsLoaded();
  const kinds = registeredTelemetryKinds();
  const out = await d.inTenant(tenantId, async (db) => {
    const bindings = rowsOf<{ entityType: string; classDays: number; validFrom: Date | string; validTo: Date | string | null }>(await db.query(
      `SELECT "entityType", "classDays", "validFrom", "validTo" FROM "${BINDINGS_TABLE}" WHERE "tenantId" = $1 ORDER BY "entityType", "validFrom"`, [tenantId],
    ));
    const keyCount = Number(rowsOf<{ n: number }>(await db.query(`SELECT count(*)::int AS n FROM "${KEYS_TABLE}" WHERE "tenantId" = $1`, [tenantId]))[0]?.n ?? 0);
    const latestRows: StoreOverview['latestRows'] = [];
    for (const lane of TELEMETRY_LANES) {
      const rows = rowsOf<{ kind: string; rows: number; entities: number }>(await db.query(
        `SELECT k."kind", count(*)::int AS rows, count(DISTINCT l."entityId")::int AS entities
           FROM "${latestTableOf(lane)}" l JOIN "telemetry_kinds" k ON k."kindId" = l."kindId"
          WHERE l."tenantId" = $1 GROUP BY k."kind" ORDER BY k."kind"`, [tenantId],
      ));
      for (const r of rows) latestRows.push({ kind: r.kind, rows: Number(r.rows), entities: Number(r.entities) });
    }
    return { bindings, keyCount, latestRows };
  });
  return {
    kinds: kinds.map(describeKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    lanes: [...new Set([...TELEMETRY_LANES, ...kinds.map(laneOf)])],
    rawChunkInterval: rawChunkInterval(),
    bindings: out.bindings.map((b) => ({ kind: b.entityType, classDays: Number(b.classDays), validFrom: new Date(b.validFrom).toISOString(), validTo: b.validTo === null ? null : new Date(b.validTo).toISOString() })),
    keyCount: out.keyCount,
    latestRows: out.latestRows,
    listeners: telemetryListenerStats(),
  };
}

export async function storeOverview(tenantId: string): Promise<StoreOverview> {
  const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db/server/db.context');
  return readStoreOverview({ inTenant: (t, fn) => withTenantTransactionFor(t, (qr) => fn(qr)) }, tenantId);
}
