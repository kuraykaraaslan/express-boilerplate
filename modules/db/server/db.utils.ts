import type { LoggerOptions, Logger as TypeOrmLogger, QueryRunner } from 'typeorm';
import { AsyncLocalStorage } from 'async_hooks';
import { readFileSync } from 'node:fs';
import { resolveSchemaMode } from './db.deploy-mode';

export function parseDbUrl(raw: string): { url: string; schema?: string } {
  const match = raw.match(/[?&]schema=([^&]+)/);
  const schema = match?.[1];
  let url = raw.replace(/[?&]schema=[^&]+/, '');
  // `?schema=x&other=y` loses its `?` with the schema param: promote the next `&` to it.
  if (!url.includes('?') && url.includes('&')) url = url.replace('&', '?');
  url = url.replace(/[?&]$/, '');
  return { url, schema };
}

/**
 * Resolve the direct (unpooled) database connection for deploy. Returns null
 * when no database is configured so callers can skip rather than fail.
 *
 * Deploy runs DDL, so it needs the table OWNER. `DATABASE_URL_UNPOOLED` is the
 * owner connection; `DATABASE_URL_ADMIN` is the cross-tenant `app_admin` login,
 * which after the RLS cutover is a non-owner and cannot alter tables. The admin
 * URL stays a fallback for setups that never split the two (admin == owner).
 *
 * In `migrate` mode (`DB_DEPLOY_MODE=migrate`, the default for the `node` and
 * `fleet` roles, see db.deploy-mode.ts) there is NO fallback: the run uses
 * `DATABASE_URL_UNPOOLED` or throws, so a migration can never run on the pooled
 * or the cross-tenant connection by accident.
 */
export function resolveDeployTarget(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { url: string; schema?: string } | null {
  if (resolveSchemaMode(env).mode === 'migrate') {
    const owner = env.DATABASE_URL_UNPOOLED?.trim();
    if (!owner) {
      throw new Error(
        '[db-deploy] migrate mode requires DATABASE_URL_UNPOOLED (the table-owner connection); '
        + 'DATABASE_URL_ADMIN and DATABASE_URL are not used.',
      );
    }
    return parseDbUrl(owner);
  }
  const raw = env.DATABASE_URL_UNPOOLED
    || env.DATABASE_URL_ADMIN
    || env.DATABASE_URL;
  if (!raw) return null;
  return parseDbUrl(raw);
}

export function typeormLogging(nodeEnv: string | undefined): LoggerOptions {
  if (process.env.TYPEORM_LOG_QUERIES === '1') return 'all';
  if (nodeEnv === 'development') return ['error', 'warn', 'schema', 'migration'];
  return ['error'];
}

// ── Tenant context for slow-query tagging ───────────────────────────────────
// Set this store before executing a query to have the tenantId appear in logs.
export const tenantQueryContext = new AsyncLocalStorage<{ tenantId: string }>();

/**
 * A watcher for every query the ORM runs, installed by `db.shadow.ts`.
 *
 * A hook rather than an import so the dependency runs one way: the shadow
 * counter reads the async store defined here, and this file knows nothing about
 * it. Null until something registers, which keeps the logger usable on its own
 * (tests, scripts) with no boot order to get right.
 */
let queryObserver: ((query: string) => void) | null = null;

export function setQueryObserver(observer: ((query: string) => void) | null): void {
  queryObserver = observer;
}

// Custom TypeORM logger that tags slow queries (> threshold ms) with tenantId.
export class TenantContextLogger implements TypeOrmLogger {
  constructor(private readonly thresholdMs: number = 1000) {}

  logQuery(query: string, parameters?: unknown[]): void {
    // Shadow mode (Faz 3): the observer counts tenant-scoped queries running
    // with no tenant in context — the paths that go dark on the Faz 4 cutover.
    queryObserver?.(query);
  }

  logQueryError(error: string | Error, query: string, parameters?: unknown[]): void {
    const msg = typeof error === 'string' ? error : error.message;
    console.error(`[db] query error: ${msg} — ${query}`);
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[]): void {
    const ctx = tenantQueryContext.getStore();
    const tag = ctx ? `tenant=${ctx.tenantId}` : 'tenant=unknown';
    console.warn(`[db] slow query (${time}ms) [${tag}]: ${query.slice(0, 200)}`);
  }

  logSchemaBuild(message: string): void {
    console.info(`[db] schema: ${message}`);
  }

  logMigration(message: string): void {
    console.info(`[db] migration: ${message}`);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') console.warn(`[db] ${message}`);
  }
}

// ── TLS to the database (38-security 7.6) ───────────────────────────────────

export type DbSslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';
export type DbSslResolution = { url: string; ssl: false | { rejectUnauthorized: boolean; ca?: string }; mode: DbSslMode };

/** A host on the same machine or the compose-internal network (no dot: a service name such as `db`): TLS is not demanded by default there. */
export function isInternalDbHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === '' || h === 'localhost' || h === '::1' || /^127\./.test(h) || !h.includes('.') && !h.includes(':') || h.endsWith('.local') || h.endsWith('.internal');
}

