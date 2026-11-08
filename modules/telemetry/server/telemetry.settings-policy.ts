import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { TelemetrySettingKey } from './telemetry.setting.keys';

/**
 * The installation's tuning of the `telemetry-minute-rollup` job (2026-10-27), read from the ROOT tenant on every pass: the job runs
 * once per lane for every tenant, so these are the operator's, one value for the installation (a value in any other tenant is
 * never read). Unset (or a failed read) keeps exactly the old constants.
 *
 * - `telemetryRollupDbSharePercent`: the share of a rollup connection's time the job may use (`dbShare` of runMinuteRollups): after
 *   a catch-up step of `took` ms it rests `took * (100 / share - 1)` ms so the writers keep the rest. Was the constant 50 %
 *   (`DEFAULT_DB_SHARE`). 5..100; steady state (one closed minute per pass) is unchanged by it.
 * - `telemetryRollupMaxSteps`: steps (transactions) per tenant and retention class in one pass; the rest resumes on the next minute.
 *   Was the constant 30 (`DEFAULT_MAX_STEPS`). 1..120; the pass's 50 s budget still bounds the whole pass.
 * - `telemetryRollupFullSweepEvery`: every how many passes the job visits every tenant that ever wrote telemetry instead of only the
 *   pairs the writer touched. Was the constant 15 (`FULL_SWEEP_EVERY`). 1..60 (1 = every pass is a full sweep). A pass whose Redis
 *   cannot answer is still a full sweep.
 *
 * A value that is not a whole number in its range reads as the old constant.
 */

export const DEFAULT_ROLLUP_DB_SHARE_PERCENT = 50;
export const DEFAULT_ROLLUP_MAX_STEPS = 30;
export const DEFAULT_ROLLUP_FULL_SWEEP_EVERY = 15;

const KEYS: TelemetrySettingKey[] = ['telemetryRollupDbSharePercent', 'telemetryRollupMaxSteps', 'telemetryRollupFullSweepEvery'];

/** A whole number in [min, max]; anything else -> `fallback`. */
export function wholeInRange(raw: string | null | undefined, min: number, max: number, fallback: number): number {
  const v = (raw ?? '').trim();
  if (!/^\d{1,6}$/.test(v)) return fallback;
  const n = Number(v);
  return n >= min && n <= max ? n : fallback;
}

export interface TelemetryPolicy {
  /** 0.05..1, the `dbShare` of runMinuteRollups. */
  rollupDbShare: number;
  rollupMaxSteps: number;
  rollupFullSweepEvery: number;
}

export const DEFAULT_TELEMETRY_POLICY: TelemetryPolicy = {
  rollupDbShare: DEFAULT_ROLLUP_DB_SHARE_PERCENT / 100,
  rollupMaxSteps: DEFAULT_ROLLUP_MAX_STEPS,
  rollupFullSweepEvery: DEFAULT_ROLLUP_FULL_SWEEP_EVERY,
};

export async function getTelemetryPolicy(tenantId: string = ROOT_TENANT_ID): Promise<TelemetryPolicy> {
  let s: Record<string, string | null> = {};
  try {
    // Loaded on use, so the writer's and the job's import graph stays as it was; any failure keeps the old constants.
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    s = (await SettingService.getByKeys(tenantId, KEYS)) ?? {};
  } catch { /* defaults */ }
  return {
    rollupDbShare: wholeInRange(s.telemetryRollupDbSharePercent, 5, 100, DEFAULT_ROLLUP_DB_SHARE_PERCENT) / 100,
    rollupMaxSteps: wholeInRange(s.telemetryRollupMaxSteps, 1, 120, DEFAULT_ROLLUP_MAX_STEPS),
    rollupFullSweepEvery: wholeInRange(s.telemetryRollupFullSweepEvery, 1, 60, DEFAULT_ROLLUP_FULL_SWEEP_EVERY),
  };
}
