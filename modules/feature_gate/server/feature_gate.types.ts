/**
 * The vocabulary of plan-based feature gating, owned by no subscription rail.
 *
 * These types used to live in `tenant_subscription.types`, which meant that
 * asking "is this tenant allowed to send mail" required importing the tenant
 * billing rail — see the module README for why that was the wrong shape
 * (DUP-01, step 5).
 */

/** What a gate check concluded. */
export type FeatureAccessResult =
  | {
      allowed: boolean
      featureKey: string
      type: 'BOOLEAN'
      limit: null
      unlimited: null
      current: null
      /**
       * Whether a live entitlement actually NAMED this key.
       *
       * `allowed: false` alone cannot be acted on, because it is also the
       * answer for a key no plan has ever heard of. A gate that treats the two
       * the same switches a live capability OFF for every tenant on the day it
       * ships — the regression commerce plan 09 §6.1/2 forbids in as many
       * words. A new entitlement gate therefore refuses only when
       * `declared && !allowed`.
       *
       * LIMIT results do not carry it: `type === 'LIMIT'` already proves the
       * key was found, which is why the `max_variants_per_product` guard could
       * be written without one.
       */
      declared: boolean
    }
  | {
      allowed: boolean
      featureKey: string
      type: 'LIMIT'
      limit: number           // -1 means unlimited
      unlimited: boolean
      current: number | null  // null when currentCount not provided
      gracePercent: number    // 0 = hard limit
      effectiveLimit: number  // limit + grace ceiling (-1 when unlimited)
      inGrace: boolean        // true when limit < current <= effectiveLimit
    }

/** One entitlement as an source reports it. */
export interface EntitlementFeature {
  key: string
  /** 'BOOLEAN' | 'LIMIT' */
  type: string
  /** `'true'`/`'false'` for BOOLEAN; a stringified integer for LIMIT (-1 = unlimited). */
  value: string
  /**
   * A LIMIT that adds to the declared one instead of competing with it (a usage pack, docs/phases/53-setting-levels 53.9,
   * D170): `mergeFeatures` adds it on top of the most generous non-additive row. Ignored on a BOOLEAN.
   */
  additive?: boolean
}

/**
 * What an entitlement source knows about a tenant right now.
 *
 * `status` and `gracePeriodEndsAt` exist because entitlement is not only "which
 * features" but "is the arrangement still live" — a lapsed subscriber keeps its
 * feature rows and must still be refused, while one inside its grace window must
 * not be.
 */
export interface EntitlementState {
  /** Source-defined lifecycle state; `ACTIVE`/`TRIALING` grant, others do not. */
  status: string
  /** ISO timestamp, or null. A `PAST_DUE` tenant still inside it keeps access. */
  gracePeriodEndsAt: string | null
  features: EntitlementFeature[]
  /**
   * "Grant everything, do not consult `features`."
   *
   * For arrangements that are not a feature list at all: the platform operator
   * (ROOT), or a comped account. Without it such a tenant would have to be
   * expressed as an exhaustive feature list that every new key silently breaks —
   * the enumeration is unbounded, so the only honest answer is a wildcard.
   *
   * Never a fallback for "the source could not read its rows"; that must throw.
   */
  grantsAll?: boolean
}

/**
 * A contribution to `feature_gate:entitlement_source`.
 *
 * Returns `null` when the source has no arrangement for this tenant at all —
 * meaningfully different from returning a state with an inactive `status`, which
 * says "there is an arrangement and it is not live".
 *
 * Called on the cache-miss path of a hot check, so keep it to indexed reads.
 */
export type EntitlementSource = (tenantId: string) => Promise<EntitlementState | null>

/**
 * A contribution to `feature_gate:entitlement_ceiling` (fleet step 3b.10, decision F23): a deployment-wide CAP,
 * applied after the additive merge of the sources as a minimum (`feature_gate.ceiling.ts`). Never a grant.
 */
export interface EntitlementCeilingProvider {
  /**
   * The caps that hold for the whole deployment right now, or `null` when this contributor caps nothing (which is
   * not the same as `[]`, but has the same effect). Called on a memo miss of a hot check: keep it cheap. May throw.
   */
  ceiling(): Promise<ReadonlyArray<EntitlementFeature> | null>
  /**
   * What applies when `ceiling()` throws or hangs: the un-licensed baseline (S11 rule 5), never "everything off".
   * Synchronous and must not throw; if it does, the check fails closed.
   */
  baseline(): ReadonlyArray<EntitlementFeature> | null
  /**
   * Optional: the deployment's signed licence file (`{ license, sig }`) while it holds, or null. A protected pack (dashboard phase 33,
   * ADR-0016) verifies it in the browser to check the origin it runs on; the ticket route hands it out. May throw (= none).
   */
  signedLicence?(): Promise<{ license: object; sig: string } | null>
  /** Optional: the vendor keys of the platform trust root (`{ kid, publicKey }`), which a development build of a protected pack embeds. */
  vendorKeys?(): ReadonlyArray<{ kid: string; publicKey: string }> | null
}

/**
 * A contribution to `feature_gate:deployment_usage` (fleet step 3b.11): how many of each deployment-wide counted thing
 * exist right now, for the console next to the cap (S11 rule 7). The module that owns the rows answers its own keys
 * (`tenant`: `tenants`; `fleet` on a control plane: `nodes`, `regions`) and `{}` when it counts nothing here. Display
 * only: enforcement recounts under its own lock and never reads this.
 */
export type DeploymentUsageProvider = () => Promise<Readonly<Record<string, number>>>

/** One row of the console's deployment limits (`deploymentCapsReport`). */
export interface DeploymentCapReport {
  key: string
  type: 'BOOLEAN' | 'LIMIT'
  value: string
  /** The cap as a number: `-1` unlimited, `0` off. */
  limit: number
  /** How many exist now, or null when no contributor counts this key (or its counter could not answer). */
  current: number | null
}

export interface FeatureCheckOptions {
  /**
   * Percentage of the limit a tenant may exceed before being refused. `0` is a
   * hard limit. Lets a caller soften a ceiling it knows is disruptive to hit
   * mid-operation without editing the plan.
   */
  gracePercent?: number
  /**
   * `false` skips the `feature.access.checked` audit row for this check.
   *
   * For internal probes that run on every request and only READ a plan value,
   * such as the limiter asking for `api_rate_limit` to size its window. The
   * probe is not a decision about the tenant, its outcome is usually "no plan
   * declares it", and auditing it cost a hash-chained row (under the tenant's
   * advisory lock) per API call. What the probe feeds into is recorded where
   * it happens: a breached rate limit is counted and logged by the limiter.
   * Defaults to `true`, so every real gate decision stays audited.
   */
  audit?: boolean
}
