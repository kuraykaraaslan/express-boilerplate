import { isReservedPlatformLabel, isReservedSubdomainLabel, isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';

/**
 * The ONE answer to "does this domain row serve traffic?", shared by the proxy's host resolution, the TLS `ask` hook
 * (caddy-ask) and the origin resolver (links), so the three cannot drift (risk register tenant_domain.01). Pure and
 * dependency-free on purpose: the proxy imports it, and takes the platform's managed base domains (phase 56: a list, the longest
 * match wins; one name still works) as an argument instead of reading the env module or the database.
 *
 *   - A subdomain of the platform wildcard serves while it exists, whatever its status: it lives under the platform's
 *     own wildcard certificate and needs no DNS proof, so the free `<slug>.<wildcard>` every tenant keeps never stops
 *     serving because of a status flip. Two refusals only: SUSPENDED (the platform's verdict, set by the reconcile on a
 *     reserved name) and a reserved name (admin., www., api., auth., app. ...) held by a customer tenant. The reserved
 *     platform tenants (root, fleet) are exempt.
 *   - A custom domain serves only when ACTIVE (a status `update` writes only after DNS verification, and the DNS sweep
 *     takes back with the proof), or VERIFIED (`verifiedAt` set) with a certificate seen serving (sslStatus ACTIVE /
 *     EXPIRING): the origin resolver's long-standing rule. PENDING (DNS not proven: anyone could register a host they
 *     do not control), INACTIVE, DNS_FAILED and SUSPENDED never serve.
 */
export interface ServingCandidate {
  tenantId?: string | null;
  domain: string;
  domainStatus: string;
  verifiedAt?: Date | string | null;
  sslStatus?: string | null;
}

/**
 * The platform's managed base domains (phase 56, D340) as the serving rule reads them: a name and what it is for. `tenants` (the default)
 * holds tenants' `<label>.<base>` subdomains; `wildcard_only` (the LoRaWAN server's `lns.<apex>`) only gets the wildcard certificate and
 * never holds a tenant. Callers pass the list (`baseDomainList()`), one name (a test, the environment's bootstrap wildcard), or nothing.
 */
export type BaseDomainPurpose = 'tenants' | 'wildcard_only';
export interface BaseDomainRef { name: string; purpose?: BaseDomainPurpose }
export type BaseDomains = string | readonly (string | BaseDomainRef)[] | null | undefined;

/** A base domain in its one spelling: lower case, no port, no trailing dot. */
function baseName(raw: string): string {
  return raw.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** The list form of `bases`, each spelt once. */
export function baseDomainRefs(bases: BaseDomains): Array<Required<BaseDomainRef>> {
  if (!bases) return [];
  const list = typeof bases === 'string' ? [bases] : bases;
  const out: Array<Required<BaseDomainRef>> = [];
  for (const b of list) {
    const ref = typeof b === 'string' ? { name: b } : b;
    const name = baseName(ref.name ?? '');
    if (name) out.push({ name, purpose: ref.purpose ?? 'tenants' });
  }
  return out;
}

/** The LONGEST managed base domain `domain` sits strictly below (`x.dev.roltek.xyz` → `dev.roltek.xyz` before `roltek.xyz`), or null. */
export function matchBaseDomain(domain: string, bases: BaseDomains): Required<BaseDomainRef> | null {
  const d = baseName(domain);
  let best: Required<BaseDomainRef> | null = null;
  for (const b of baseDomainRefs(bases)) {
    if (d.endsWith(`.${b.name}`) && (!best || b.name.length > best.name.length)) best = b;
  }
  return best;
}

/** The tenants' base domain `domain` is a platform subdomain of, or null (a custom domain, or a name under a `wildcard_only` base). */
export function tenantBaseOf(domain: string, bases: BaseDomains): string | null {
  const m = matchBaseDomain(domain, bases);
  return m && m.purpose === 'tenants' ? m.name : null;
}

/** `domain` is under a managed tenants' base domain (a platform-served name), not a custom domain. */
export function isUnderWildcard(domain: string, bases: BaseDomains): boolean {
  return tenantBaseOf(domain, bases) !== null;
}

/** `domain` is under a `wildcard_only` base domain: the platform's own service names, never a tenant's. */
export function isUnderWildcardOnlyBase(domain: string, bases: BaseDomains): boolean {
  return matchBaseDomain(domain, bases)?.purpose === 'wildcard_only';
}

/**
 * The base domain whose wildcard certificate covers `host` (phase 56, D344): a wildcard covers exactly ONE label, so `a.roltek.xyz` is
 * covered by `*.roltek.xyz` and `a.b.roltek.xyz` is not (it needs `*.b.roltek.xyz`, a base of its own). Longest base first; any purpose.
 */
export function wildcardCoverOf(host: string, bases: BaseDomains): string | null {
  const h = baseName(host);
  const m = matchBaseDomain(h, bases);
  if (!m) return null;
  const label = h.slice(0, -(m.name.length + 1));
  return label && !label.includes('.') ? m.name : null;
}

/**
 * A platform subdomain whose name is reserved (any label left of its base domain) while a customer tenant holds it. False
 * for custom domains and for the reserved platform tenants.
 */
export function isReservedWildcardName(domain: string, bases: BaseDomains, tenantId?: string | null): boolean {
  const base = tenantBaseOf(domain, bases);
  if (!base || isReservedTenant(tenantId)) return false;
  const prefix = domain.toLowerCase().slice(0, -(`.${base}`.length));
  // The leftmost label is the tenant's own: every reserved word. A deeper label is the operator's zone (`<slug>.dev.<wildcard>`):
  // only the platform's surfaces (admin., auth., api. ...) are refused there.
  return prefix.split('.').some((label, i) => (i === 0 ? isReservedSubdomainLabel(label) : isReservedPlatformLabel(label)));
}

/** May a TLS certificate be issued for this host: a servable platform name, or a custom domain with proven DNS. */
export function isCertEligibleDomain(d: ServingCandidate, bases: BaseDomains): boolean {
  if (d.domainStatus === 'SUSPENDED') return false;
  // A name under a `wildcard_only` base is the platform's own service (phase 56): no tenant row there serves or is ordered for.
  if (isUnderWildcardOnlyBase(d.domain, bases)) return false;
  if (isUnderWildcard(d.domain, bases)) return !isReservedWildcardName(d.domain, bases, d.tenantId);
  return d.domainStatus === 'ACTIVE' || (d.domainStatus === 'VERIFIED' && !!d.verifiedAt);
}

/** Does the proxy route this host to its tenant (and are links to it linkable). */
export function isServingDomain(d: ServingCandidate, bases: BaseDomains): boolean {
  if (!isCertEligibleDomain(d, bases)) return false;
  if (isUnderWildcard(d.domain, bases)) return true;
  return d.domainStatus === 'ACTIVE'
    || (d.domainStatus === 'VERIFIED' && (d.sslStatus === 'ACTIVE' || d.sslStatus === 'EXPIRING'));
}
