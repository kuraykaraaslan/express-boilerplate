import 'reflect-metadata';
import type { QueryRunner } from 'typeorm';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { TenantDomain } from './entities/tenant_domain.entity';
import { freeSubdomainNames, isWildcardSubdomain } from './tenant_domain.wildcard';
import { isReservedWildcardName, tenantBaseOf } from './tenant_domain.serving';
import { asBaseRefs, baseDomainList, defaultBaseDomainOf, isMintableBase } from './tenant_domain.base-domains';

export { freeSubdomainName, isProtectedSubdomain, isWildcardSubdomain, wildcardDomain } from './tenant_domain.wildcard';

/**
 * Every tenant keeps a free subdomain (owner direction 2026-10-17): `<slug>.<base domain>`, served under the platform's own wildcard
 * certificate for that base, so it needs no DNS proof and is `ACTIVE` from the moment it exists. Phase 56 (D341): the platform manages
 * several base domains; a tenant's base is the one its free-subdomain row sits under, a new tenant gets the one it chose (`baseDomain`)
 * or the installation's default, and a change of base is a rename of that row. Custom
 * domains come and go with the plan; this one never does. A tenant without one is never left without a working
 * address: when the wildcard domain is not configured (self-hosted, path routing) there is no subdomain at all and links
 * use the platform host instead (common's `platformTenantUrl`), which is that installation's "free domain".
 *
 * `ensureFreeSubdomain` is the one routine that establishes it: on tenant creation (the seed step), after a slug rename
 * (`tenant:slug_changed`) and on every reconcile sweep (`tenant_domain.reconcile`). It is idempotent.
 */

/**
 * The tenant's slug, read through the caller's tenant-scoped transaction (`withTenantTransactionFor`), so the `tenants`
 * row is read under the tenant's own RLS context (tenant.sweep-guard).
 */
export async function tenantSlugIn(qr: QueryRunner, tenantId: string): Promise<string | null> {
  // `qr` is the one withTenantTransactionFor handed the caller: the tenant's own RLS context.
  const tenant = await qr.manager.getRepository(Tenant).findOne({ where: { tenantId } });
  return tenant?.slug ?? null;
}

/** Statuses a primary must not keep: the platform took it away. */
const UNSERVED_PRIMARY = new Set(['SUSPENDED']);

export type FreeSubdomainAction = 'none' | 'minted' | 'renamed' | 'reactivated';

export interface FreeSubdomainResult {
  /** The tenant's free subdomain after the call, or null when it has none (no wildcard, no slug, or a name clash). */
  domain: string | null;
  action: FreeSubdomainAction;
  /** The free subdomain was made primary, because the tenant had no primary or a suspended one. */
  madePrimary: boolean;
  /** For `renamed`: the name the row had before (a slug or base-domain change), for the host move that redirects it (D347). */
  previousDomain?: string;
}

export interface EnsureFreeSubdomainOptions {
  /** The slug before a rename (`tenant:slug_changed`): the row named after it is renamed rather than a second one minted. */
  previousSlug?: string | null;
  /** The base domain the free subdomain must sit under (onboarding choice, a base change); ignored unless it is ACTIVE and for tenants. */
  baseDomain?: string | null;
  /** A rename redirects the old host for 30 days (D347); false for a tenant that is minutes old (the onboarding's own choice). */
  recordMove?: boolean;
}

/** Postgres unique_violation, however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

/**
 * Make sure the tenant has its free subdomain, `ACTIVE`, and a primary domain that serves. Idempotent.
 *
 *  - Missing: when the slug changed (`previousSlug`) the old `<previous>.<base>` row is renamed (and on a base change, `baseDomain`, the current row), so the tenant keeps
 *    exactly one; without a hint, a tenant whose only wildcard subdomain is named after an old slug gets that one
 *    renamed; otherwise a new row is minted. Renaming keeps the row's id, primary flag and site.
 *  - Present but not ACTIVE (a pre-2026-10-17 DNS sweep downgraded it, an operator switched it off): back to ACTIVE.
 *    It is the platform's own name under the platform's certificate; no DNS proof applies to it.
 *  - The tenant has no primary, or its primary is SUSPENDED: the free subdomain becomes primary.
 *
 * Runs under the tenant's domain-set lock (the same one create/update/delete take). A name another tenant holds (the
 * global unique index) is logged and answered as `domain: null`; it never throws for that.
 */
