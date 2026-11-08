import 'reflect-metadata';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { featureGateEntitlementSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/feature_gate.entitlement_source';
import { FEATURE_GATE_MESSAGES } from './feature_gate.messages';
import { getFeatureCache, setFeatureCache, invalidateFeatureCache as dropFeatureCache, logFeatureAccess } from './feature_gate.cache';
import { announceEntitlementChange } from './feature_gate.entitlement-changed';
import { resolveCeiling, capFeature, graceCeiling, GRANTS_ALL } from './feature_gate.ceiling';
import { parseLimitValue } from './feature_gate.limit-value';
import { mergeFeatures } from './feature_gate.merge';

export { mergeFeatures };
import type {
  EntitlementFeature,
  EntitlementSource,
  EntitlementState,
  FeatureAccessResult,
  FeatureCheckOptions,
} from './feature_gate.types';

/**
 * Plan-based feature gating, as a leaf.
 *
 * ## Why this module exists
 *
 * "Is this tenant allowed to send mail / upload / call the AI" is a question
 * FIFTEEN modules ask — ai, api_key, commerce_catalog, dynamic_page, gift_card,
 * integrations_hub, invoice, notification_mail, notification_sms, storage,
 * tenant, tenant_invitation, tenant_member, tenant_usage, webhook. Until 2026-08
 * they asked it by importing `tenant_subscription`, the TENANT BILLING RAIL, and
 * therefore had to `require` it: a mail queue could not be installed without the
 * module that sells plans to tenants.
 *
 * It also made the dependency graph unreadable. Five of the repo's unexpected
 * mutual-import pairs — `invoice`, `notification_mail`, `tenant_member`,
 * `commerce_catalog`, `tenant_usage` — existed for no reason other than this one
 * call, and it is why `tenant_subscription` had to be exempted from the cycle
 * report at all (audit 2026-08, DUP-01 step 5).
 *
 * ## The inversion
 *
 * This module owns the POLICY: what BOOLEAN and LIMIT mean, how a grace
 * percentage widens a ceiling, that a lapsed arrangement refuses while one still
 * inside its grace window does not, and the Redis cache in front of all of it.
 * It owns no table and knows nothing about plans, prices or subscriptions.
 *
 * Where a tenant's entitlements come FROM is contributed, through
 * `feature_gate:entitlement_source`. `tenant_subscription` contributes today's
 * answer (its subscription row plus the plan's feature rows). A later
 * licence-key or admin-grant module can contribute alongside it without either
 * knowing the other exists.
 *
 * ## No source installed = no gating
 *
 * With zero sources the gate ALLOWS. That is the point of the split rather than
 * a loophole: before it, those fifteen modules could not exist without the
 * billing rail, so "no rail" was unreachable. Now it is reachable, and it means
 * "nothing here sells plans" — an install with no subscription module must not
 * have its own mail queue refuse to send. It stays sharply distinct from a
 * source that IS installed and answers no.
 *
 * A source that THROWS is the other case and is not swallowed: the gate fails
 * closed (500). A source that cannot answer is not a source that is absent, and
 * granting an entitlement nobody could verify is how paid features leak.
 *
 * Server-only; kept React-free.
 */

/** Extension point id — declared in feature_gate/module.json `extensionPoints`. */
export const FEATURE_GATE_SOURCE_POINT = 'feature_gate:entitlement_source';

/** Lifecycle states an entitlement source may report that still grant access. */
const ACTIVE_STATUSES = ['ACTIVE', 'TRIALING'];

/**
 * Cached status for "sources exist and none holds a live arrangement". Not a
 * source status and deliberately outside ACTIVE_STATUSES, so a cache hit
 * refuses exactly as the fresh read did.
 */
const NO_LIVE_ENTITLEMENT = 'NONE';

/**
 * `declared` says whether a live entitlement named the key. Every one of these
 * refusals is "we never heard of it" rather than "a plan says no", and a caller
 * gating a capability has to be able to tell the two apart — see the field's
 * own docs on `FeatureAccessResult`.
 */
const deniedBoolean = (featureKey: string, declared = false): FeatureAccessResult => ({
  allowed: false, featureKey, type: 'BOOLEAN', limit: null, unlimited: null, current: null, declared,
});

const ungated = (featureKey: string): FeatureAccessResult => ({
  allowed: true, featureKey, type: 'BOOLEAN', limit: null, unlimited: null, current: null, declared: false,
});

/**
 * Ask every registered source about a tenant.
 *
 * Returns `null` when NO source is installed — the ungated case — as opposed to
 * an empty array, which means sources exist and none of them knows this tenant.
 * Throws when a source cannot answer, including one the runtime has paused after
 * repeated errors (the gate then fails closed, see above).
 *
 * The point's `platform` gate keeps the sources asked whatever the tenant switched on: they are the billing rail,
 * which a tenant must not lift by switching its module off (the reasoning of `module_lifecycle:entitlement`).
 */
async function collectEntitlements(tenantId: string): Promise<EntitlementState[] | null> {
  const { results, failed } = await ext.aggregate<EntitlementSource, EntitlementState | null>(
    FEATURE_GATE_SOURCE_POINT, tenantCtx(tenantId), featureGateEntitlementSourceLoaders,
    (resolve) => resolve(tenantId),
  );
  if (failed.length) {
    throw new Error(`entitlement source could not answer: ${failed.map((f) => `${f.moduleId} (${f.reason}: ${f.message})`).join(', ')}`);
  }
  if (results.length === 0) return null;
  return results.map((r) => r.value).filter((s): s is EntitlementState => s !== null);
}


/** Whether a reported state still grants anything at all. */
function isLive(state: EntitlementState): boolean {
  if (ACTIVE_STATUSES.includes(state.status)) return true;
  return state.status === 'PAST_DUE'
    && state.gracePeriodEndsAt !== null
    && new Date(state.gracePeriodEndsAt) > new Date();
}

/** Whether a reported state has the shape the contract promises. */
function isWellFormed(state: EntitlementState): boolean {
  return typeof state.status === 'string' && Array.isArray(state.features);
}

/** The BOOLEAN/LIMIT arithmetic for one (already capped) feature. */
function evaluate(featureKey: string, feature: EntitlementFeature, currentCount: number | undefined, gracePercent: number): FeatureAccessResult {
  if (feature.type === 'BOOLEAN') {
    // Found in a live entitlement (or set by the ceiling) — so a `false` here IS a plan, or the license, saying no.
    return { allowed: feature.value === 'true', featureKey, type: 'BOOLEAN', limit: null, unlimited: null, current: null, declared: true };
  }
  const limit = parseLimitValue(feature.value);
  const unlimited = limit === -1;
  const current = currentCount ?? null;
  const ceiling = unlimited ? -1 : graceCeiling(limit, gracePercent);
  const inGrace = !unlimited && current !== null && current >= limit && current < ceiling;
  // feature_gate.07 (fixed 2026-10-20): a count that is not a finite, non-negative number (a counter driven below zero by a double
  // decrement, NaN) is refused; a negative count used to pass every ceiling, a LIMIT of 0 included.
  const validCount = currentCount === undefined || (Number.isFinite(currentCount) && currentCount >= 0);
  const allowed = !validCount ? false : currentCount !== undefined ? unlimited || currentCount < ceiling : true;
  return { allowed, featureKey, type: 'LIMIT', limit, unlimited, current, gracePercent, effectiveLimit: ceiling, inGrace };
}

/**
 * Resolve one feature for a tenant.
 *
 * `currentCount` is only meaningful for LIMIT features; omitting it asks "is
 * this feature available at all" rather than "may I add one more", which is why
 * a LIMIT check without a count is allowed rather than refused.
 */
export async function checkFeatureAccess(
  tenantId: string,
  featureKey: string,
  currentCount?: number,
  options?: FeatureCheckOptions,
): Promise<FeatureAccessResult> {
  // Every exit below goes through `record`, so an `audit: false` caller is
  // honoured on the refusal paths too and not only on the final result.
  const record = (result: FeatureAccessResult): void => {
    if (options?.audit !== false) logFeatureAccess(tenantId, result);
  };

  try {
    // The deployment ceiling (3b.10, F23): applied after the additive merge, on every answer the plan side gives,
    // including "no source installed" and wildcard arrangements; a cap is global, above every tenant's plan (S11).
    const cap = (await resolveCeiling())?.get(featureKey);
    const gracePercent = options?.gracePercent ?? 0;
    const finish = (base: EntitlementFeature | typeof GRANTS_ALL | undefined): FeatureAccessResult => {
      const feature = capFeature(base, cap, currentCount, gracePercent);
      if (feature === GRANTS_ALL) return ungated(featureKey);
      const result = feature ? evaluate(featureKey, feature, currentCount, gracePercent) : deniedBoolean(featureKey);
      record(result);
      return result;
    };

    let cached = (options as { bypassCache?: boolean } | undefined)?.bypassCache ? null : await getFeatureCache(tenantId);

    if (!cached) {
      const states = await collectEntitlements(tenantId);
      if (states === null) return finish(GRANTS_ALL);       // nothing sells plans here
      const live = states.filter(isLive);
      if (live.length === 0) {
        // Cached too, under a status the hit path below already refuses. Left
        // uncached, a tenant with no subscription re-ran the source query on
        // every gated request (the limiter probe alone is one per API call).
        // Safe for the same TTL as a live entry: a non-live arrangement only
        // becomes live through a subscription write, and every one of those
        // invalidates this key.
        // Only for well-formed answers: a source returning garbage (a numeric
        // status, no feature list) is refused now but must not have that
        // refusal outlive its own fault for the whole TTL.
        if (states.every(isWellFormed)) await setFeatureCache(tenantId, NO_LIVE_ENTITLEMENT, null, []);
        record(deniedBoolean(featureKey));
        return deniedBoolean(featureKey);
      }
      // A wildcard arrangement (the platform operator, a comped account) short-
      // circuits before the feature lookup and is NOT cached: it is cheap to
      // re-derive and caching a blanket grant is the worst cache entry to have
      // to invalidate correctly.
      if (live.some((s) => s.grantsAll)) return finish(GRANTS_ALL);
      // Entitlements are additive: a tenant holding both a subscription and a
      // granted bundle gets the union. Merging here rather than picking a
      // winning source is what lets a second source be added later without
      // re-deciding precedence for every key.
      const features = mergeFeatures(live.flatMap((s) => s.features));
      // Cached as ACTIVE because liveness (including the grace window) has just
      // been evaluated — re-storing a PAST_DUE status would make the cached copy
      // refuse what the fresh read allowed.
      // feature_gate.06 (fixed 2026-10-20): when an arrangement is live only through its grace period, the cached verdict carries the
      // earliest grace end, and a read after it recomputes (below). It used to be cached as plain ACTIVE for the whole TTL.
      const graceEnds = live.filter((s) => !ACTIVE_STATUSES.includes(s.status) && s.gracePeriodEndsAt)
        .map((s) => new Date(s.gracePeriodEndsAt as string).getTime());
      const graceEnd = graceEnds.length ? new Date(Math.min(...graceEnds)) : null;
      cached = { status: 'ACTIVE', gracePeriodEndsAt: graceEnd ? graceEnd.toISOString() : null, features };
      await setFeatureCache(tenantId, cached.status, graceEnd, features);
    } else if (cached.gracePeriodEndsAt && new Date(cached.gracePeriodEndsAt).getTime() <= Date.now()) {
      // The grace period the cached verdict relied on has ended: ask the sources again.
      return checkFeatureAccess(tenantId, featureKey, currentCount, { ...options, bypassCache: true } as FeatureCheckOptions);
    }

    if (!ACTIVE_STATUSES.includes(cached.status)) {
      record(deniedBoolean(featureKey));
      return deniedBoolean(featureKey);
    }

    return finish(cached.features.find((f) => f.key === featureKey));
  } catch (error) {
    Logger.error(`${FEATURE_GATE_MESSAGES.FEATURE_CHECK_FAILED}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof AppError) throw error;
    throw new AppError(FEATURE_GATE_MESSAGES.FEATURE_CHECK_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/** {@link checkFeatureAccess}, but a refusal is a 403 instead of a return value. */
export async function assertFeatureAccess(
  tenantId: string,
  featureKey: string,
  currentCount?: number,
  options?: FeatureCheckOptions,
): Promise<FeatureAccessResult> {
  const result = await checkFeatureAccess(tenantId, featureKey, currentCount, options);

  if (!result.allowed) {
    const message = result.type === 'LIMIT'
      ? FEATURE_GATE_MESSAGES.FEATURE_LIMIT_REACHED
      : FEATURE_GATE_MESSAGES.FEATURE_ACCESS_DENIED;
    throw new AppError(message, 403, ErrorCode.FEATURE_NOT_AVAILABLE);
  }

  return result;
}

/**
 * Drop the tenant's cached entitlements after a write that changed them, and announce the change
 * (`feature_gate:entitlement_changed`, detached) to the modules that keep state derived from it.
 * Every caller already calls this right after such a write commits, which is what makes it the announcement point.
 */
export async function invalidateFeatureCache(tenantId: string): Promise<void> {
  await dropFeatureCache(tenantId);
  await announceEntitlementChange(tenantId);
}

/**
 * Class facade preserving the `…FeatureGateService.checkFeatureAccess(…)` call
 * shape its fifteen consumers already use — only the import path changes.
 */
export default class FeatureGateService {
  static checkFeatureAccess = checkFeatureAccess;
  static assertFeatureAccess = assertFeatureAccess;
  static invalidateFeatureCache = invalidateFeatureCache;
}
