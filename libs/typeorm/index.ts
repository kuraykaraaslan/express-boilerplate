import 'reflect-metadata';
import { DataSource } from 'typeorm';
import path from 'path';
import { env } from '@/libs/env';

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDbUrl(raw: string): { url: string; schema?: string } {
  const match = raw.match(/[?&]schema=([^&]+)/);
  const schema = match?.[1];
  const url = raw.replace(/[?&]schema=[^&]+/, '').replace(/[?&]$/, '');
  return { url, schema };
}

// ── Entity glob ──────────────────────────────────────────────────────────────

const rootDir = path.resolve(__dirname, '..', '..');
const entityGlob = path.join(rootDir, '**', 'entities', '*.{ts,js}');

// ── System (AppDataSource) ────────────────────────────────────────────────────

const DATABASE_URL = env.SYSTEM_DATABASE_URL ?? env.DATABASE_URL;
const { url: SYSTEM_DB_URL, schema: SYSTEM_SCHEMA } = parseDbUrl(DATABASE_URL);

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: SYSTEM_DB_URL,
  schema: SYSTEM_SCHEMA,
  synchronize: false,
  logging: env.NODE_ENV === 'development',
  entities: [entityGlob],
  migrations: [],
});

let systemInitialized = false;

export async function getAppDataSource(): Promise<DataSource> {
  if (!systemInitialized) {
    await AppDataSource.initialize();
    systemInitialized = true;
  }
  return AppDataSource;
}

// ── Tenant data sources (LRU cache, max 100) ──────────────────────────────────

const MAX_CACHED = 100;
const tenantCache = new Map<string, DataSource>();

function evictOldest(): void {
  const entry = tenantCache.entries().next().value;
  if (!entry) return;
  const [key, ds] = entry as [string, DataSource];
  tenantCache.delete(key);
  ds.destroy().catch(() => {});
}

export async function tenantDataSourceFor(tenantId: string): Promise<DataSource> {
  if (tenantCache.has(tenantId)) return tenantCache.get(tenantId)!;

  // Resolve per-tenant DB URL — fall back to TENANT_DATABASE_URL or DATABASE_URL
  const rawUrl = env.TENANT_DATABASE_URL ?? env.DATABASE_URL;
  const { url, schema } = parseDbUrl(rawUrl);

  if (tenantCache.size >= MAX_CACHED) evictOldest();

  const ds = new DataSource({
    type: 'postgres',
    url,
    schema,
    synchronize: false,
    logging: false,
    entities: [entityGlob],
    migrations: [],
  });

  await ds.initialize();
  tenantCache.set(tenantId, ds);
  return ds;
}

export function clearTenantDsCache(tenantId: string): void {
  const ds = tenantCache.get(tenantId);
  tenantCache.delete(tenantId);
  ds?.destroy().catch(() => {});
}

// Alias for next-boilerplate compatibility
export const getSystemDataSource = getAppDataSource;

// Alias for tenant session compatibility
export const getDefaultTenantDataSource = getAppDataSource;
