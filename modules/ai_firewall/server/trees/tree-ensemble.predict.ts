/**
 * Prediction over a parsed `TreeEnsemble` (docs/phases/55-ai-firewall/04-tree-models.md 4.2): each library's own split rule, raw
 * scores, and the output link. Pure (FWA-8). TreeSHAP lives in tree-shap.ts and walks nodes with the same `nextNode`.
 */
import { MISSING_NAN, MISSING_ZERO, type FlatTree, type SplitRule, type TreeEnsemble } from './tree-ensemble.types';

/** `kZeroThreshold` in LightGBM's meta.h, a float literal (`1e-35f`) widened to double. */
export const LIGHTGBM_ZERO_THRESHOLD = Math.fround(1e-35);

/**
 * The child a value goes to at an internal node.
 *
 * - LightGBM (`Tree::NumericalDecision`, tree.h): NaN counts as 0 unless the node's missing type is NaN; a missing value (0 for the
 *   Zero type, NaN for the NaN type) takes the default direction; otherwise `value <= threshold` goes left, in double precision.
 * - XGBoost (`GetNextNode`, predict_fn.h): NaN takes the default child; otherwise `float32(value) < split` goes left.
 */
export function nextNode(tree: FlatTree, rule: SplitRule, node: number, value: number): number {
  if (rule === 'xgboost') {
    if (Number.isNaN(value)) return tree.defaultLeft[node] ? tree.left[node] : tree.right[node];
    return Math.fround(value) < tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  const missing = tree.missing[node];
  let v = value;
  if (Number.isNaN(v) && missing !== MISSING_NAN) v = 0;
  if (
    (missing === MISSING_ZERO && v >= -LIGHTGBM_ZERO_THRESHOLD && v <= LIGHTGBM_ZERO_THRESHOLD) ||
    (missing === MISSING_NAN && Number.isNaN(v))
  ) {
    return tree.defaultLeft[node] ? tree.left[node] : tree.right[node];
  }
  return v <= tree.threshold[node] ? tree.left[node] : tree.right[node];
}

/** The leaf node a row reaches. */
export function leafOf(tree: FlatTree, rule: SplitRule, row: ArrayLike<number>): number {
  let node = 0;
  while (!tree.isLeaf[node]) node = nextNode(tree, rule, node, row[tree.feature[node]]);
  return node;
}

/**
 * The row as the library sees it. LightGBM's dense-matrix reader keeps a value only when `|v| > kZeroThreshold` or it is NaN
 * (`c_api.cpp`), so a tiny value becomes 0. A row of the wrong width is a caller bug and throws.
 */
export function prepareRow(ensemble: TreeEnsemble, row: ArrayLike<number>): Float64Array {
  if (row.length !== ensemble.numFeatures) {
    throw new RangeError(`expected ${ensemble.numFeatures} features, got ${row.length}`);
  }
  const out = Float64Array.from(row);
  if (ensemble.splitRule === 'lightgbm') {
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      if (!Number.isNaN(v) && Math.abs(v) <= LIGHTGBM_ZERO_THRESHOLD) out[i] = 0;
    }
  }
  return out;
}

/** Raw scores (margin space), one per output. */
export function predictRaw(ensemble: TreeEnsemble, row: ArrayLike<number>): Float64Array {
  const x = prepareRow(ensemble, row);
  const raw = Float64Array.from(ensemble.baseMargin);
  const { trees, treeOutput, splitRule, float32Accumulate } = ensemble;
  for (let t = 0; t < trees.length; t++) {
    const tree = trees[t];
    const k = treeOutput[t];
    const leafValue = tree.value[leafOf(tree, splitRule, x)];
    raw[k] = float32Accumulate ? Math.fround(raw[k] + leafValue) : raw[k] + leafValue;
  }
  return raw;
}

/** The output link on raw scores: probabilities for the sigmoid and softmax links, the raw value for identity. */
export function applyLink(ensemble: TreeEnsemble, raw: Float64Array): Float64Array {
  const link = ensemble.link;
  if (link.kind === 'identity') return Float64Array.from(raw);
  if (link.kind === 'sigmoid') return raw.map((r) => 1 / (1 + Math.exp(-link.scale * r)));
  let max = -Infinity;
  for (const r of raw) if (r > max) max = r;
  const exp = raw.map((r) => Math.exp(r - max));
  let sum = 0;
  for (const e of exp) sum += e;
  return exp.map((e) => e / sum);
}

/** Raw scores and the linked output for one row. */
export function predict(ensemble: TreeEnsemble, row: ArrayLike<number>): { raw: Float64Array; output: Float64Array } {
  const raw = predictRaw(ensemble, row);
  return { raw, output: applyLink(ensemble, raw) };
}
