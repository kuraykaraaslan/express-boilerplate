/**
 * Drift and staleness (docs/phases/55-ai-firewall/04-tree-models.md 4.9): weekly population stability per feature and per model score, and
 * the model's age. Pure: histograms in, a report out.
 *
 * The bins (D55-110). Each feature's bins are cut at the model's own split thresholds for that feature (at most DRIFT_MAX_EDGES of them,
 * spread evenly over the sorted distinct thresholds), plus one bin for a missing value: drift in a range the model never splits on cannot
 * change what it says, drift across one of its splits does, and a feature going missing is drift too. A feature the model never splits on
 * has two bins (missing or not). The score has ten equal bins over [0, 1] (behaviour P(anomalous), attack the leading attack class's
 * probability). A value falls into a bin by the library's own split rule (LightGBM `value <= threshold`, XGBoost `float32(value) < split`),
 * the rule the evaluator walks the trees with.
 *
 * The reference (D55-110) is the model's first ISO week in shadow on this install with at least DRIFT_MIN_SAMPLES scorings; each later
 * complete week is compared with it. PSI = Σ (c − r) · ln(c / r) over the bins' shares, each share at least PSI_EPSILON so an empty bin
 * stays finite. Above PSI_DRIFT_BOUND (0.25, the usual "significant shift") for the score or for any feature, the model is `drifting`: the
 * gate keeps it in shadow (4.7 "drift quiet") and the alert source raises it. Too few scorings in the week compared is `insufficient`,
 * no reference yet is `no_reference`; neither is quiet.
 */
import type { TreeEnsemble } from '../trees/tree-ensemble.types';

export const DRIFT_MAX_EDGES = 9;
export const SCORE_BINS = 10;
export const DRIFT_MIN_SAMPLES = 500;
export const PSI_DRIFT_BOUND = 0.25;
export const PSI_EPSILON = 1e-4;
/** A model older than this (from its `trainedAt`) is stale: an alert, never a demotion (4.9). */
export const MODEL_MAX_AGE_DAYS = 180;

/** The cut points of every feature, in the model's feature order. */
export type FeatureEdges = number[][];

