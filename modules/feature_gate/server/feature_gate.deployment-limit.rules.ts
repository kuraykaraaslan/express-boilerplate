import type { EntitlementFeature } from './feature_gate.types';

/**
 * The pure half of the deployment-wide limits (fleet 3b.11): the arithmetic, with no ceiling resolution behind it, so
 * a store that counts rows can import it without loading the extension runtime. The live half is
 * `feature_gate.deployment-limit.ts`.
 */

export interface DeploymentLimitCheck {
  featureKey: string;
  /** Whether any ceiling contributor caps this key at all. */
  capped: boolean;
  allowed: boolean;
  /** The cap as a number (`-1` unlimited, `0` off), or null when uncapped. A BOOLEAN `true` is `-1`, `false` is `0`. */
  limit: number | null;
  /** The count the caller passed (the number that exists before the creation it asks about). */
  current: number;
}

/** A cap as a number: BOOLEAN on is unlimited, off is zero; a LIMIT is its value. */
export function capAsLimit(cap: EntitlementFeature): number {
  if (cap.type === 'BOOLEAN') return cap.value === 'true' ? -1 : 0;
  return Number(cap.value);
}

/** Pure: may one more be created when `current` exist under `cap`? */
export function evaluateDeploymentLimit(featureKey: string, cap: EntitlementFeature | undefined, current: number): DeploymentLimitCheck {
  if (!cap) return { featureKey, capped: false, allowed: true, limit: null, current };
  const limit = capAsLimit(cap);
  return { featureKey, capped: true, allowed: limit === -1 || current < limit, limit, current };
}
