import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { platformTenantUrl, tenancyMode, tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';
import TenantDomainCrudService from './tenant_domain.crud.service';
import { resolveDomainEntitlement } from './tenant_domain.entitlement';
import { managedBases } from './tenant_domain.base-domains';
import { isUnderWildcard, isServingDomain } from './tenant_domain.serving';
import type { SafeTenantDomain } from './tenant_domain.types';

/**
 * Absolute URLs for links that LEAVE the app — emails, push payloads, webhook
 * bodies. Anything the recipient opens in a fresh browser, where there is no
 * current host to be relative to.
 *
 * `APPLICATION_HOST` is the *platform* host. In domain mode a clean path there
 * resolves to the ROOT tenant, so `${APP_HOST}${tenantPath(id, '/admin/x')}`
 * would quietly send a customer into the platform workspace. Hence: resolve the
 * tenant's own primary domain and build the link on that host, and only fall
 * back to `${APP_HOST}${crossTenantPath(...)}` — the explicit `/tenant/{id}`
 * form, which proxy.ts serves on any host — when the tenant has no usable
 * domain yet.
 *
 * Other modules do not import this file: they call common/server/tenant-url,
 * which reads `tenantOrigin` through the `common:tenant_origin` point
 * (tenant_domain.tenant-origin.ts) and falls back the same way. tenant_domain's
 * own notices keep using it directly.
 *
 * NOT for machine-to-machine URLs registered with a third party (SAML
 * EntityID/ACS, OAuth redirect_uri, national-id ACS base). Those are stable
 * identifiers the customer pasted into their IdP; rebasing them onto a domain
 * that can later change breaks the integration with an error the tenant admin
 * cannot diagnose. Those sites stay on APPLICATION_HOST deliberately.
 */

const APP_HOST = env.APPLICATION_HOST ?? 'http://localhost:3000';

/** Scheme inherited from APPLICATION_HOST so dev stays on http. */
function scheme(): string {
  try {
    return new URL(APP_HOST).protocol;
  } catch {
    return 'https:';
  }
}

/**
 * The domain a link to this tenant should use, or null when it has none (owner direction 2026-10-17: every tenant
 * keeps a free subdomain; custom domains follow the plan):
 *
 *   1. its primary domain, when that serves (`isServingDomain`): the free subdomain unless it is a reserved name; a
 *      custom domain while it is ACTIVE, or VERIFIED with a certificate seen serving (sslStatus ACTIVE / EXPIRING),
 *      with proven DNS, AND the plan includes custom domains;
 *   2. otherwise its free `<slug>.<wildcard>` subdomain (a PENDING, failed or suspended primary is never linked to:
 *      a dead host is strictly worse than the address that always works);
 *   3. otherwise null, and the caller links on the platform host (`platformTenantUrl`).
 */
export async function tenantOriginDomain(tenantId: string): Promise<string | null> {
  const primary = await TenantDomainCrudService.getPrimaryByTenantId(tenantId);
  if (primary && await primaryIsLinkable(tenantId, primary)) return primary.domain;
  const free = await TenantDomainCrudService.getFreeSubdomainByTenantId(tenantId);
  return free?.domain ?? null;
}

async function primaryIsLinkable(tenantId: string, d: SafeTenantDomain): Promise<boolean> {
  // The same predicate the proxy and the TLS ask use (tenant_domain.serving): a link never points at a host that does not serve.
  const bases = await managedBases();
  if (!isServingDomain(d, bases)) return false;
  if (isUnderWildcard(d.domain, bases)) return true;
  // A custom domain the plan no longer includes is suspended by the reconcile; until that runs, links already move.
  // Fails open (a gate outage keeps the custom domain), like every other read of this entitlement outside the reconcile.
  return (await resolveDomainEntitlement(tenantId, { audit: false })).allowed;
}

/**
 * The tenant's own origin, or null when it has none we should link to (see `tenantOriginDomain`).
 *
 * Path mode always returns null: there is one host, and the tenant is selected by the path prefix instead.
 */
export async function tenantOrigin(tenantId: string): Promise<string | null> {
  if (tenancyMode() === 'path') return null;
  try {
    const domain = await tenantOriginDomain(tenantId);
    return domain ? `${scheme()}//${domain}` : null;
  } catch (error) {
    // Best-effort: a redis/DB blip must never break the notification that was
    // trying to build this link.
    Logger.debug(`tenantOrigin: domain lookup failed for ${tenantId}: ${String(error)}`);
    return null;
  }
}

/**
 * Absolute URL for `appPath` (tenant-relative, e.g. `/admin/domains/{id}`)
 * pointing at `tenantId`.
 *
 *   domain mode + a domain that serves → https://acme.example.com/admin/domains/x
 *   otherwise                          → {APP_HOST}/tenant/{id}/admin/domains/x
 *                                         (path mode: {APP_HOST}/t/{id}/…)
 */
export async function absoluteTenantUrl(tenantId: string, appPath: string): Promise<string> {
  const origin = await tenantOrigin(tenantId);
  if (origin) return `${origin}${tenantPath(tenantId, appPath)}`;
  return platformTenantUrl(APP_HOST, tenantId, appPath);
}
