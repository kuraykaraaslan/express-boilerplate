/**
 * The trainer's arithmetic (docs/phases/55-ai-firewall/04-tree-models.md 4.1, 4.4, 4.7): losses, early stopping, ROC AUC, the threshold
 * choices for the 4.7 targets, confusion counts, the actor-day false-positive rate, and the independence report's correlation, false-
 * positive overlap and ablation. Pure, no I/O; `training.metrics.test.ts` checks each on hand-made vectors.
 */

/** Probabilities are clipped into [EPS, 1 - EPS] before a log (a loss of a certain mistake stays finite). */
const EPS = 1e-15;
const clip = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

/** Weighted mean binary log loss; `w` defaults to 1 per row. NaN for no rows. */
export function binaryLogLoss(p: ArrayLike<number>, y: ArrayLike<number>, w?: ArrayLike<number>): number {
  let sum = 0;
  let total = 0;
  for (let i = 0; i < p.length; i++) {
    const wi = w ? w[i] : 1;
    sum += -wi * (y[i] ? Math.log(clip(p[i])) : Math.log(clip(1 - p[i])));
    total += wi;
  }
  return total > 0 ? sum / total : Number.NaN;
}

/** Weighted mean multiclass log loss over rows of class probabilities; `y` the class index. NaN for no rows. */
export function multiLogLoss(probs: ReadonlyArray<ArrayLike<number>>, y: ArrayLike<number>, w?: ArrayLike<number>): number {
  let sum = 0;
  let total = 0;
  for (let i = 0; i < probs.length; i++) {
    const wi = w ? w[i] : 1;
    sum += -wi * Math.log(clip(probs[i][y[i]]));
    total += wi;
  }
  return total > 0 ? sum / total : Number.NaN;
}

/**
 * Early stopping over a validation loss per iteration (index 0 = after the first iteration): the iteration with the lowest loss, where
 * the search stops once `patience` iterations in a row brought no improvement (as the libraries' own early stopping does). Returns the
 * 0-based best iteration; the model keeps iterations 0..best (`bst[:best + 1]`).
 */
export function earlyStoppingIteration(losses: readonly number[], patience: number): number {
  if (losses.length === 0) throw new RangeError('no iterations to choose from');
  if (!(Number.isInteger(patience) && patience >= 1)) throw new RangeError('patience must be a whole number >= 1');
  let best = 0;
  for (let i = 1; i < losses.length; i++) {
    if (losses[i] < losses[best] - 1e-12) best = i;
    else if (i - best >= patience) break;
  }
  return best;
}

/** ROC AUC (the Mann-Whitney statistic, ties count half). null without both a positive and a negative. */
export function rocAuc(scores: ArrayLike<number>, y: ArrayLike<number>): number | null {
  const idx = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let pos = 0;
  let neg = 0;
  let rankSumPos = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      if (y[idx[k]]) { pos++; rankSumPos += avgRank; } else neg++;
    }
    i = j + 1;
  }
  if (pos === 0 || neg === 0) return null;
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** null when nothing was flagged. */
  precision: number | null;
  /** null without positives. */
  recall: number | null;
  /** null without negatives. */
  fpr: number | null;
}

/** Counts of flags against the truth (1 = attack / anomalous). */
export function confusion(flags: ArrayLike<boolean | number>, y: ArrayLike<number>): Confusion {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < y.length; i++) {
    const f = !!flags[i];
    if (y[i]) { if (f) tp++; else fn++; } else if (f) fp++; else tn++;
  }
  return {
    tp, fp, fn, tn,
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
    fpr: fp + tn > 0 ? fp / (fp + tn) : null,
  };
}

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);
const ONE_ULP = BigInt(1);

/** The next double above a finite `v` (a threshold that excludes `v` itself under `score >= t`). */
export function justAbove(v: number): number {
  if (!Number.isFinite(v)) throw new RangeError('justAbove needs a finite number');
  if (v === 0) return Number.MIN_VALUE;
  f64[0] = v;
  u64[0] = v > 0 ? u64[0] + ONE_ULP : u64[0] - ONE_ULP;
  return f64[0];
}

