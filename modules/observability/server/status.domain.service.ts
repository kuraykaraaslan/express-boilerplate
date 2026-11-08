import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module'
import Logger from '@kuraykaraaslan-labs/logger'

/**
 * Hosts for status pages (observability phase 15.4).
 *
 * What the platform does and what it does not:
 *
 *  - **Default (free).** Every tenant already has its free platform subdomain; every page is reachable on it at `/status` (the default
 *    page) and `/status/p/<slug>` (the others), with no DNS and no plan. Nothing here is needed for that.
 *  - **Custom host (by plan).** A page may ask to be served at a host the tenant owns. Owning it is `tenant_domain`'s business, not
 *    ours: the host must already be registered there by this tenant (which is where the plan feature `custom_domain` and the domain
 *    cap are enforced) and must have passed its DNS check. We only ever bind a page to a host that module vouches for, and we say
 *    why when it does not.
 *
 * What is NOT here, and is recorded as an explicit dependency instead of being faked: the DNS records themselves (the tenant adds
 * them where it hosts its zone) and the certificate (issued by the reverse proxy through `tenant_domain`'s on-demand TLS gate, not
 * by this code). A page bound to a host whose DNS or certificate is not live is simply not reachable on that host yet.
 */

interface DomainRow { tenantId: string; domainStatus: string }

const NOT_READY =
  'Register this host under Domains and finish its DNS verification first, then bind it to the page'

export default class StatusDomainService {
  /**
   * Refuse a host the tenant has no verified claim to. The answer for "not registered", "registered by someone else" and "not verified
   * yet" is deliberately the same: the message never says whether another tenant owns the name.
   */
  static async assertBindable(tenantId: string, host: string): Promise<void> {
    const found = await ifActive(tenantId, 'tenant_domain', () => import('@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service'))
    if (!found) {
      throw new AppError('Custom hosts need the tenant_domain module', 409, ErrorCode.FEATURE_NOT_AVAILABLE)
    }
    let row: DomainRow | null = null
    try {
      row = (await found.default.getByDomain(host)) as DomainRow | null
    } catch (err) {
      Logger.warn(`[observability] status host lookup failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new AppError('Could not check the host right now', 503, ErrorCode.INTERNAL_ERROR)
    }
    if (!row || row.tenantId !== tenantId || (row.domainStatus !== 'VERIFIED' && row.domainStatus !== 'ACTIVE')) {
      throw new AppError(NOT_READY, 409, ErrorCode.CONFLICT)
    }
    // A host outside the platform wildcard is a custom domain: it needs the plan today, not only on the day it was registered.
    const entitlement = await ifActive(tenantId, 'tenant_domain', () => import('@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.entitlement'))
    if (entitlement && !(await isPlatformSubdomain(host, found.default as { managedBases?: () => Promise<unknown> }))) {
      const { allowed } = await entitlement.resolveDomainEntitlement(tenantId)
      if (!allowed) throw new AppError('Custom domains are not part of the current plan', 403, ErrorCode.FEATURE_NOT_AVAILABLE)
    }
  }
}

/**
 * A name under one of the platform's managed base domains (tenant_domain phase 56: a list, the longest match wins) is a platform
 * subdomain, not a custom domain. The list comes from tenant_domain's facade; the environment's wildcard when it has none to give.
 */
async function isPlatformSubdomain(host: string, service: { managedBases?: () => Promise<unknown> }): Promise<boolean> {
  try {
    const { isUnderWildcard } = await import('@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.serving')
    if (typeof service.managedBases === 'function') {
      return isUnderWildcard(host, (await service.managedBases()) as Parameters<typeof isUnderWildcard>[1])
    }
    const { env } = await import('@kuraykaraaslan-labs/env')
    return isUnderWildcard(host, (env.TENANT_WILDCARD_DOMAIN || '').toLowerCase() || null)
  } catch { return false }
}