export async function ensureFreeSubdomain(tenantId: string, opts: EnsureFreeSubdomainOptions = {}): Promise<FreeSubdomainResult> {
  const list = await baseDomainList();
  const bases = asBaseRefs(list);
  if (!bases.some((b) => b.purpose === 'tenants')) return { domain: null, action: 'none', madePrimary: false };
  const requested = opts.baseDomain ? opts.baseDomain.trim().toLowerCase() : null;
  const requestedBase = requested && isMintableBase(list.find((b) => b.baseDomain === requested)) ? requested : null;
  if (requested && !requestedBase) Logger.warn(`[tenant_domain] ${JSON.stringify(requested)} is not an active base domain for tenants; the free subdomain of ${tenantId} keeps its base`);

  type Outcome = FreeSubdomainResult & { names: string[]; ids: string[] };
  let outcome: Outcome;
  try {
    outcome = await withTenantTransactionFor(tenantId, async (qr): Promise<Outcome> => {
      await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tenant_domain:set:${tenantId}`]);
      const slug = await tenantSlugIn(qr, tenantId);
      // No slug → no deterministic name to mint.
      if (!slug) return { domain: null, action: 'none', madePrimary: false, names: [], ids: [] };
      const repo = qr.manager.getRepository(TenantDomain);
      const rows = await repo.find({ where: { tenantId } });
      const wildRows = rows.filter((d) => isWildcardSubdomain(d.domain, bases));
      // The row that is the free subdomain now: the one named after the slug (under any base), else the one named after the previous
      // slug, else the tenant's only platform subdomain.
      const named = freeSubdomainNames(slug, bases);
      const previous = freeSubdomainNames(opts.previousSlug, bases);
      const current = wildRows.find((d) => named.includes(d.domain))
        ?? wildRows.find((d) => previous.includes(d.domain))
        ?? (wildRows.length === 1 ? wildRows[0] : undefined);
      const base = requestedBase ?? (current ? tenantBaseOf(current.domain, bases) : null) ?? defaultBaseDomainOf(list);
      if (!base) return { domain: null, action: 'none', madePrimary: false, names: [], ids: [] };
      const target = `${slug}.${base}`;
      // A reserved name (admin., www., api., auth., app. ...) is never minted or kept for a customer tenant; the
      // reconcile suspends one it finds (tenant_domain.reconcile) and a slug change to a free name renames it. The
      // tenant is still reachable on the platform host (`/tenant/{id}`), so it never ends up unroutable.
      if (isReservedWildcardName(target, bases, tenantId)) {
        Logger.warn(`[tenant_domain] the slug of ${tenantId} makes a reserved subdomain (${target}); no free subdomain minted`);
        return { domain: null, action: 'none', madePrimary: false, names: [], ids: [] };
      }
      const names = [target];
      const ids: string[] = [];
      const primaryServes = rows.some((d) => d.isPrimary && !UNSERVED_PRIMARY.has(d.domainStatus));

      let free = rows.find((d) => d.domain === target);
      let action: FreeSubdomainAction = 'none';
      let previousDomain: string | undefined;
      if (!free) {
        const renamable = current;
        if (!renamable) {
          const minted = await repo.save(repo.create({ tenantId, domain: target, isPrimary: !primaryServes, domainStatus: 'ACTIVE' }));
          return { domain: target, action: 'minted', madePrimary: !primaryServes, names, ids: minted?.tenantDomainId ? [minted.tenantDomainId] : [] };
        }
        await repo.update({ tenantDomainId: renamable.tenantDomainId, tenantId }, { domain: target, domainStatus: 'ACTIVE', suspendedAt: null, statusBeforeSuspension: null });
        names.push(renamable.domain);
        previousDomain = renamable.domain;
        free = renamable;
        action = 'renamed';
      } else if (free.domainStatus !== 'ACTIVE') {
        await repo.update({ tenantDomainId: free.tenantDomainId, tenantId }, { domainStatus: 'ACTIVE', suspendedAt: null, statusBeforeSuspension: null });
        action = 'reactivated';
      }
      ids.push(free.tenantDomainId);

      // The primary must serve: none at all, or one the platform suspended, falls back to the free subdomain.
      let madePrimary = false;
      if (!free.isPrimary && !primaryServes) {
        for (const p of rows.filter((d) => d.isPrimary)) {
          await repo.update({ tenantDomainId: p.tenantDomainId, tenantId }, { isPrimary: false });
          ids.push(p.tenantDomainId);
        }
        await repo.update({ tenantDomainId: free.tenantDomainId, tenantId }, { isPrimary: true });
        madePrimary = true;
      }
      return { domain: target, action, madePrimary, names, ids, ...(previousDomain ? { previousDomain } : {}) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      Logger.warn(`[tenant_domain] the free subdomain of ${tenantId} is held by another tenant; not minted`);
      return { domain: null, action: 'none', madePrimary: false };
    }
    throw err;
  }

  const { names, ids, ...result } = outcome;
  if (result.action !== 'none' || result.madePrimary) {
    // Unknown hosts are negative-cached (tenant_domain.crud.service), and the primary / free / brand entries describe
    // the old state: drop them so the change serves at once. Best-effort, like every cache clear here.
    await Promise.all([
      ...names.map((name) => redis.del(`tenant:domain:name:${name}`)),
      ...ids.map((id) => redis.del(`tenant:domain:id:${id}`)),
      redis.del(`tenant:domain:primary:${tenantId}`),
      redis.del(`tenant:domain:free:${tenantId}`),
      redis.del(`notification_mail:brand:${tenantId}`),
    ]).catch(() => {});
    Logger.info(`[tenant_domain] free subdomain ${result.domain} of ${tenantId}: ${result.action}${result.madePrimary ? ', now primary' : ''}`);
  }
  // phase 56 (D347): the old host of a rename redirects to the new one for 30 days. Best effort: a failure leaves an unknown host, never a failed rename.
  if (result.action === 'renamed' && result.previousDomain && result.domain && opts.recordMove !== false) {
    const reason = requestedBase && tenantBaseOf(result.previousDomain, bases) !== requestedBase ? 'base_change' : 'slug_change';
    await import('./tenant_domain.host-moves')
      .then((m) => m.recordHostMove({ fromHost: result.previousDomain as string, toHost: result.domain as string, tenantId, reason }))
      .catch((err) => Logger.warn(`[tenant_domain] the move of ${JSON.stringify(result.previousDomain)} was not recorded: ${err instanceof Error ? err.message : 'unknown'}`));
  }
  // phase 51: a minted, renamed or reactivated free subdomain is servable at once: ask for its certificate (queue, best effort).
  if (result.domain && ids[0] && (result.action === 'minted' || result.action === 'renamed' || result.action === 'reactivated')) {
    void import('./tenant_domain.certificates.hooks')
      .then((m) => m.requestCertificate({ tenantId, tenantDomainId: ids[0], domain: result.domain as string, domainStatus: 'ACTIVE' }))
      .catch(() => undefined);
  }
  return result;
}