/** The next double below a finite `v`. */
export function justBelow(v: number): number {
  return -justAbove(-v);
}

export type ThresholdChoice = {
  /** The threshold (a flag is `score >= value`). */
  value: number;
  /** The target it was chosen for. */
  target: number;
  /** Whether the calibration rows reached the target at `value`. */
  met: boolean;
};

/**
 * The highest threshold whose recall on these rows is at least `target` (stage 1 of the cascade is tuned for recall, 04.8): the
 * ceil(target × positives)-th highest positive score. Unmet (and `fallback`) without positives.
 */
export function recallThreshold(scores: ArrayLike<number>, y: ArrayLike<number>, target: number, fallback = 0.5): ThresholdChoice {
  const pos: number[] = [];
  for (let i = 0; i < y.length; i++) if (y[i]) pos.push(scores[i]);
  if (pos.length === 0) return { value: fallback, target, met: false };
  pos.sort((a, b) => b - a);
  const need = Math.max(1, Math.ceil(target * pos.length - 1e-9));
  return { value: pos[Math.min(pos.length, need) - 1], target, met: true };
}

/**
 * The lowest threshold whose precision on these rows is at least `target` (stage 2 is tuned for precision, 04.8), i.e. the most recall
 * at that precision. Only rows with a score above 0 can be flagged. Unmet (value 1) when no threshold reaches it.
 */
export function precisionThreshold(scores: ArrayLike<number>, y: ArrayLike<number>, target: number): ThresholdChoice {
  const idx = Array.from({ length: scores.length }, (_, i) => i).filter((i) => scores[i] > 0).sort((a, b) => scores[b] - scores[a]);
  let tp = 0;
  let fp = 0;
  let best: number | null = null;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
    for (let k = i; k <= j; k++) { if (y[idx[k]]) tp++; else fp++; }
    if (tp > 0 && tp / (tp + fp) >= target) best = scores[idx[i]];
    i = j + 1;
  }
  return best === null ? { value: 1, target, met: false } : { value: best, target, met: true };
}

/** Benign actor-days (04.7: "of active actors per day"): an actor's rows of one UTC day, none of them an attack. */
export type ActorDayRow = { actor: string; day: string; y: number };

function benignActorDays(rows: readonly ActorDayRow[], scores: ArrayLike<number>): number[] {
  const max = new Map<string, number>();
  const attacked = new Set<string>();
  rows.forEach((r, i) => {
    const key = `${r.actor}\u0000${r.day}`;
    if (r.y) attacked.add(key);
    max.set(key, Math.max(max.get(key) ?? Number.NEGATIVE_INFINITY, scores[i]));
  });
  return [...max.entries()].filter(([k]) => !attacked.has(k)).map(([, m]) => m);
}

/** The share of benign actor-days with any row flagged at `threshold`; null without benign actor-days. */
export function actorDayFpr(rows: readonly ActorDayRow[], scores: ArrayLike<number>, threshold: number): { fpr: number | null; actorDays: number } {
  const days = benignActorDays(rows, scores);
  if (days.length === 0) return { fpr: null, actorDays: 0 };
  return { fpr: days.filter((m) => m >= threshold).length / days.length, actorDays: days.length };
}

/**
 * The lowest threshold at which at most `target` of the benign actor-days have a row flagged (04.7, behaviour: a false-positive rate
 * of at most 0.1 % of active actors per day). Just above the (k + 1)-th highest actor-day maximum, k = floor(target × days). Unmet
 * without benign actor-days, or when the threshold would have to exceed 1.
 */