/** At most `max` edges from the sorted distinct values, evenly spread (the first and the last kept). */
export function spreadEdges(sorted: readonly number[], max: number = DRIFT_MAX_EDGES): number[] {
  if (sorted.length <= max) return [...sorted];
  const out: number[] = [];
  for (let k = 0; k < max; k += 1) {
    const v = sorted[Math.round((k * (sorted.length - 1)) / (max - 1))]!;
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

/** Each feature's bins from the thresholds the model splits it at. */
export function modelEdges(ensemble: Pick<TreeEnsemble, 'numFeatures' | 'trees'>, max: number = DRIFT_MAX_EDGES): FeatureEdges {
  const seen: Array<Set<number>> = Array.from({ length: ensemble.numFeatures }, () => new Set<number>());
  for (const tree of ensemble.trees) {
    for (let n = 0; n < tree.size; n += 1) {
      if (tree.isLeaf[n]) continue;
      const f = tree.feature[n]!;
      const t = tree.threshold[n]!;
      if (f >= 0 && f < seen.length && Number.isFinite(t)) seen[f]!.add(t);
    }
  }
  return seen.map((s) => spreadEdges([...s].sort((a, b) => a - b), max));
}

/** Bins of a feature with `edges` cut points: one per range, then the missing bin last. */
export const binCount = (edges: readonly number[]): number => edges.length + 2;

/** The bin of a value: by the library's split rule; NaN (missing) is the last bin. */
export function binOf(edges: readonly number[], value: number, rule: 'lightgbm' | 'xgboost'): number {
  if (!Number.isFinite(value)) return edges.length + 1;
  const v = rule === 'xgboost' ? Math.fround(value) : value;
  for (let i = 0; i < edges.length; i += 1) {
    if (rule === 'xgboost' ? v < edges[i]! : v <= edges[i]!) return i;
  }
  return edges.length;
}

/** The score's bin, [0, 1] in SCORE_BINS equal parts (1 is the last bin). */
export function scoreBin(probability: number): number {
  if (!Number.isFinite(probability)) return 0;
  return Math.min(SCORE_BINS - 1, Math.max(0, Math.floor(probability * SCORE_BINS)));
}

/** One week's histogram of one model: scorings, the score's bins, each feature's bins (in the model's feature order). */
export interface DriftHistogram {
  week: string;
  n: number;
  score: number[];
  features: number[][];
}

/** Population stability of two count vectors of equal length (shares floored at PSI_EPSILON). */
export function psi(reference: readonly number[], current: readonly number[]): number {
  const rt = reference.reduce((s, x) => s + x, 0);
  const ct = current.reduce((s, x) => s + x, 0);
  if (rt <= 0 || ct <= 0 || reference.length !== current.length) return Number.NaN;
  let out = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const r = Math.max(PSI_EPSILON, reference[i]! / rt);
    const c = Math.max(PSI_EPSILON, current[i]! / ct);
    out += (c - r) * Math.log(c / r);
  }
  return out;
}

export type DriftStatus = 'quiet' | 'drifting' | 'insufficient' | 'no_reference';

export interface DriftReport {
  status: DriftStatus;
  /** The reference week and the week compared (ISO weeks, `2026-W45`). */
  referenceWeek: string | null;
  week: string | null;
  scorePsi: number | null;
  /** The largest feature PSI and the features above the bound (largest first, at most 10). */
  maxFeaturePsi: number | null;
  drifting: Array<{ feature: string; psi: number }>;
  /** Days since the model was trained; `stale` when above MODEL_MAX_AGE_DAYS. */
  ageDays: number | null;
  stale: boolean;
  bound: number;
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** Days from `trainedAt` to now (null for a date that does not parse). */
export function modelAgeDays(trainedAt: string | null | undefined, nowMs: number): number | null {
  const t = trainedAt ? Date.parse(trainedAt) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** The drift of `current` against `reference` (feature names in the model's order). Pure. */
export function driftReport(
  reference: DriftHistogram | null, current: DriftHistogram | null, names: readonly string[], ageDays: number | null,
  bound: number = PSI_DRIFT_BOUND,
): DriftReport {
  const stale = ageDays !== null && ageDays > MODEL_MAX_AGE_DAYS;
  const base = { referenceWeek: reference?.week ?? null, ageDays, stale, bound };
  if (!reference) return { ...base, status: 'no_reference', week: current?.week ?? null, scorePsi: null, maxFeaturePsi: null, drifting: [] };
  if (!current || current.n < DRIFT_MIN_SAMPLES || current.week === reference.week) {
    return { ...base, status: 'insufficient', week: current?.week ?? null, scorePsi: null, maxFeaturePsi: null, drifting: [] };
  }
  const scorePsi = psi(reference.score, current.score);
  const per = names.map((feature, i) => ({ feature, psi: psi(reference.features[i] ?? [], current.features[i] ?? []) }))
    .filter((x) => Number.isFinite(x.psi));
  const maxFeaturePsi = per.reduce<number | null>((m, x) => (m === null || x.psi > m ? x.psi : m), null);
  const drifting = per.filter((x) => x.psi > bound).sort((a, b) => b.psi - a.psi).slice(0, 10).map((x) => ({ feature: x.feature, psi: round4(x.psi) }));
  const scoreDrifts = Number.isFinite(scorePsi) && scorePsi > bound;
  return {
    ...base,
    status: scoreDrifts || drifting.length > 0 ? 'drifting' : 'quiet',
    week: current.week,
    scorePsi: Number.isFinite(scorePsi) ? round4(scorePsi) : null,
    maxFeaturePsi: maxFeaturePsi === null ? null : round4(maxFeaturePsi),
    drifting,
  };
}

/** The ISO 8601 week of a time, `YYYY-Www` (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeekOf(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  const firstThursday = Date.UTC(year, 0, 4);
  const firstDay = (new Date(firstThursday).getUTCDay() + 6) % 7;
  const week1Thursday = firstThursday - firstDay * 86_400_000 + 3 * 86_400_000;
  const week = 1 + Math.round((thursday - week1Thursday) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday 00:00 UTC that starts the ISO week of a time. */
export function weekStartOf(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/** The ISO weeks from the one holding `fromMs` to the one before `nowMs`'s (the complete weeks), oldest first, at most `max`. */
export function completeWeeksSince(fromMs: number, nowMs: number, max = 12): string[] {
  const out: string[] = [];
  const last = weekStartOf(nowMs) - 7 * 86_400_000;
  for (let w = Math.max(weekStartOf(fromMs), last - (max - 1) * 7 * 86_400_000); w <= last; w += 7 * 86_400_000) out.push(isoWeekOf(w));
  return out;
}
