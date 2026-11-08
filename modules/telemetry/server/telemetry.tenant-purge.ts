import type { SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { TenantPurgeStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { RETENTION_CLASSES } from './telemetry.contract';
import { BINDINGS_TABLE, dayTableOf, dirtyTableOf, hourTableOf, KEYS_TABLE, latestTableOf, minuteTableOf, rawTableOf, stateTableOf } from './telemetry.classes';
import { keyHashOf } from './telemetry.key-dictionary';
import { TELEMETRY_LANES } from './telemetry.timeseries';

/**
 * The tenant purge (docs/phases/42-telemetry/02 §2.5): every row of the tenant in every lane's tables (raw, minute, hour and day
 * rollups, latest, state, hints), its class bindings and its key dictionary, in the tenant's own scope (RLS applies; the app role
 * deletes through the access views), then the Redis key hash. A table that is not deployed is skipped. Big raw tables make this
 * slow; a purge is rare and the cascade runs it detached.
 *
 * `purgeEntity`: the rows of one entity of one kind, for an owner that hard-deletes the entity.
 */
export interface PurgeDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  tableExists?: (db: SqlRunner, table: string) => Promise<boolean>;
  redisDel?: (key: string) => Promise<unknown>;
}

function laneTables(lane: string): string[] {
  return [
    ...RETENTION_CLASSES.flatMap((d) => [rawTableOf(d, lane), minuteTableOf(d, lane), hourTableOf(d, lane), dayTableOf(d, lane)]),
    latestTableOf(lane), stateTableOf(lane), dirtyTableOf(lane),
  ];
}

async function present(db: SqlRunner, table: string): Promise<boolean> {
  const res = (await db.query(`SELECT to_regclass($1) AS r`, [`"${table}"`])) as Array<{ r: string | null }> | { rows: Array<{ r: string | null }> };
  const rows = Array.isArray(res) ? res : res.rows;
  return rows[0]?.r != null;
}

export async function purgeTenantTelemetry(d: PurgeDeps, tenantId: string): Promise<{ tables: number }> {
  let tables = 0;
  await d.inTenant(tenantId, async (db) => {
    for (const lane of TELEMETRY_LANES) {
      for (const t of laneTables(lane)) {
        if (!(await (d.tableExists ?? present)(db, t))) continue;
        const rel = await d.accessRel(db, t);
        await db.query(`DELETE FROM ${rel} WHERE "tenantId" = $1`, [tenantId]);
        tables += 1;
      }
    }
    await db.query(`DELETE FROM "${BINDINGS_TABLE}" WHERE "tenantId" = $1`, [tenantId]);
    await db.query(`DELETE FROM "${KEYS_TABLE}" WHERE "tenantId" = $1`, [tenantId]);
    tables += 2;
  });
  await d.redisDel?.(keyHashOf(tenantId));
  return { tables };
}

/**
 * The rows of one lane under one tenant (raw, minute, hour and day rollups, latest, state, hints), nothing else: the key dictionary
 * and the class bindings are shared by every lane and stay. For a module that owns a lane and erases a tenant's signal (04 §4.2:
 * the OTel metrics adapter's `deleteTenantData`). Returns the tables it deleted from.
 */
export async function purgeLaneTelemetry(d: PurgeDeps, tenantId: string, lane: string): Promise<{ tables: number }> {
  let tables = 0;
  await d.inTenant(tenantId, async (db) => {
    for (const t of laneTables(lane)) {
      if (!(await (d.tableExists ?? present)(db, t))) continue;
      const rel = await d.accessRel(db, t);
      await db.query(`DELETE FROM ${rel} WHERE "tenantId" = $1`, [tenantId]);
      tables += 1;
    }
  });
  return { tables };
}

export async function purgeEntityTelemetry(d: PurgeDeps, tenantId: string, lane: string, entityId: string): Promise<void> {
  await d.inTenant(tenantId, async (db) => {
    for (const t of laneTables(lane)) {
      if (t === stateTableOf(lane) || t === dirtyTableOf(lane)) continue;
      if (!(await (d.tableExists ?? present)(db, t))) continue;
      const rel = await d.accessRel(db, t);
      await db.query(`DELETE FROM ${rel} WHERE "tenantId" = $1 AND "entityId" = $2`, [tenantId, entityId]);
    }
  });
}

export interface WindowedPurgeOptions {
  /** The span of one DELETE on a raw or minute table (ms). Default one day: a raw class keeps at most 90 days, so at most ~90 statements a table. */
  windowMs?: number;
  /** A rest between two statements so a big purge never holds the disk (ms). Default 50. */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WindowedPurgeReport {
  /** Tables the entity had rows in (or that were cleared whole). */
  tables: number;
  /** DELETE statements issued. */
  statements: number;
}

const DAY_MS = 86_400_000;
const rowsOf = (res: unknown): Array<Record<string, unknown>> => (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : ((res as { rows?: Array<Record<string, unknown>> }).rows ?? []));

/**
 * `purgeEntityTelemetry` for a big entity (a device with months of readings): the raw and minute tables go in time windows, each its
 * own tenant transaction, so no statement is long and the log and locks of one are released before the next (the primary key
 * `(tenantId, entityId, ts, ...)` serves every window). The hour and day rollups, the latest rows and the rest are small by comparison
 * and go after, whole, so a rollup pass that ran meanwhile cannot leave a bucket behind. Idempotent: a retry after a failure only
 * finds what is left.
 */
export async function purgeEntityTelemetryWindowed(
  d: PurgeDeps,
  tenantId: string,
  lane: string,
  entityId: string,
  o: WindowedPurgeOptions = {},
): Promise<WindowedPurgeReport> {
  const windowMs = Math.max(60_000, o.windowMs ?? DAY_MS);
  const pauseMs = Math.max(0, o.pauseMs ?? 50);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const report: WindowedPurgeReport = { tables: 0, statements: 0 };
  const exists = d.tableExists ?? present;

  const windowed = RETENTION_CLASSES.flatMap((c) => [rawTableOf(c, lane), minuteTableOf(c, lane)]);
  const whole = [
    ...RETENTION_CLASSES.flatMap((c) => [hourTableOf(c, lane), dayTableOf(c, lane)]),
    latestTableOf(lane),
  ];

  for (const t of windowed) {
    const bounds = await d.inTenant(tenantId, async (db) => {
      if (!(await exists(db, t))) return null;
      const rel = await d.accessRel(db, t);
      const row = rowsOf(await db.query(`SELECT min("ts") AS lo, max("ts") AS hi FROM ${rel} WHERE "tenantId" = $1 AND "entityId" = $2`, [tenantId, entityId]))[0];
      if (!row || row.lo == null || row.hi == null) return null;
      return { rel, lo: new Date(row.lo as string | Date).getTime(), hi: new Date(row.hi as string | Date).getTime() };
    });
    if (!bounds || !Number.isFinite(bounds.lo) || !Number.isFinite(bounds.hi)) continue;
    report.tables += 1;
    for (let from = bounds.lo; from <= bounds.hi; from += windowMs) {
      await d.inTenant(tenantId, async (db) => {
        await db.query(
          `DELETE FROM ${bounds.rel} WHERE "tenantId" = $1 AND "entityId" = $2 AND "ts" >= $3 AND "ts" < $4`,
          [tenantId, entityId, new Date(from).toISOString(), new Date(from + windowMs).toISOString()],
        );
      });
      report.statements += 1;
      if (pauseMs && from + windowMs <= bounds.hi) await sleep(pauseMs);
    }
  }

  await d.inTenant(tenantId, async (db) => {
    for (const t of whole) {
      if (!(await exists(db, t))) continue;
      const rel = await d.accessRel(db, t);
      await db.query(`DELETE FROM ${rel} WHERE "tenantId" = $1 AND "entityId" = $2`, [tenantId, entityId]);
      report.tables += 1;
      report.statements += 1;
    }
  });
  return report;
}

async function processDeps(): Promise<PurgeDeps> {
  const [{ withTenantTransactionFor }, { timeSeriesAccessRel }] = await Promise.all([
    import('@kuraykaraaslan-labs/db/server/db.context'),
    import('@kuraykaraaslan-labs/db/server/db.time-series'),
  ]);
  return {
    inTenant: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
    accessRel: (db, table) => timeSeriesAccessRel(db, table),
    redisDel: async (key) => (await import('@kuraykaraaslan-labs/redis')).default.del(key),
  };
}

/** `tenant:purge_step` contribution. */
const step: TenantPurgeStep = {
  async purge(tenantId) {
    await purgeTenantTelemetry(await processDeps(), tenantId);
  },
};

export default step;

/** For a module that hard-deletes an entity: its readings of `kind` go with it (the lane is the kind's). */
export async function purgeEntity(tenantId: string, lane: string, entityId: string): Promise<void> {
  await purgeEntityTelemetry(await processDeps(), tenantId, lane, entityId);
}

/** `purgeEntityTelemetryWindowed` on the process's own deps: what the entity-purge queue's worker runs. */
export async function purgeEntityWindowed(tenantId: string, lane: string, entityId: string, o?: WindowedPurgeOptions): Promise<WindowedPurgeReport> {
  return purgeEntityTelemetryWindowed(await processDeps(), tenantId, lane, entityId, o);
}

/** For a module that owns a lane: every row of the tenant in that lane goes (shared dictionary and bindings stay). */
export async function purgeLane(tenantId: string, lane: string): Promise<{ tables: number }> {
  return purgeLaneTelemetry(await processDeps(), tenantId, lane);
}
