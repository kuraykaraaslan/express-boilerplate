import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { AuditChainPolicy } from './entities/audit_chain_policy.entity';

/**
 * Which audit chain a tenant writes: `legacy` (JavaScript hash, hashVersion NULL, byte-identical to every release before
 * the hardening) or `sealed` (PostgreSQL hash, pseudonymous actors, hashVersion 2).
 *
 * The answer is the tenant's row in `audit_chain_policy` when there is one, else the default of the process role:
 * `single` (and an unset FLEET_ROLE) is legacy, `node` and `fleet` are sealed. So a standalone deployment changes
 * nothing until its operator opts in, and a regional node is sealed from its first row.
 *
 * The database trigger reads the same row, so a sealed tenant is enforced where the rows are written, not only here.
 */
export type AuditChainMode = 'legacy' | 'sealed';

/** A role that is not `node` or `fleet` is the standalone deployment: legacy, as before. */
export function defaultChainMode(role: string | undefined = env.FLEET_ROLE): AuditChainMode {
  return role === 'node' || role === 'fleet' ? 'sealed' : 'legacy';
}

/** How long a tenant's answer is trusted. A flip is therefore visible within this window; see `invalidateChainMode`. */
export const CHAIN_MODE_TTL_MS = 30_000;
const MAX_CACHED_TENANTS = 2_000;

interface CachedMode { mode: AuditChainMode; until: number }
const cache = new Map<string, CachedMode>();

/** Forget one tenant (or all): the writer calls this when the trigger refuses a write the cached mode allowed. */
export function invalidateChainMode(tenantId?: string): void {
  if (tenantId === undefined) cache.clear();
  else cache.delete(tenantId);
}

function remember(tenantId: string, mode: AuditChainMode, now: number): AuditChainMode {
  if (cache.size >= MAX_CACHED_TENANTS) cache.clear();
  cache.set(tenantId, { mode, until: now + CHAIN_MODE_TTL_MS });
  return mode;
}

/**
 * The chain mode of a tenant. Never throws: a policy that cannot be read keeps the last answer for another window, else
 * falls back to the role default. That is fail-closed where it matters: a `node` that cannot read its policy stays
 * sealed (and its write is then refused by the missing trigger or key rather than downgraded), while a standalone
 * deployment whose policy table does not exist yet keeps writing legacy rows.
 */
export async function resolveChainMode(tenantId: string, now: number = Date.now()): Promise<AuditChainMode> {
  const hit = cache.get(tenantId);
  if (hit && hit.until > now) return hit.mode;
  try {
    const row = await withTenantRepositoryFor(tenantId, AuditChainPolicy, (repo) => repo.findOne({ where: { tenantId } }));
    if (row == null) return remember(tenantId, defaultChainMode(), now);
    if (row.mode === 'legacy' || row.mode === 'sealed') return remember(tenantId, row.mode, now);
    throw new Error('unknown mode value');
  } catch (err: unknown) {
    Logger.warn(`[AUDIT] chain mode of tenant ${tenantId} could not be read, using ${hit ? 'the previous answer' : 'the role default'}: ${err instanceof Error ? err.message : String(err)}`);
    return remember(tenantId, hit?.mode ?? defaultChainMode(), now);
  }
}
