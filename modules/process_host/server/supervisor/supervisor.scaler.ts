import type { PublishedSignal, ScaleReason, ScalingPolicy } from './supervisor.types';

/**
 * The scaling decision (07 "When to scale"), pure: every input, the clock included, is passed in, so it is tested with
 * a fake clock and no process.
 *
 *  - the signal is sampled every 5 s and smoothed over the last 30 s (moving average);
 *  - up: smoothed ≥ `upAt` continuously for `upForMs`, then `upCooldownMs` before the next up;
 *  - down: smoothed < `downAt` continuously for `downForMs`, and `downCooldownMs` since the last change of either kind;
 *    with a `downCpuBelow` policy the group's smoothed CPU must also be below it for that whole time (no CPU reading = no down);
 *  - one step at a time: no decision while a child is starting; while one drains no further down, and an up only when
 *    the draining children still fit under the cap (a ws child may drain for 10 min, a telephony child for a whole call:
 *    a load spike meanwhile must still grow the group, without oversubscribing the budget);
 *  - never below `min` (restored at once), never above the effective max or the budget allocation (shed one at a time);
 *  - frozen (crash loop): no signal-driven up;
 *  - with `upStallSteps`: after that many signal-driven ups in a row that did not lower the smoothed signal below its value at
 *    the previous up, no further signal-driven up until it falls (or drops under `upAt`, or the group scales down), or for at
 *    most `UP_STALL_HOLD_MS` after the last up: a brake, not a stop, so a load that keeps growing still grows the group, slowly.
 */

export const SAMPLE_MS = 5_000;
export const WINDOW_MS = 30_000;
/** How long the `upStallSteps` brake holds the next up after the last one (then one more step is taken and the brake re-arms). */
export const UP_STALL_HOLD_MS = 10 * 60_000;

export type ScalerPolicy = Pick<ScalingPolicy, 'min' | 'upAt' | 'downAt' | 'upForMs' | 'downForMs' | 'upCooldownMs' | 'downCooldownMs'> & { downCpuBelow?: number; upStallSteps?: number };

export interface ScalerState {
  samples: Array<{ t: number; v: number }>;
  /** The group's CPU samples (percent of one core), same window. */
  cpu: Array<{ t: number; v: number }>;
  /** Since when the smoothed signal has been ≥ upAt (null when it is not). */
  aboveSince: number | null;
  /** Since when the smoothed signal has been < downAt. */
  belowSince: number | null;
  lastUpAt: number | null;
  /** Last change of either direction. */
  lastChangeAt: number | null;
  /** The smoothed signal when the last signal-driven up was taken (null: none since the signal was last under `upAt`). */
  lastUpValue?: number | null;
  /** Signal-driven ups in a row taken while the signal had not fallen below `lastUpValue`. */
  stalledUps?: number;
}

export const newScalerState = (): ScalerState => ({ samples: [], cpu: [], aboveSince: null, belowSince: null, lastUpAt: null, lastChangeAt: null, lastUpValue: null, stalledUps: 0 });

/** Whether the last signal-driven up did not lower the smoothed signal (it is still at or above its value then). */
const upDidNotHelp = (state: ScalerState): boolean => {
  const avg = smoothed(state);
  return state.lastUpValue != null && avg !== null && avg >= state.lastUpValue;
};

/** True when `upStallSteps` holds further signal-driven ups back (see the module comment). */
export function upStalled(state: ScalerState, policy: ScalerPolicy, now: number): boolean {
  return policy.upStallSteps !== undefined && upDidNotHelp(state) && (state.stalledUps ?? 0) >= policy.upStallSteps
    && state.lastUpAt !== null && now - state.lastUpAt < UP_STALL_HOLD_MS;
}

/**
 * Adds a raw sample (NaN is skipped) and the group's CPU at that moment (NaN = no reading), and drops the ones outside the
 * window. Returns the smoothed value or null.
 */
export function addSample(state: ScalerState, policy: ScalerPolicy, now: number, value: number, cpu = NaN): number | null {
  if (Number.isFinite(value)) state.samples.push({ t: now, v: value });
  if (Number.isFinite(cpu)) state.cpu.push({ t: now, v: cpu });
  state.samples = state.samples.filter((s) => now - s.t < WINDOW_MS);
  state.cpu = state.cpu.filter((s) => now - s.t < WINDOW_MS);
  const avg = smoothed(state);
  if (avg === null) {
    state.aboveSince = null;
    state.belowSince = null;
    return null;
  }
  if (avg >= policy.upAt) state.aboveSince ??= now;
  else {
    state.aboveSince = null;
    // the signal is back under the threshold: the ups that came before it did their job, the brake starts over
    state.lastUpValue = null;
    state.stalledUps = 0;
  }
  if (avg < policy.downAt && cpuAllowsDown(state, policy)) state.belowSince ??= now; else state.belowSince = null;
  return avg;
}

