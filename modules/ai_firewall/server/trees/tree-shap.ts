/**
 * Path-dependent TreeSHAP (Lundberg et al.) over a `TreeEnsemble` (docs/phases/55-ai-firewall/04-tree-models.md 4.2): the per-feature
 * contributions LightGBM returns for `pred_contrib` and XGBoost for `pred_contribs`. Pure (FWA-8).
 *
 * A line-by-line port of LightGBM 4.7.0's `Tree::TreeSHAP`, `ExtendPath`, `UnwindPath` and `UnwoundPathSum` (src/io/tree.cpp), with
 * the hot child chosen by the ensemble's own split rule (`nextNode`) and branches weighed by the tree's cover (LightGBM data counts,
 * XGBoost hessian sums). XGBoost 3.4's CPU `pred_contribs` is an 8-point Gauss-Legendre quadrature of the same Shapley integral,
 * exact when a path has at most 8 distinct features and every cover is positive; the XGBoost parser refuses trees deeper than 8 and
 * non-positive covers, so within what loads the two agree to float32 rounding. The bias column is the expected value:
 * LightGBM's `Tree::ExpectedValue` (leaf counts over the root count) and XGBoost's root mean value (children weighed by hessian sums,
 * `FillNodeMeanValues` in shap.cc) plus its base margin.
 *
 * The values satisfy local accuracy: for each output, the contributions plus the bias equal the raw score.
 */
import { nextNode, prepareRow } from './tree-ensemble.predict';
import type { FlatTree, TreeEnsemble } from './tree-ensemble.types';

/** The unique path of one recursion, as structure-of-arrays slices of a shared buffer (`PathElement` in LightGBM's tree.h). */
type PathBuffer = {
  feature: Int32Array;
  zero: Float64Array;
  one: Float64Array;
  pweight: Float64Array;
};

function newBuffer(maxDepth: number): PathBuffer {
  const maxPathLen = maxDepth + 1;
  const size = (maxPathLen * (maxPathLen + 1)) / 2;
  return { feature: new Int32Array(size), zero: new Float64Array(size), one: new Float64Array(size), pweight: new Float64Array(size) };
}

function extendPath(p: PathBuffer, base: number, uniqueDepth: number, zeroFraction: number, oneFraction: number, featureIndex: number): void {
  p.feature[base + uniqueDepth] = featureIndex;
  p.zero[base + uniqueDepth] = zeroFraction;
  p.one[base + uniqueDepth] = oneFraction;
  p.pweight[base + uniqueDepth] = uniqueDepth === 0 ? 1 : 0;
  for (let i = uniqueDepth - 1; i >= 0; i--) {
    p.pweight[base + i + 1] += (oneFraction * p.pweight[base + i] * (i + 1)) / (uniqueDepth + 1);
    p.pweight[base + i] = (zeroFraction * p.pweight[base + i] * (uniqueDepth - i)) / (uniqueDepth + 1);
  }
}

function unwindPath(p: PathBuffer, base: number, uniqueDepth: number, pathIndex: number): void {
  const oneFraction = p.one[base + pathIndex];
  const zeroFraction = p.zero[base + pathIndex];
  let nextOnePortion = p.pweight[base + uniqueDepth];
  for (let i = uniqueDepth - 1; i >= 0; --i) {
    if (oneFraction !== 0) {
      const tmp = p.pweight[base + i];
      p.pweight[base + i] = (nextOnePortion * (uniqueDepth + 1)) / ((i + 1) * oneFraction);
      nextOnePortion = tmp - (p.pweight[base + i] * zeroFraction * (uniqueDepth - i)) / (uniqueDepth + 1);
    } else {
      p.pweight[base + i] = (p.pweight[base + i] * (uniqueDepth + 1)) / (zeroFraction * (uniqueDepth - i));
    }
  }
  for (let i = pathIndex; i < uniqueDepth; ++i) {
    p.feature[base + i] = p.feature[base + i + 1];
    p.zero[base + i] = p.zero[base + i + 1];
    p.one[base + i] = p.one[base + i + 1];
  }
}

function unwoundPathSum(p: PathBuffer, base: number, uniqueDepth: number, pathIndex: number): number {
  const oneFraction = p.one[base + pathIndex];
  const zeroFraction = p.zero[base + pathIndex];
  let nextOnePortion = p.pweight[base + uniqueDepth];
  let total = 0;
  for (let i = uniqueDepth - 1; i >= 0; --i) {
    if (oneFraction !== 0) {
      const tmp = (nextOnePortion * (uniqueDepth + 1)) / ((i + 1) * oneFraction);
      total += tmp;
      nextOnePortion = p.pweight[base + i] - tmp * zeroFraction * ((uniqueDepth - i) / (uniqueDepth + 1));
    } else {
      total += p.pweight[base + i] / zeroFraction / ((uniqueDepth - i) / (uniqueDepth + 1));
    }
  }
  return total;
}

