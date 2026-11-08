/**
 * Attribute comparison (phase 18.6, the BubbleUp idea): given the attributes of a FAILING population and a BASELINE population, which attribute
 * separates them best? Pure: two lists of attribute maps in, a ranked list of dimensions out. No I/O, no clock, no randomness.
 *
 * The measure is the Jensen-Shannon divergence (base 2, so 0 = identical and 1 = disjoint) between the failing and the baseline distribution of
 * an attribute's values, where "not present" is a value of its own (an attribute that only failing requests carry is a signal). Two things keep
 * it honest on real data:
 *  - Small samples diverge by chance. The expected divergence of two samples drawn from ONE population is about (k - 1) * (1/nF + 1/nB) / (8 ln 2)
 *    for k outcomes, so that noise floor is subtracted: a dimension scores what it shows ABOVE chance, and an attribute that only wobbles scores 0.
 *  - A near-unique attribute (a request id, a timestamp) "separates" anything. Attributes with more than `maxDistinct` distinct values are not
 *    scored at all and are listed as excluded, with the reason.
 *
 * Bounds (all in `COMPARE_LIMITS`, all enforced here): items per population, attributes per item, distinct keys, distinct values per key, values
 * reported per dimension, dimensions reported.
 */

export type AttributeBag = Record<string, string | number | boolean>;

export const COMPARE_LIMITS = {
  /** Items taken from each population (the rest are counted as skipped, never scanned). */
  maxItemsPerGroup: 2000,
  /** Attributes read from one item. */
  maxAttributesPerItem: 64,
  /** Distinct attribute keys tracked. */
  maxKeys: 200,
  /** An attribute with more distinct values than this is excluded as high-cardinality. */
  maxDistinct: 25,
  /** Dimensions in the answer. */
  maxDimensions: 10,
  /** Values reported per dimension. */
  maxValues: 5,
  /** Fewest items a population needs before anything is scored (below it the answer is "not enough data"). */
  minGroupSize: 5,
  /** A dimension scoring under this is not suggested. */
  suggestThreshold: 0.05,
} as const;

export type CompareLimits = { -readonly [K in keyof typeof COMPARE_LIMITS]: number };

export interface DimensionValue {
  value: string;
  failingCount: number;
  baselineCount: number;
  /** Share of the failing population with this value (0 to 1). */
  failingShare: number;
  baselineShare: number;
  /** failingShare / baselineShare, or `null` when the baseline never has it (infinite lift). */
  lift: number | null;
}

export interface Dimension {
  key: string;
  /** Divergence above chance, 0 to 1. The ranking key. */
  score: number;
  /** The raw divergence, before the chance floor. */
  divergence: number;
  /** How many items of each population carry the attribute at all. */
  coverage: { failing: number; baseline: number };
  distinct: number;
  values: DimensionValue[];
}

export interface ComparisonResult {
  failing: { size: number; skipped: number };
  baseline: { size: number; skipped: number };
  /** `false` when a population is too small to say anything. */
  enoughData: boolean;
  dimensions: Dimension[];
  /** The dimension to look at first, or `null` when nothing separates the populations above chance. */
  suggested: string | null;
  excluded: Array<{ key: string; reason: 'high_cardinality' | 'too_many_keys' }>;
}

const MISSING = '\u0000missing';
const LN2 = Math.log(2);

/** Jensen-Shannon divergence in bits between two count vectors over the same outcomes. */
export function jensenShannon(p: number[], q: number[]): number {
  const sp = p.reduce((a, b) => a + b, 0);
  const sq = q.reduce((a, b) => a + b, 0);
  if (sp === 0 || sq === 0) return 0;
  let js = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]! / sp;
    const b = q[i]! / sq;
    const m = (a + b) / 2;
    if (a > 0) js += 0.5 * a * Math.log(a / m);
    if (b > 0) js += 0.5 * b * Math.log(b / m);
  }
  return Math.max(0, Math.min(1, js / LN2));
}

