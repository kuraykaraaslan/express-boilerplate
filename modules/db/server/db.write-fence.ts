import 'reflect-metadata';
import type { DataSource, QueryRunner } from 'typeorm';

/**
 * The write fence of a tenant that is being moved (docs/phases/02-fleet/05 section 6.2, roadmap Phase 6: "write fence for MIGRATING / IMPORTING in
 * db.context.ts"). While a tenant is MIGRATING (frozen on the source during its export) or IMPORTING (on the target until it is verified), every
 * tenant-scoped transaction of the app opens READ ONLY: reads keep working, any INSERT, UPDATE or DELETE fails in PostgreSQL itself
 * (SQLSTATE 25006), so jobs and every code path are stopped, not only HTTP methods. The import itself writes through its own transaction
 * (`db.tenant-bundle.ts`), outside this fence. The same fence keeps a FENCED old home read-only (decision F1): a tenant whose `fencedAt` is set
 * (`fenceAfterDirectoryMove`: the directory homes it on another node at a higher assignment version) is fenced whatever its status, until a signed
 * failback clears the stamp.
 *
 * Which tenants are fenced is read from the `tenants` table at most every `FENCE_REFRESH_MS` per process (one indexed query, shared by every caller);
 * between two reads the decision is a set lookup. Only a fleet NODE fences: a single deployment never migrates a tenant and pays nothing. A migration
 * step that freezes a tenant refreshes its own process at once (`refreshWriteFence`) and must give the other processes one refresh interval before it
 * takes its snapshot.
 */
export const FENCE_REFRESH_MS = 5_000;
export const FENCED_STATUSES = ['MIGRATING', 'IMPORTING'] as const;

type Loader = () => Promise<string[]>;

let fenced: ReadonlySet<string> = new Set();
let loadedAt = 0;
let inflight: Promise<void> | null = null;
let loader: Loader | null = null;
let enabledOverride: boolean | null = null;

let nodeRole: boolean | null = null;

/**
 * Whether this process is a fleet node. Read from the validated environment on first use, not at import: `db.context` is imported nearly everywhere,
 * and loading it must not boot the environment. An environment that cannot be read is not a node (nothing is fenced).
 */
async function enabled(): Promise<boolean> {
  if (enabledOverride !== null) return enabledOverride;
  if (nodeRole === null) {
    try { nodeRole = (await import('@kuraykaraaslan-labs/env')).env?.FLEET_ROLE === 'node'; } catch { nodeRole = false; }
  }
  return nodeRole;
}

/**
 * The fenced tenant ids of the `tenants` table `table` (already quoted): a status in `FENCED_STATUSES`, or a `fencedAt` stamp. A database the tenant
 * migration 131 has not reached yet (no `fencedAt` column: SQLSTATE 42703) is asked for the statuses alone, so a deploy never drops the migration fence.
 */
export async function loadFencedTenants(query: (sql: string, params: unknown[]) => Promise<{ tenantId: string }[]>, table: string): Promise<string[]> {
  let rows: { tenantId: string }[];
  try {
    rows = await query(`SELECT "tenantId" FROM ${table} WHERE "tenantStatus" = ANY($1) OR "fencedAt" IS NOT NULL`, [[...FENCED_STATUSES]]);
  } catch (err) {
    const code = (err as { driverError?: { code?: string }; code?: string }).driverError?.code ?? (err as { code?: string }).code;
    if (code !== '42703') throw err;
    rows = await query(`SELECT "tenantId" FROM ${table} WHERE "tenantStatus" = ANY($1)`, [[...FENCED_STATUSES]]);
  }
  return rows.map((r) => r.tenantId);
}

/** The fenced tenant ids from the system DataSource (an empty list when the table is not there). */
async function defaultLoader(): Promise<string[]> {
  const { getSystemDataSource } = await import('./db.datasource');
  const ds: DataSource = await getSystemDataSource();
  const table = ds.entityMetadatas.find((m) => m.tableName === 'tenants')?.tablePath;
  if (!table) return [];
  return loadFencedTenants((sql, params) => ds.query(sql, params), table.split('.').map((p) => `"${p}"`).join('.'));
}

/** Reloads the fenced set now (a freeze in this process calls it). A failed load keeps the previous set and is retried on the next check. */
export async function refreshWriteFence(): Promise<void> {
  // The shared promise is created synchronously, so concurrent callers can never start two loads.
  inflight ??= (async () => {
    try {
      if (!(await enabled())) return;
      fenced = new Set(await (loader ?? defaultLoader)());
      loadedAt = Date.now();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Whether `tenantId` may not be written right now. Refreshes the set first when it is older than `FENCE_REFRESH_MS`; fails open on a load error. */
export async function isWriteFenced(tenantId: string): Promise<boolean> {
  if (!(await enabled())) return false;
  if (Date.now() - loadedAt > FENCE_REFRESH_MS) {
    try { await refreshWriteFence(); } catch { /* keep the last known set: the database will answer the real write anyway */ }
  }
  return fenced.has(tenantId);
}

/** Opens the current transaction READ ONLY when the tenant is fenced. Called right after the tenant context is set. */
export async function applyWriteFence(qr: QueryRunner, tenantId: string): Promise<void> {
  if (await isWriteFenced(tenantId)) await qr.query("SELECT set_config('transaction_read_only', 'on', true)");
}

/** The PostgreSQL error a fenced write raises. */
export const FENCED_WRITE_SQLSTATE = '25006';

/** Test hook: a loader instead of the database, the role check forced on or off, and a clean state. */
export function configureWriteFenceForTests(o: { loader?: Loader | null; enabled?: boolean | null } = {}): void {
  loader = o.loader ?? null;
  enabledOverride = o.enabled ?? null;
  nodeRole = null;
  fenced = new Set();
  loadedAt = 0;
  inflight = null;
}