function treeShap(
  tree: FlatTree,
  ensemble: TreeEnsemble,
  x: Float64Array,
  phi: Float64Array,
  p: PathBuffer,
  node: number,
  uniqueDepth: number,
  parentBase: number,
  parentZeroFraction: number,
  parentOneFraction: number,
  parentFeatureIndex: number,
): void {
  // Extend the unique path: this recursion's slice starts right after the parent's, holding a copy of the parent's elements.
  const base = parentBase + uniqueDepth;
  if (uniqueDepth > 0) {
    p.feature.copyWithin(base, parentBase, parentBase + uniqueDepth);
    p.zero.copyWithin(base, parentBase, parentBase + uniqueDepth);
    p.one.copyWithin(base, parentBase, parentBase + uniqueDepth);
    p.pweight.copyWithin(base, parentBase, parentBase + uniqueDepth);
  }
  extendPath(p, base, uniqueDepth, parentZeroFraction, parentOneFraction, parentFeatureIndex);

  if (tree.isLeaf[node]) {
    for (let i = 1; i <= uniqueDepth; ++i) {
      const w = unwoundPathSum(p, base, uniqueDepth, i);
      phi[p.feature[base + i]] += w * (p.one[base + i] - p.zero[base + i]) * tree.value[node];
    }
    return;
  }

  const split = tree.feature[node];
  const hot = nextNode(tree, ensemble.splitRule, node, x[split]);
  const cold = hot === tree.left[node] ? tree.right[node] : tree.left[node];
  const w = tree.cover[node];
  const hotZeroFraction = tree.cover[hot] / w;
  const coldZeroFraction = tree.cover[cold] / w;
  let incomingZeroFraction = 1;
  let incomingOneFraction = 1;

  // If this feature was split on above, undo that split so it is redone here.
  let pathIndex = 0;
  for (; pathIndex <= uniqueDepth; ++pathIndex) {
    if (p.feature[base + pathIndex] === split) break;
  }
  let depth = uniqueDepth;
  if (pathIndex !== uniqueDepth + 1) {
    incomingZeroFraction = p.zero[base + pathIndex];
    incomingOneFraction = p.one[base + pathIndex];
    unwindPath(p, base, depth, pathIndex);
    depth -= 1;
  }

  treeShap(tree, ensemble, x, phi, p, hot, depth + 1, base, hotZeroFraction * incomingZeroFraction, incomingOneFraction, split);
  treeShap(tree, ensemble, x, phi, p, cold, depth + 1, base, coldZeroFraction * incomingZeroFraction, 0, split);
}

/** The tree's expected output under its training distribution, as each library computes it for the bias column. */
export function expectedValue(tree: FlatTree, library: TreeEnsemble['library']): number {
  if (tree.isLeaf[0]) return tree.value[0];
  if (library === 'lightgbm') {
    // Tree::ExpectedValue: leaf counts over the root's count.
    const total = tree.cover[0];
    let sum = 0;
    for (let n = 0; n < tree.size; n++) if (tree.isLeaf[n]) sum += (tree.cover[n] / total) * tree.value[n];
    return sum;
  }
  // FillNodeMeanValues: each node's mean is its children's means weighed by their hessian sums.
  const mean = (n: number): number =>
    tree.isLeaf[n] ? tree.value[n] : (mean(tree.left[n]) * tree.cover[tree.left[n]] + mean(tree.right[n]) * tree.cover[tree.right[n]]) / tree.cover[n];
  return mean(0);
}

/**
 * Contributions for one row: one array per output, `numFeatures + 1` long, the last entry the bias (expected value in margin space).
 * Throws `RangeError` for a row of the wrong width (like `predictRaw`).
 */
export function contributions(ensemble: TreeEnsemble, row: ArrayLike<number>): Float64Array[] {
  const x = prepareRow(ensemble, row);
  const nf = ensemble.numFeatures;
  const out = Array.from({ length: ensemble.numOutputs }, (_, k) => {
    const phi = new Float64Array(nf + 1);
    phi[nf] = ensemble.baseMargin[k];
    return phi;
  });
  let buffer: PathBuffer | null = null;
  for (let t = 0; t < ensemble.trees.length; t++) {
    const tree = ensemble.trees[t];
    const phi = out[ensemble.treeOutput[t]];
    phi[nf] += expectedValue(tree, ensemble.library);
    if (tree.isLeaf[0]) continue;
    const needed = ((tree.maxDepth + 1) * (tree.maxDepth + 2)) / 2;
    if (!buffer || buffer.feature.length < needed) buffer = newBuffer(tree.maxDepth);
    // The root's call: a dummy element (feature -1) at depth 0, exactly as LightGBM's PredictContrib starts it.
    treeShap(tree, ensemble, x, phi, buffer, 0, 0, 0, 1, 1, -1);
  }
  return out;
}