function normalizeMode(raw: string | null | undefined): DbSslMode | null {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'disable': case 'allow': case 'off': case 'false': case '0': return 'disable';
    case 'require': case 'prefer': case 'true': case '1': case 'on': return 'require';
    case 'verify-ca': return 'verify-ca';
    case 'verify-full': return 'verify-full';
    default: return null;
  }
}

/**
 * The TLS settings of a Postgres URL. Tenant-override databases and fleet tenant moves can cross hosts, and the datasource layer used to
 * set no `ssl` at all (plaintext unless a URL parameter the driver happened to honour said otherwise). Now:
 *  - `sslmode=` (or `ssl=true`) in the URL wins; `defaultMode` (DATABASE_SSL) applies when the URL says nothing;
 *  - with neither, TLS is REQUIRED for any host that is not local or compose-internal, and off for those (a fresh `docker compose up` is unchanged);
 *  - `require` encrypts without verifying the certificate (libpq semantics); `verify-ca` / `verify-full` verify it, against `caPem` when given;
 *  - `sslmode` / `ssl` / `sslrootcert` are removed from the URL handed to the driver, so the driver's own parsing cannot override this.
 */
export function resolveDbSsl(rawUrl: string, opts: { defaultMode?: string | null; caPem?: string | null } = {}): DbSslResolution {
  let host = '';
  let fromUrl: string | null = null;
  let url = rawUrl;
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    fromUrl = u.searchParams.get('sslmode') ?? (['true', '1'].includes((u.searchParams.get('ssl') ?? '').toLowerCase()) ? 'require' : null);
    for (const p of ['sslmode', 'ssl', 'sslrootcert']) u.searchParams.delete(p);
    url = u.toString().replace(/\?$/, '');
  } catch {
    // not a parseable URL: leave it to the driver, and fail closed to TLS only if a mode was asked for
  }
  const mode = normalizeMode(fromUrl) ?? normalizeMode(opts.defaultMode) ?? (isInternalDbHost(host) ? 'disable' : 'require');
  if (mode === 'disable') return { url, ssl: false, mode };
  const verify = mode === 'verify-ca' || mode === 'verify-full';
  return { url, ssl: { rejectUnauthorized: verify, ...(opts.caPem ? { ca: opts.caPem } : {}) }, mode };
}

/** `resolveDbSsl` with the process settings: DATABASE_SSL (default mode) and DATABASE_SSL_CA_FILE (a PEM bundle). An unreadable CA file is a hard error. */
export function resolveDbSslFromEnv(rawUrl: string): DbSslResolution {
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  let caPem: string | null = null;
  if (caFile) {
    caPem = readFileSync(caFile, 'utf8');
  }
  return resolveDbSsl(rawUrl, { defaultMode: process.env.DATABASE_SSL, caPem });
}
