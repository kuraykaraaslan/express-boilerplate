import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import FeatureGateService from './feature_gate.service';
import { assertHeadroom, type GateErrorPolicy, type HeadroomResult } from './feature_gate.headroom';

/**
 * Plan quotas on PERIOD counters (docs/phases/31-feature-gate/02): "this tenant may send
 * N messages this month". The gate owns the policy; WHERE the used-so-far number
 * comes from is the caller's — `tenant_usage` reads its Redis hot counter (falling
 * back to its table) and passes it in. Keeping the reader on the caller's side is
 * what stops `feature_gate` (a leaf) from importing `tenant_usage`, which already
 * requires it.
 *
 * Both functions use the result/error shape of `feature_gate.headroom` (01):
 * a refusal is `AppError(message, 403, FORBIDDEN)` with `{ key, limit, current, adding }`.
 */

export interface PeriodQuotaOptions {
  /** Units used so far in the current period, or a reader called only when the quota is finite. */
  used: number | (() => Promise<number>);
  /** Units the caller wants to consume now. Default 1. */
  adding?: number;
  /** Required: `'closed'` for cost-bearing quotas (messages, devices), `'open'` for UX ones. */
  onGateError: GateErrorPolicy;
  gracePercent?: number;
  /** The module's own refusal wording. */
  message?: string;
}

export const PERIOD_QUOTA_EXCEEDED = 'You have reached the quota for this period on your current plan';

/** Refuse (403) when consuming `adding` more would pass the plan's `quotaKey` LIMIT. */
export async function assertPeriodQuota(
  tenantId: string,
  quotaKey: string,
  options: PeriodQuotaOptions,
): Promise<HeadroomResult> {
  return assertHeadroom(tenantId, quotaKey, {
    count: options.used,
    adding: options.adding,
    onGateError: options.onGateError,
    gracePercent: options.gracePercent,
    message: options.message ?? PERIOD_QUOTA_EXCEEDED,
  });
}

export interface PeriodQuotaStatus {
  /** `Infinity` = unlimited (or ROOT, or no declared quota). */
  limit: number;
  used: number;
  /** Units still available before the ceiling; `Infinity` when unlimited. */
  remaining: number;
  /** Past the declared limit but still inside the grace ceiling. */
  inGrace: boolean;
}

/**
 * Soft mode: never throws on a refusal. For callers that THROTTLE instead of
 * refusing (a gateway that drops or slows messages once the quota is spent).
 * A gate error follows `onGateError` (`'open'` → unlimited, `'closed'` → throws).
 */
export async function checkPeriodQuota(
  tenantId: string,
  quotaKey: string,
  options: Omit<PeriodQuotaOptions, 'message' | 'adding'> & { used: number },
): Promise<PeriodQuotaStatus> {
  if (isRootTenant(tenantId)) return { limit: Infinity, used: options.used, remaining: Infinity, inGrace: false };
  try {
    const grace = options.gracePercent ? { gracePercent: options.gracePercent } : undefined;
    const result = await FeatureGateService.checkFeatureAccess(tenantId, quotaKey, options.used, grace);
    if (result.type !== 'LIMIT' || result.unlimited) {
      return { limit: Infinity, used: options.used, remaining: Infinity, inGrace: false };
    }
    const ceiling = typeof result.effectiveLimit === 'number' ? result.effectiveLimit : result.limit;
    return {
      limit: ceiling,
      used: options.used,
      remaining: Math.max(0, ceiling - options.used),
      inGrace: Boolean(result.inGrace),
    };
  } catch (error) {
    if (options.onGateError === 'open') return { limit: Infinity, used: options.used, remaining: Infinity, inGrace: false };
    throw error;
  }
}
