import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import FeatureGateService from './feature_gate.service';

/**
 * One helper for "limit a countable resource" (docs/phases/31-feature-gate/01).
 *
 * `checkFeatureAccess` already does the arithmetic (limit, `-1`, grace ceiling).
 * What nine modules repeated around it was the WRAPPER: the ROOT bypass, the
 * answer for an undeclared key, a free baseline, a batch ("may I add n?"), and
 * a try/catch whose fallback differed per copy. This file is that wrapper, once,
 * with one documented answer to each question:
 *
 * | Situation                                   | Answer                                        |
 * |---------------------------------------------|-----------------------------------------------|
 * | ROOT tenant                                  | unlimited                                     |
 * | Key is a LIMIT, `-1`                         | unlimited                                     |
 * | Key is a LIMIT, `n`                          | `n` (+ grace when `gracePercent` is given)    |
 * | Key undeclared / not a LIMIT / no source     | `freeBaseline`, else unlimited                |
 * | The gate itself throws                       | `onGateError`: `'open'` → unlimited, `'closed'` → the error propagates |
 *
 * Failure policy (docs/phases/31-feature-gate README, P1): `'open'` for limits that
 * protect UX (boards, widgets, languages), `'closed'` for limits that protect
 * COST (devices, messages, seats). It is REQUIRED at every call site — there is
 * deliberately no default, so a new copy cannot inherit the wrong one by accident.
 */

export type GateErrorPolicy = 'open' | 'closed';

export interface ResolveLimitOptions {
  /** What a tenant gets when no live entitlement declares the key. Omit = unlimited. */
  freeBaseline?: number;
  onGateError: GateErrorPolicy;
  /** Widen a declared ceiling by this percentage (see `FeatureCheckOptions`). */
  gracePercent?: number;
}

export interface AssertHeadroomOptions extends ResolveLimitOptions {
  /**
   * Current usage: a number already in hand, or a function called only when the
   * limit is finite. With a number the gate itself is asked about it (one call,
   * `currentCount = count + adding - 1`), so its own arithmetic decides.
   */
  count: number | (() => Promise<number>);
  /** How many the caller wants to add now (batch). Default 1. */
  adding?: number;
  /** The module's own refusal wording. */
  message: string;
  /** Error code of the refusal; default `FORBIDDEN`. Existing adopters keep theirs. */
  errorCode?: ErrorCode;
}

export interface HeadroomResult {
  /** `Infinity` = unlimited. */
  limit: number;
  /** Rows counted; `null` when the limit is unlimited and the count was skipped. */
  current: number | null;
  /** `limit - current`, floored at 0; `Infinity` when unlimited. */
  remaining: number;
}

export interface LimitCheck {
  /** Effective ceiling (grace included). `Infinity` = unlimited. */
  limit: number;
  /** Whether `probeCount` is over the ceiling; `false` when no probe was given. */
  refused: boolean;
}

/**
 * Non-throwing core: the ceiling for `key` and, when `probeCount` is given,
 * whether the gate refuses at that count. `probeCount` is passed to the gate as
 * `currentCount`, so a refusal is the gate's own `allowed: false`.
 */
export async function checkLimit(
  tenantId: string,
  key: string,
  options: ResolveLimitOptions & { probeCount?: number },
): Promise<LimitCheck> {
  if (isRootTenant(tenantId)) return { limit: Infinity, refused: false };
  const probe = options.probeCount;
  try {
    const result = options.gracePercent
      ? await FeatureGateService.checkFeatureAccess(tenantId, key, probe, { gracePercent: options.gracePercent })
      : await FeatureGateService.checkFeatureAccess(tenantId, key, probe);
    if (result.type === 'LIMIT') {
      if (result.unlimited) return { limit: Infinity, refused: false };
      const limit = typeof result.effectiveLimit === 'number' ? result.effectiveLimit : result.limit;
      return { limit, refused: probe !== undefined && !result.allowed };
    }
    // BOOLEAN / undeclared / no entitlement source: the free baseline, or no limit. feature_gate.04 (fixed 2026-10-20): for a
    // cost-bearing quota (onGateError 'closed') that no live entitlement declares, the answer is 0, not unlimited, so a missing or
    // renamed plan row (or a source answering garbage) no longer removes the ceiling. "No source installed" (the ungated answer,
    // allowed) and an explicit free baseline keep their meaning.
    const undeclaredClosed = !result.allowed && options.onGateError === 'closed' && options.freeBaseline === undefined;
    const limit = undeclaredClosed ? 0 : options.freeBaseline ?? Infinity;
    return { limit, refused: probe !== undefined && probe >= limit };
  } catch (error) {
    if (options.onGateError === 'open') return { limit: Infinity, refused: false };
    throw error;
  }
}

/**
 * The limit that applies to a tenant for `key`. `Infinity` = unlimited.
 * See the table above for every case; this never counts anything.
 */
export async function resolveLimit(
  tenantId: string,
  key: string,
  options: ResolveLimitOptions,
): Promise<number> {
  return (await checkLimit(tenantId, key, options)).limit;
}

/**
 * Refuse (403) when adding `adding` more would exceed the limit; otherwise
 * report the headroom. The refusal carries `{ key, limit, current, adding }` in
 * `details` so a UI can say "3 of 5 used".
 *
 * NOT atomic: it is a check, not a reservation. A caller that must be exact
 * under concurrency re-counts under its own lock (see `commerce_catalog`'s
 * `holdCatalogSlot`) and compares with the ceiling this returned.
 */
export async function assertHeadroom(
  tenantId: string,
  key: string,
  options: AssertHeadroomOptions,
): Promise<HeadroomResult> {
  const adding = options.adding ?? 1;
  const refuse = (limit: number, current: number): never => {
    throw new AppError(options.message, 403, options.errorCode ?? ErrorCode.FORBIDDEN, {
      details: { key, limit, current, adding },
    });
  };

  if (typeof options.count === 'number') {
    const current = options.count;
    // `adding` more must fit: the gate refuses at `currentCount >= ceiling`, so ask it at `current + adding - 1`.
    const { limit, refused } = await checkLimit(tenantId, key, { ...options, probeCount: current + adding - 1 });
    if (limit === Infinity) return { limit, current: null, remaining: Infinity };
    if (refused) refuse(limit, current);
    return { limit, current, remaining: Math.max(0, limit - current) };
  }

  const { limit } = await checkLimit(tenantId, key, options);
  if (limit === Infinity) return { limit, current: null, remaining: Infinity };
  const current = await options.count();
  if (current + adding > limit) refuse(limit, current);
  return { limit, current, remaining: Math.max(0, limit - current) };
}

export interface HeadroomSnapshotEntry {
  key: string;
  limit: number;
  current: number;
  remaining: number;
}

/**
 * "Usage vs plan" for several keys at once. The entitlement read is shared
 * through the gate's own per-tenant cache (one source read, many keys); each
 * entry supplies its own count. A key whose gate read fails reads as unlimited
 * under `'open'` and fails the whole snapshot under `'closed'`.
 */
export async function headroomSnapshot(
  tenantId: string,
  keys: Array<{ key: string; count: () => Promise<number> } & ResolveLimitOptions>,
): Promise<HeadroomSnapshotEntry[]> {
  return Promise.all(
    keys.map(async (k): Promise<HeadroomSnapshotEntry> => {
      const limit = await resolveLimit(tenantId, k.key, k);
      const current = await k.count();
      return { key: k.key, limit, current, remaining: limit === Infinity ? Infinity : Math.max(0, limit - current) };
    }),
  );
}
