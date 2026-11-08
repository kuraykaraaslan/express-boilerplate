import 'reflect-metadata';
import Logger from '@kuraykaraaslan-labs/logger';
import { TenantDomainBaseDomain } from './entities/tenant_domain_base_domain.entity';
import { setBaseDomainSnapshot, wildcardDomain } from './tenant_domain.wildcard';
import type { BaseDomainPurpose } from './tenant_domain.serving';

/**
 * The platform's managed base domains (phase 56, D340), read from `tenant_domain_base_domains` through the system context.
 *
 * Every process keeps the list in memory for 30 s and serves the last list while it re-reads (the proxy asks on every request), on
 * `globalThis` so every bundle graph of the process shares one copy. A write here drops it in this process; other processes catch up
 * within the TTL. When the table is empty (before the boot seed ran) or cannot be read, the environment's `TENANT_WILDCARD_DOMAIN` is the
 * list, which is exactly the behaviour before this phase.
 */
export const BASE_DOMAIN_STATUS = { PENDING_DNS: 'PENDING_DNS', ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' } as const;
export type BaseDomainStatus = (typeof BASE_DOMAIN_STATUS)[keyof typeof BASE_DOMAIN_STATUS];
export const BASE_DOMAIN_PURPOSES: readonly BaseDomainPurpose[] = ['tenants', 'wildcard_only'];
export const CHALLENGE_MODES = ['delegated', 'zone'] as const;
export type ChallengeMode = (typeof CHALLENGE_MODES)[number];

export interface BaseDomainEntry {
  /** null for the environment's bootstrap entry (no row yet). */
  baseDomainId: string | null;
  baseDomain: string;
  purpose: BaseDomainPurpose;
  isDefault: boolean;
  selectable: boolean;
  status: BaseDomainStatus;
  challengeMode: ChallengeMode;
}

const TTL_MS = 30_000;
const STATE = Symbol.for('nb.tenant_domain.baseDomains.cache');
/** `rows` are the table's rows only: an empty table (or a failed read) caches `[]`, and the bootstrap entry is computed on every read. */
type CacheState = { at: number; rows: BaseDomainEntry[] } | null;
type Holder = { [STATE]?: { cache: CacheState; inflight: Promise<BaseDomainEntry[]> | null; warnedAt?: number } };

function state() {
  const g = globalThis as Holder;
  return (g[STATE] ??= { cache: null, inflight: null });
}

/** The environment's wildcard as the only base domain: the default, ACTIVE, tenants. Empty without one (path mode, self-hosted). */
export function bootstrapBaseDomains(): BaseDomainEntry[] {
  const w = wildcardDomain();
  return w ? [{ baseDomainId: null, baseDomain: w, purpose: 'tenants', isDefault: true, selectable: true, status: 'ACTIVE', challengeMode: 'delegated' }] : [];
}

function asEntry(row: Partial<TenantDomainBaseDomain> | null | undefined): BaseDomainEntry | null {
  if (!row || typeof row.baseDomain !== 'string' || !row.baseDomain) return null;
  const purpose: BaseDomainPurpose = row.purpose === 'wildcard_only' ? 'wildcard_only' : 'tenants';
  const status = (Object.values(BASE_DOMAIN_STATUS) as string[]).includes(String(row.status)) ? (row.status as BaseDomainStatus) : 'PENDING_DNS';
  return {
    baseDomainId: typeof row.baseDomainId === 'string' ? row.baseDomainId : null,
    baseDomain: row.baseDomain.trim().toLowerCase(),
    purpose,
    isDefault: row.isDefault === true && purpose === 'tenants',
    selectable: row.selectable !== false,
    status,
    challengeMode: row.challengeMode === 'zone' ? 'zone' : 'delegated',
  };
}

function remember(rows: BaseDomainEntry[]): void {
  state().cache = { at: Date.now(), rows };
  // The snapshot holds the table's rows only; without any, `currentBaseDomains()` reads the environment itself.
  setBaseDomainSnapshot(rows.map((e) => ({ name: e.baseDomain, purpose: e.purpose })));
}

const withBootstrap = (rows: BaseDomainEntry[]): BaseDomainEntry[] => (rows.length ? rows : bootstrapBaseDomains());

async function load(): Promise<BaseDomainEntry[]> {
  try {
    // Loaded on first use: the pure helpers and the proxy import this file, and the database package reads its configuration on import.
    const { withSystemRLS } = await import('@kuraykaraaslan-labs/db');
    const found = await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomain).find({ order: { baseDomain: 'ASC' } }));
    const rows = (Array.isArray(found) ? found : []).map(asEntry).filter((e): e is BaseDomainEntry => e !== null);
    remember(rows);
    return rows;
  } catch (err) {
    // A failed read (the migration not run yet, a database hiccup) keeps the last rows for a TTL, or none: the environment answers.
    // Once per 5 minutes per process: the proxy re-reads every 30 s, and an installation before migration 006 fails every time.
    const s = state();
    if (Date.now() - (s.warnedAt ?? 0) > 300_000) {
      s.warnedAt = Date.now();
      Logger.warn(`[tenant_domain] base domains: read failed, TENANT_WILDCARD_DOMAIN answers: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    const last = state().cache?.rows ?? [];
    remember(last);
    return last;
  }
}

function reload(): Promise<BaseDomainEntry[]> {
  const s = state();
  return (s.inflight ??= load().finally(() => { s.inflight = null; }));
}

/**
 * Every managed base domain, whatever its status (a name under a PENDING or DISABLED base is still the operator's, never a custom domain
 * a tenant could prove). Never throws: a failed read keeps the last list, or answers the bootstrap one.
 */
export async function baseDomainList(): Promise<BaseDomainEntry[]> {
  const s = state();
  if (s.cache && Date.now() - s.cache.at < TTL_MS) return withBootstrap(s.cache.rows);
  if (s.cache) {
    // Stale: answer the last rows now and re-read behind the request (the proxy asks on every one).
    const stale = s.cache.rows;
    void reload();
    return withBootstrap(stale);
  }
  return withBootstrap(await reload());
}

/** Drop this process's list (after a write), so the next read goes to the table. */
export function invalidateBaseDomains(): void {
  state().cache = null;
}

/** The base a new tenant gets when it chooses none: the ACTIVE default row, else the bootstrap wildcard; null without either. */
export function defaultBaseDomainOf(list: readonly BaseDomainEntry[]): string | null {
  const row = list.find((b) => b.isDefault && b.purpose === 'tenants' && b.status === 'ACTIVE');
  return row?.baseDomain ?? bootstrapBaseDomains()[0]?.baseDomain ?? null;
}

export async function defaultBaseDomain(): Promise<string | null> {
  return defaultBaseDomainOf(await baseDomainList());
}

/** May tenants be minted under this base (ACTIVE, purpose tenants)? */
export function isMintableBase(entry: BaseDomainEntry | undefined | null): boolean {
  return !!entry && entry.purpose === 'tenants' && entry.status === 'ACTIVE';
}

/** The bases the onboarding may offer when the root tenant lets tenants choose (D346): ACTIVE, tenants, selectable. */
export function offeredBaseDomainsOf(list: readonly BaseDomainEntry[]): BaseDomainEntry[] {
  return list.filter((b) => isMintableBase(b) && b.selectable);
}

/**
 * Boot (phase `runtime`, every process): the environment's wildcard becomes the first row, default and ACTIVE, when the table does not
 * hold it yet (ON CONFLICT DO NOTHING: every process may race here). It is the default only when no other row is. Then the list is read
 * once, so the first request does not wait for it. Never throws: without the table (a migration not yet run) the environment answers.
 */
export async function seedBaseDomainFromEnv(): Promise<void> {
  const w = wildcardDomain();
  try {
    if (w) {
      const { withSystemRLS } = await import('@kuraykaraaslan-labs/db');
      await withSystemRLS((qr) => qr.query(
        `INSERT INTO "tenant_domain_base_domains" ("baseDomain", "purpose", "isDefault", "selectable", "status")
         SELECT $1, 'tenants', NOT EXISTS (SELECT 1 FROM "tenant_domain_base_domains" WHERE "isDefault"), true, 'ACTIVE'
         ON CONFLICT DO NOTHING`,
        [w],
      ));
    }
    invalidateBaseDomains();
  } catch (err) {
    Logger.warn(`[tenant_domain] base domains: boot seed skipped: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  await reload();
}

/** The list as the pure serving rule reads it (`tenant_domain.serving`): name and purpose. */
export function asBaseRefs(list: readonly BaseDomainEntry[]): Array<{ name: string; purpose: BaseDomainPurpose }> {
  return list.map((e) => ({ name: e.baseDomain, purpose: e.purpose }));
}

/** `asBaseRefs(await baseDomainList())`: what every async caller of the serving rule passes. */
export async function managedBases(): Promise<Array<{ name: string; purpose: BaseDomainPurpose }>> {
  return asBaseRefs(await baseDomainList());
}

/** Writes fields of one base-domain row (system context) and drops this process's list. */
export async function updateBaseDomainRow(baseDomainId: string, fields: Partial<Pick<TenantDomainBaseDomain, 'status' | 'dnsCheckedAt' | 'lastDnsError' | 'isDefault' | 'selectable' | 'challengeMode' | 'purpose'>>): Promise<void> {
  const { withSystemRLS } = await import('@kuraykaraaslan-labs/db');
  await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomain).update({ baseDomainId }, fields));
  invalidateBaseDomains();
}