export function fprThreshold(rows: readonly ActorDayRow[], scores: ArrayLike<number>, target: number): ThresholdChoice {
  const days = benignActorDays(rows, scores).sort((a, b) => b - a);
  if (days.length === 0) return { value: 1, target, met: false };
  const k = Math.floor(target * days.length + 1e-9);
  if (k >= days.length) return { value: Number.MIN_VALUE, target, met: true };
  const value = justAbove(days[k]);
  return value > 1 ? { value: 1, target, met: false } : { value, target, met: true };
}

/** Pearson correlation; null with fewer than 2 rows or a constant vector. */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  const n = a.length;
  if (n !== b.length) throw new RangeError('pearson needs vectors of the same length');
  if (n < 2) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  if (saa <= 1e-24 || sbb <= 1e-24) return null;
  return Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb)));
}

/**
 * The pooled within-class correlation of two vectors: each vector centred on its mean within each class of `y`, then Pearson. Two
 * models' residuals (truth − score) share their sign through the truth alone (both under-score attacks, both over-score nothing), which
 * inflates a plain correlation however different their mistakes are; centring within the class leaves only whether they are wrong about
 * the SAME rows (04.4, D55-103). null when undefined.
 */
export function withinClassCorrelation(a: ArrayLike<number>, b: ArrayLike<number>, y: ArrayLike<number>): number | null {
  const n = a.length;
  if (n !== b.length || n !== y.length) throw new RangeError('withinClassCorrelation needs vectors of the same length');
  const sums = new Map<number, { a: number; b: number; n: number }>();
  for (let i = 0; i < n; i++) {
    const k = y[i] ? 1 : 0;
    const s = sums.get(k) ?? { a: 0, b: 0, n: 0 };
    s.a += a[i]; s.b += b[i]; s.n += 1;
    sums.set(k, s);
  }
  const ca = new Float64Array(n);
  const cb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = sums.get(y[i] ? 1 : 0)!;
    ca[i] = a[i] - s.a / s.n;
    cb[i] = b[i] - s.b / s.n;
  }
  return pearson(ca, cb);
}

export interface FalsePositiveOverlap {
  /** Benign rows each model flags, and both. */
  first: number;
  second: number;
  both: number;
  /** |both| / |either|; null when neither flags a benign row. */
  jaccard: number | null;
  /** Of the second model's false positives, the share the first also makes; null when the second makes none. */
  secondAlsoFirst: number | null;
}

/** The overlap of two models' false positives on the same rows (04.4). */
export function falsePositiveOverlap(first: ArrayLike<boolean>, second: ArrayLike<boolean>, y: ArrayLike<number>): FalsePositiveOverlap {
  let a = 0, b = 0, both = 0, either = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i]) continue;
    if (first[i]) a++;
    if (second[i]) b++;
    if (first[i] && second[i]) both++;
    if (first[i] || second[i]) either++;
  }
  return { first: a, second: b, both, jaccard: either > 0 ? both / either : null, secondAlsoFirst: b > 0 ? both / b : null };
}

export interface Ablation {
  /** The behaviour model alone (stage 1 suspicious). */
  behaviour: Confusion;
  /** The attack model alone (an attack class above the challenge threshold). */
  attack: Confusion;
  /** Both keys (the cascade's block rule, FWA-13). */
  both: Confusion;
  /** Either model (what one key alone would flag). */
  either: Confusion;
}

/** Each model alone and combined, on the same rows (04.4 ablation). */
export function ablation(behaviour: ArrayLike<boolean>, attack: ArrayLike<boolean>, y: ArrayLike<number>): Ablation {
  const n = y.length;
  const both = Array.from({ length: n }, (_, i) => behaviour[i] && attack[i]);
  const either = Array.from({ length: n }, (_, i) => behaviour[i] || attack[i]);
  return { behaviour: confusion(behaviour, y), attack: confusion(attack, y), both: confusion(both, y), either: confusion(either, y) };
}

/** A number rounded for a report (6 decimals, never -0, which JSON cannot carry); null and non-finite are null. */
export function round6(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}
