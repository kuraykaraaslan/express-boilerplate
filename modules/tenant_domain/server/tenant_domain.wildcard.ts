import { env } from '@kuraykaraaslan-labs/env';
import { baseDomainRefs, isUnderWildcard, tenantBaseOf, type BaseDomainRef, type BaseDomains } from './tenant_domain.serving';

/**
 * Names under the platform's managed base domains: the free `<slug>.<base>` subdomain every tenant keeps, and how to tell it from a
 * custom domain. Phase 56 (D340) made the base domains a platform table (`tenant_domain_base_domains`, read by
 * `tenant_domain.base-domains`); this file stays free of the database so the DNS sweep, the CRUD guards and the UI-facing routes share one
 * answer without loading it. `wildcardDomain()` is the environment's bootstrap wildcard (`TENANT_WILDCARD_DOMAIN`): the first row of the
 * table, and the whole answer until the table has been read in this process.
 */

/**
 * A configured host as the proxy looks it up (tenant_domain.11): lower-case, without a `:port`. The proxy strips the port of
 * the request's Host before the lookup, so a wildcard configured as `localhost:3000` must not put the port into the names it
 * builds (`acme.localhost:3000` was stored and never matched).
 */
export function hostWithoutPort(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

/** The environment's bootstrap wildcard domain (port-less), or null when subdomains are not offered (self-hosted, path mode). */
export function wildcardDomain(): string | null {
  const configured = env.TENANT_WILDCARD_DOMAIN ? hostWithoutPort(env.TENANT_WILDCARD_DOMAIN) : '';
  return configured || null;
}

/**
 * The managed base domains this process last read (`tenant_domain.base-domains` sets it after every load), on `globalThis` because
 * Next evaluates a module once per bundle graph (instrumentation, the proxy, route handlers) and every graph must see the same list.
 */
const SNAPSHOT = Symbol.for('nb.tenant_domain.baseDomains');
type SnapshotHolder = { [SNAPSHOT]?: ReadonlyArray<Required<BaseDomainRef>> };

export function setBaseDomainSnapshot(list: BaseDomains): void {
  (globalThis as SnapshotHolder)[SNAPSHOT] = baseDomainRefs(list);
}

/**
 * The managed base domains as this process knows them now, synchronously: the last list read from the table, else the bootstrap
 * wildcard alone. Async paths call `baseDomainList()` (which loads and refreshes); this is for the pure helpers' defaults.
 */
export function currentBaseDomains(): ReadonlyArray<Required<BaseDomainRef>> {
  const loaded = (globalThis as SnapshotHolder)[SNAPSHOT];
  if (loaded && loaded.length) return loaded;
  return baseDomainRefs(wildcardDomain());
}

/** Whether `domain` is a subdomain of a managed tenants' base domain (free, platform-served), as opposed to a custom domain. */
export function isWildcardSubdomain(domain: string, bases: BaseDomains = currentBaseDomains()): boolean {
  return isUnderWildcard(domain, bases);
}

/** The tenants' base domain `domain` sits under (the longest), or null. */
export function baseDomainOf(domain: string, bases: BaseDomains = currentBaseDomains()): string | null {
  return tenantBaseOf(domain, bases);
}

/** The free subdomain a slug names under ONE base domain, or null without a slug or a base domain. */
export function freeSubdomainName(slug: string | null | undefined, base: string | null = wildcardDomain()): string | null {
  return slug && base ? `${slug}.${base}` : null;
}

/** Every name the slug's free subdomain could have, one per tenants' base domain. */
export function freeSubdomainNames(slug: string | null | undefined, bases: BaseDomains = currentBaseDomains()): string[] {
  if (!slug) return [];
  return baseDomainRefs(bases).filter((b) => b.purpose === 'tenants').map((b) => `${slug}.${b.name}`);
}

/**
 * Whether removing (or switching off) `row` would leave the tenant without its free subdomain: it is the one named
 * after the slug (under any managed base domain), or the only platform subdomain the tenant has (a tenant renamed before the slug was
 * followed keeps its old one until the next reconcile). Extra platform subdomains a tenant added itself are not protected.
 */
export function isProtectedSubdomain(
  row: { tenantDomainId: string; domain: string },
  tenantRows: Array<{ tenantDomainId: string; domain: string }>,
  slug: string | null | undefined,
  bases: BaseDomains = currentBaseDomains(),
): boolean {
  if (!isUnderWildcard(row.domain, bases)) return false;
  if (freeSubdomainNames(slug, bases).includes(row.domain)) return true;
  return !tenantRows.some((d) => d.tenantDomainId !== row.tenantDomainId && isUnderWildcard(d.domain, bases));
}
