import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'

/**
 * Plan entitlements for custom domains.
 *
 * ## The defect this closes
 *
 * `custom_domain` and `max_domains` are plan features the product sells, and
 * **nothing read either of them**. The ceiling that was actually enforced came
 * from a per-tenant SETTING (`maxDomains`, default 3) — which a tenant admin can
 * edit. So the paid limit was not merely absent, it was overridable by the
 * person it was meant to bind. (Same shape as `api_rate_limit` before DEP-12,
 * and the notification toggles before PLAT-01.)
 *
 * ## Two sources of truth, and which wins
 *
 * The setting is NOT removed: a self-hosted install, a free-mode deployment and
 * the root tenant all have no plan, and the setting is the only answer there. So
 * the rule is **the plan wins when it says anything at all**, and the setting is
 * the floor everywhere else. A tenant on a plan cannot raise its own ceiling; a
 * tenant without one keeps the behaviour it had.
 *
 * ## Subdomains of the platform wildcard are NOT custom domains
 *
 * `acme.example.com` is the free self-service path every tenant gets — gating it
 * behind a paid feature would take working sites off the air on the day this
 * shipped. Only a domain the tenant owns is a custom domain, and only those are
 * counted or refused here.
 *
 * Every resolution FAILS OPEN. A feature-gate outage must not stop a tenant
 * pointing a domain at their site; the setting-based ceiling is still standing.
 *
 * ## The monetization kill switch is not consulted, and does not need to be
 *
 * `dynamic_page.entitlement` calls `isMonetizationEnabled()` explicitly, which
 * costs it a `tenant_subscription` dependency. Here the fallbacks already cover
 * that case: with monetization off no tenant has a subscription, so the boolean
 * comes back UNDECLARED (allowed, by the rule below) and the limit comes back as
 * a non-LIMIT (null). Adding the check would buy identical behaviour in exchange
 * for an edge from a tenancy module into the billing rail.
 */

export interface DomainEntitlement {
  /** May this tenant attach domains it owns at all? */
  allowed: boolean
  /** Plan ceiling for custom domains; `null` = the plan does not say. */
  maxDomains: number | null
}

export interface ResolveDomainEntitlementOptions {
  /**
   * Throw instead of failing open. For a caller that ACTS on the answer in both directions (the reconcile suspends and
   * reactivates domains): failing open there would reactivate every suspended domain during a feature-gate outage.
   */
  strict?: boolean
  /** Write the gate's audit row (default true). Background reads (links, the reconcile sweep) pass false. */
  audit?: boolean
}

export async function resolveDomainEntitlement(tenantId: string, opts: ResolveDomainEntitlementOptions = {}): Promise<DomainEntitlement> {
  // The root tenant IS the platform; gating it against a plan it does not have
  // would lock the operator out of their own domain settings.
  if (isRootTenant(tenantId)) return { allowed: true, maxDomains: null }

  try {
    const [{ default: FeatureGateService }, { FEATURE_KEYS }] = await Promise.all([
      import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.service'),
      import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys'),
    ])

    const options = opts.audit === false ? { audit: false } : undefined
    const [custom, max] = await Promise.all([
      FeatureGateService.checkFeatureAccess(tenantId, FEATURE_KEYS.CUSTOM_DOMAIN, undefined, options),
      FeatureGateService.checkFeatureAccess(tenantId, FEATURE_KEYS.MAX_DOMAINS, undefined, options),
    ])

    // `declared` distinguishes "this plan says no" from "no plan mentions this
    // feature". Only the first is a refusal — treating an unmentioned feature as
    // denied would switch custom domains off for every tenant whose plan predates
    // the key.
    const allowed = !(custom.type === 'BOOLEAN' && custom.declared && !custom.allowed)

    let maxDomains: number | null = null
    if (max.type === 'LIMIT' && !max.unlimited && max.limit > 0) maxDomains = max.limit

    return { allowed, maxDomains }
  } catch (err) {
    if (opts.strict) throw err
    return { allowed: true, maxDomains: null }
  }
}