/** True when the policy has no CPU condition, or the smoothed group CPU is below it. */
export function cpuAllowsDown(state: ScalerState, policy: ScalerPolicy): boolean {
  if (policy.downCpuBelow === undefined) return true;
  const cpu = smoothedCpu(state);
  return cpu !== null && cpu < policy.downCpuBelow;
}

const mean = (xs: ReadonlyArray<{ v: number }>): number | null => (xs.length === 0 ? null : xs.reduce((a, s) => a + s.v, 0) / xs.length);

export function smoothed(state: ScalerState): number | null {
  return mean(state.samples);
}

/** The group's CPU (percent of one core) over the window; null without a reading. */
export function smoothedCpu(state: ScalerState): number | null {
  return mean(state.cpu);
}

export interface ScalerInput {
  now: number;
  /** Children that count (starting, running, or waiting for a restart; draining ones do not). */
  count: number;
  /** Effective max (`kindMax`). */
  max: number;
  /** This kind's share of the machine budget. */
  allocation: number;
  frozen: boolean;
  /** A child is starting. */
  busy: boolean;
  /** Children draining right now (they still hold their share of the machine until they exit). Default 0. */
  draining?: number;
}

export type Decision =
  | { action: 'none'; reason?: undefined }
  | { action: 'up' | 'down'; reason: ScaleReason };

export function decide(state: ScalerState, policy: ScalerPolicy, input: ScalerInput): Decision {
  const { now, count, frozen, busy } = input;
  const draining = input.draining ?? 0;
  const cap = Math.max(policy.min, Math.min(input.max, input.allocation));
  if (count < policy.min) return { action: 'up', reason: 'min' };
  if (busy) return { action: 'none' };
  if (draining === 0 && count > policy.min && count > input.max) return { action: 'down', reason: 'max' };
  if (draining === 0 && count > policy.min && count > cap) return { action: 'down', reason: 'budget' };

  if (
    !frozen && count + draining < cap && state.aboveSince !== null && now - state.aboveSince >= policy.upForMs
    && (state.lastUpAt === null || now - state.lastUpAt >= policy.upCooldownMs) && !upStalled(state, policy, now)
  ) return { action: 'up', reason: 'signal' };

  if (
    draining === 0 && count > policy.min && state.belowSince !== null && now - state.belowSince >= policy.downForMs
    && (state.lastChangeAt === null || now - state.lastChangeAt >= policy.downCooldownMs)
  ) return { action: 'down', reason: 'signal' };

  return { action: 'none' };
}

/**
 * Records a step that was taken: the cooldowns start. The edge clocks are kept: a signal still past its threshold
 * when the cooldown ends takes the next step at once (07: "start one child, then a 60 s cooldown"; "drain one …,
 * then a 5 min cooldown").
 */
export function applied(state: ScalerState, action: 'up' | 'down', now: number, reason?: ScaleReason): void {
  state.lastChangeAt = now;
  if (action === 'up') state.lastUpAt = now;
  if (action === 'up' && reason === 'signal') {
    // the `upStallSteps` brake: an up taken while the previous one did not lower the signal counts as one more in a row
    state.stalledUps = upDidNotHelp(state) ? (state.stalledUps ?? 0) + 1 : 0;
    state.lastUpValue = smoothed(state);
  }
  if (action === 'down') {
    state.lastUpValue = null;
    state.stalledUps = 0;
  }
}

/** True while the up condition (signal held above for upFor) is met, regardless of cooldowns and caps: the "wants one more" claim. */
export function wantsMore(state: ScalerState, policy: ScalerPolicy, now: number): boolean {
  return state.aboveSince !== null && now - state.aboveSince >= policy.upForMs && !upStalled(state, policy, now);
}

export function publishedSignal(state: ScalerState, policy: ScalerPolicy): PublishedSignal {
  const value = smoothed(state);
  let edge: PublishedSignal['edge'] = null;
  let since: number | null = null;
  if (value !== null) {
    if (state.aboveSince !== null) { edge = 'above'; since = state.aboveSince; }
    else if (state.belowSince !== null) { edge = 'below'; since = state.belowSince; }
    else edge = 'between';
  }
  return {
    value, upAt: policy.upAt, downAt: policy.downAt, edge, since, cpu: smoothedCpu(state),
    ...(policy.downCpuBelow !== undefined && { downCpuBelow: policy.downCpuBelow }),
  };
}

/** `cooling` when a cooldown would block the next step in the direction the signal points. */
export function cooling(state: ScalerState, policy: ScalerPolicy, now: number): boolean {
  if (state.aboveSince !== null && state.lastUpAt !== null && now - state.lastUpAt < policy.upCooldownMs) return true;
  if (state.belowSince !== null && state.lastChangeAt !== null && now - state.lastChangeAt < policy.downCooldownMs) return true;
  return false;
}
