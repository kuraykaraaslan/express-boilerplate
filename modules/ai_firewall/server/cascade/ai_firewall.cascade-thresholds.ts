/**
 * The request cascade's thresholds (docs/phases/55-ai-firewall/04-tree-models.md 4.8, FWA-9). Pure.
 *
 * The platform's four come from the shipped models' metas, chosen by the trainer on the calibration slice (D55-105): stage 1's
 * `suspicion` from the behaviour model (tuned for recall), stage 2's `challenge`, `block` and `terminate` from the attack model (`block`
 * tuned for precision). A model without them, or thresholds out of order, give no thresholds and the cascade allows (FWA-7).
 *
 * Per tenant only TWO of them move (D55-119): stage 1's `suspicion` and stage 2's `block`, by one shift computed from the tenant's own
 * verdicts on its incidents (`detectorVerdictCounts`, 03 §3.2), never by training on the tenant's data:
 *
 *   fewer than CALIBRATION_MIN_VERDICTS true and false positives  -> no shift (a small tenant keeps the platform's thresholds)
 *   false-positive share above FP_SHARE_HIGH                       -> raised, linearly up to RAISE_MAX at a share of 1
 *   false-positive share below FP_SHARE_LOW, with CALIBRATION_MIN_VERDICTS true positives -> lowered, linearly up to LOWER_MAX at 0
 *   otherwise                                                      -> no shift
 *
 * The bounds are the platform's: `suspicion` stays within [platform − LOWER_MAX, platform + RAISE_MAX] and inside (0, 1); `block` within
 * the same band and never below `challenge` nor above `terminate` (so a moved `block` never reorders the scale, and `challenge` and
 * `terminate` never move).
 */
import type { DetectorVerdictCounts } from '../labels/ai_firewall.label-model';
import type { ShippedModelMeta } from '../models/shipped-models.types';
import { validateThresholds, type CascadeThresholds } from './cascade';

export const CALIBRATION_MIN_VERDICTS = 20;
export const FP_SHARE_HIGH = 0.5;
export const FP_SHARE_LOW = 0.1;
/** The most a tenant's feedback raises `suspicion` and `block` (fewer requests reach stage 2, fewer are blocked). */
export const RAISE_MAX = 0.15;
/** The most it lowers them (a tenant whose flags were all real gets a slightly keener cascade). */
export const LOWER_MAX = 0.05;
/** `suspicion` never leaves this range, whatever the platform's and the shift. */
export const SUSPICION_RANGE = { min: 0.01, max: 0.99 } as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The platform's thresholds from the two metas, or null when either model lacks them or they do not validate. */
export function platformThresholds(
  behaviour: Pick<ShippedModelMeta, 'thresholds'> | null | undefined, attack: Pick<ShippedModelMeta, 'thresholds'> | null | undefined,
): CascadeThresholds | null {
  const suspicion = num(behaviour?.thresholds?.suspicion);
  const challenge = num(attack?.thresholds?.challenge);
  const block = num(attack?.thresholds?.block);
  const terminate = num(attack?.thresholds?.terminate);
  if (suspicion === null || challenge === null || block === null || terminate === null) return null;
  const t: CascadeThresholds = { suspicion, challenge, block, terminate };
  try {
    validateThresholds(t);
    return t;
  } catch {
    return null;
  }
}

export type CalibrationReason = 'too_few' | 'raised' | 'lowered' | 'unchanged';

export interface TenantCalibration {
  /** The shift added to `suspicion` and to `block` (before the bounds), in probability. */
  shift: number;
  reason: CalibrationReason;
  truePositive: number;
  falsePositive: number;
}

export const NO_CALIBRATION: TenantCalibration = Object.freeze({ shift: 0, reason: 'too_few', truePositive: 0, falsePositive: 0 });

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/**
 * The tenant's shift from its people's verdicts (summed over the detectors each verdict is counted under; `unsure` is no verdict here).
 * Pure.
 */
export function calibrationOf(counts: DetectorVerdictCounts | null | undefined): TenantCalibration {
  let tp = 0;
  let fp = 0;
  for (const c of Object.values(counts ?? {})) {
    tp += Math.max(0, Number(c?.truePositive) || 0);
    fp += Math.max(0, Number(c?.falsePositive) || 0);
  }
  const n = tp + fp;
  if (n < CALIBRATION_MIN_VERDICTS) return { shift: 0, reason: 'too_few', truePositive: tp, falsePositive: fp };
  const share = fp / n;
  if (share > FP_SHARE_HIGH) {
    return { shift: round4(RAISE_MAX * Math.min(1, (share - FP_SHARE_HIGH) / (1 - FP_SHARE_HIGH))), reason: 'raised', truePositive: tp, falsePositive: fp };
  }
  if (share < FP_SHARE_LOW && tp >= CALIBRATION_MIN_VERDICTS) {
    return { shift: -round4(LOWER_MAX * Math.min(1, (FP_SHARE_LOW - share) / FP_SHARE_LOW)), reason: 'lowered', truePositive: tp, falsePositive: fp };
  }
  return { shift: 0, reason: 'unchanged', truePositive: tp, falsePositive: fp };
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** The tenant's thresholds: the platform's with `suspicion` and `block` moved by the shift, inside the platform's bounds. Pure. */
export function tenantThresholds(platform: CascadeThresholds, calibration: Pick<TenantCalibration, 'shift'>): CascadeThresholds {
  const shift = clamp(Number.isFinite(calibration.shift) ? calibration.shift : 0, -LOWER_MAX, RAISE_MAX);
  if (shift === 0) return platform;
  const suspicion = clamp(
    platform.suspicion + shift,
    Math.max(SUSPICION_RANGE.min, platform.suspicion - LOWER_MAX),
    Math.min(SUSPICION_RANGE.max, platform.suspicion + RAISE_MAX),
  );
  const block = clamp(
    platform.block + shift,
    Math.max(platform.challenge, platform.block - LOWER_MAX),
    Math.min(platform.terminate, platform.block + RAISE_MAX),
  );
  return { suspicion, challenge: platform.challenge, block, terminate: platform.terminate };
}
