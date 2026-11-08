import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { parseDbUrl } from './db.utils';
import { TenantDatabase } from './entities/tenant_database.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import { resolveTenantDatabaseUrl } from './db.tenant-database.url';
import { getDataSource, buildDataSourceOptions, devSyncIfDevelopment } from './db.datasource';
import { withoutSharedDatabaseEntities } from './db.shared-database';

// ── Per-tenant DataSource cache ─────────────────────────────────────────────
const MAX_CACHED = 100;
const tenantCache = new Map<string, DataSource>();

// Most tenants live on the shared database, and every tenant-scoped block asks where its tenant lives. Without
// remembering "shared", each block paid an extra primary-key SELECT on tenant_databases (plus a pool checkout).
// The answer is kept for a short TTL rather than forever because provision() on ANOTHER process cannot reach this
// map: a tenant moved onto a dedicated database keeps being served from the shared one here for at most this long.
// Provisioning a tenant before it has traffic avoids even that window.
export const SHARED_TTL_MS = 30_000;
// Bounded like the dedicated cache; entries are tiny, so the cap only guards against unbounded growth.
const MAX_SHARED_CACHED = 10_000;
const sharedUntil = new Map<string, number>();

// Single-flight: concurrent first callers for one tenant share one lookup and, for a dedicated database, one
// DataSource. Otherwise a burst opens one pool per caller and only the last one is kept (the rest leak until idle).
// Each lookup carries its own token; clearTenantDsCache drops the slot, so a lookup that finishes after a clear sees a
// different (or no) token and does not remember its possibly stale answer.
const inFlight = new Map<string, { token: object; promise: Promise<DataSource> }>();

function evictOldest(): void {
  const [key, ds] = tenantCache.entries().next().value!;
  tenantCache.delete(key);
  ds.destroy().catch(() => {});
}

function rememberShared(tenantId: string): void {
  sharedUntil.delete(tenantId); // re-insert so the Map's insertion order stays oldest-first
  if (sharedUntil.size >= MAX_SHARED_CACHED) sharedUntil.delete(sharedUntil.keys().next().value!);
  sharedUntil.set(tenantId, Date.now() + SHARED_TTL_MS);
}

async function resolveTenantDataSource(tenantId: string, token: object): Promise<DataSource> {
  const base = await getDataSource();
  const row = await base.getRepository(TenantDatabase).findOne({ where: { tenantId } });
  // False once clearTenantDsCache ran mid-lookup: the answer may be stale, so it is handed to the callers already
  // waiting but not remembered.
  const current = () => inFlight.get(tenantId)?.token === token;
  if (!row) {
    if (current()) rememberShared(tenantId);
    return base;
  }
  // Falling back to the shared database here would silently serve a tenant's requests from the wrong place.
  if (row.status !== 'ACTIVE') {
    throw new Error(`[tenant-database] the dedicated database of tenant ${tenantId} is ${row.status}, not ACTIVE`);
  }

  const { url, schema } = parseDbUrl(resolveTenantDatabaseUrl(row, (m) => Logger.warn(m)));

  // Built without the entities pinned to the shared database (api_keys: verify() finds a key by hash before the tenant
  // is known), so they cannot be read or written here and the dev sync never creates their tables (02-fleet F8).
  const options = buildDataSourceOptions(url, schema);
  const ds = new DataSource(options.entities
    ? { ...options, entities: withoutSharedDatabaseEntities(options.entities as readonly unknown[]) as typeof options.entities } as typeof options
    : options);
  await ds.initialize();
  // A dedicated database keeps its dev schema sync (with the same change check as the shared one).
  try {
    await devSyncIfDevelopment(ds, url, schema);
  } catch (err) {
    ds.destroy().catch(() => {});
    throw err;
  }
  if (current()) {
    if (tenantCache.size >= MAX_CACHED) evictOldest();
    tenantCache.set(tenantId, ds);
  }
  return ds;
}

export async function tenantDataSourceFor(rawTenantId: string): Promise<DataSource> {
  // D9: one spelling per tenant (a uuid is case-insensitive), so an upper-case id never opens a second pool.
  const tenantId = typeof rawTenantId === 'string' ? rawTenantId.toLowerCase() : rawTenantId;
  const cached = tenantCache.get(tenantId);
  if (cached) return cached;

  const until = sharedUntil.get(tenantId);
  if (until !== undefined) {
    if (until > Date.now()) return getDataSource();
    sharedUntil.delete(tenantId);
  }

  const pending = inFlight.get(tenantId);
  if (pending) return pending.promise;

  const token = {};
  // resolveTenantDataSource awaits before it reads the slot, so the set() below always lands first.
  const promise = resolveTenantDataSource(tenantId, token);
  inFlight.set(tenantId, { token, promise });
  // A rejection is not remembered: the next caller retries. The slot is released either way.
  const release = () => { if (inFlight.get(tenantId)?.token === token) inFlight.delete(tenantId); };
  promise.then(release, release);
  return promise;
}

/**
 * Forget where a tenant lives (its dedicated DataSource, a remembered "shared" answer, and any lookup in progress),
 * so the next call reads tenant_databases again. Call after provisioning, decommissioning or deleting a tenant.
 */
export function clearTenantDsCache(rawTenantId: string): void {
  const tenantId = typeof rawTenantId === 'string' ? rawTenantId.toLowerCase() : rawTenantId;
  const ds = tenantCache.get(tenantId);
  tenantCache.delete(tenantId);
  sharedUntil.delete(tenantId);
  inFlight.delete(tenantId);
  ds?.destroy().catch(() => {});
}