/** The divergence two samples of sizes nF and nB over k outcomes show by chance alone. */
export function noiseFloor(k: number, nF: number, nB: number): number {
  if (k <= 1 || nF === 0 || nB === 0) return 0;
  return ((k - 1) * (1 / nF + 1 / nB)) / (8 * LN2);
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

type Counts = Map<string, { failing: number; baseline: number }>;

export function compareAttributes(failing: AttributeBag[], baseline: AttributeBag[], limits: Partial<CompareLimits> = {}): ComparisonResult {
  const L: CompareLimits = { ...COMPARE_LIMITS, ...limits };
  const f = failing.slice(0, L.maxItemsPerGroup);
  const b = baseline.slice(0, L.maxItemsPerGroup);
  const result: ComparisonResult = {
    failing: { size: f.length, skipped: failing.length - f.length }, baseline: { size: b.length, skipped: baseline.length - b.length },
    enoughData: f.length >= L.minGroupSize && b.length >= L.minGroupSize, dimensions: [], suggested: null, excluded: [],
  };
  if (!result.enoughData) return result;

  const byKey = new Map<string, Counts>();
  const present = new Map<string, { failing: number; baseline: number }>();
  const excludedKeys = new Map<string, 'high_cardinality' | 'too_many_keys'>();
  const scan = (items: AttributeBag[], side: 'failing' | 'baseline') => {
    for (const item of items) {
      let read = 0;
      for (const [key, raw] of Object.entries(item)) {
        if (read++ >= L.maxAttributesPerItem) break;
        if (excludedKeys.get(key) === 'high_cardinality') continue;
        let counts = byKey.get(key);
        if (!counts) {
          if (byKey.size >= L.maxKeys) { excludedKeys.set(key, 'too_many_keys'); continue; }
          counts = new Map();
          byKey.set(key, counts);
        }
        const value = String(raw).slice(0, 200);
        let c = counts.get(value);
        if (!c) { c = { failing: 0, baseline: 0 }; counts.set(value, c); }
        c[side] += 1;
        const p = present.get(key) ?? { failing: 0, baseline: 0 };
        p[side] += 1;
        present.set(key, p);
        // Past the bound the key is dropped at once: a near-unique attribute must not grow the table before it is judged.
        if (counts.size > L.maxDistinct) { excludedKeys.set(key, 'high_cardinality'); byKey.delete(key); present.delete(key); }
      }
    }
  };
  scan(f, 'failing');
  scan(b, 'baseline');
  result.excluded = [...excludedKeys.entries()].map(([key, reason]) => ({ key, reason })).sort((x, y) => x.key.localeCompare(y.key));

  const dims: Dimension[] = [];
  for (const [key, counts] of byKey) {
    const cover = present.get(key)!;
    const entries = [...counts.entries()];
    const missing = { failing: f.length - cover.failing, baseline: b.length - cover.baseline };
    if (missing.failing > 0 || missing.baseline > 0) entries.push([MISSING, missing]);
    if (entries.length < 2) continue; // one value everywhere separates nothing
    const divergence = jensenShannon(entries.map(([, c]) => c.failing), entries.map(([, c]) => c.baseline));
    const score = Math.max(0, divergence - noiseFloor(entries.length, f.length, b.length));
    const values: DimensionValue[] = entries
      .map(([value, c]) => {
        const failingShare = c.failing / f.length;
        const baselineShare = c.baseline / b.length;
        return { value: value === MISSING ? '(not set)' : value, failingCount: c.failing, baselineCount: c.baseline, failingShare: round(failingShare), baselineShare: round(baselineShare), lift: baselineShare > 0 ? round(failingShare / baselineShare, 2) : null, diff: failingShare - baselineShare };
      })
      .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.value.localeCompare(y.value))
      .slice(0, L.maxValues)
      .map(({ diff: _diff, ...v }) => v);
    dims.push({ key, score: round(score), divergence: round(divergence), coverage: { failing: cover.failing, baseline: cover.baseline }, distinct: counts.size, values });
  }
  result.dimensions = dims.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key)).slice(0, L.maxDimensions);
  result.suggested = result.dimensions[0] && result.dimensions[0].score >= L.suggestThreshold ? result.dimensions[0].key : null;
  return result;
}
