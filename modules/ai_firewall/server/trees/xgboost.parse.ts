/**
 * XGBoost JSON model (`Booster.save_model('…json')`, XGBoost 3.x) → `TreeEnsemble` (docs/phases/55-ai-firewall/04-tree-models.md 4.2).
 *
 * Read against XGBoost 3.4.2's sources: a node is a leaf when `left_children[n] == -1`, and a leaf's output is stored in
 * `split_conditions[n]`; a numeric split sends `float32(value) < split_condition` left and a missing value (NaN) to the default child
 * (`src/predictor/predict_fn.h`). `learner_model_param.base_score` is written in probability space (a scalar `5E-1` or, from 3.x, a
 * vector `[5E-1]`) and turned into the margin by the objective's `ProbToMargin` when the model is loaded (`src/learner.cc`): the logit,
 * clamped to [1e-6, 1 - 1e-6], for the logistic objectives (`src/objective/regression_loss.h`), the value itself otherwise.
 *
 * Refused (4.1): boosters other than `gbtree` (`dart`, `gblinear`), `num_parallel_tree` > 1 (random forest mode), multi-output
 * trees (`size_leaf_vector` > 1), categorical splits (`split_type` 1), deleted nodes, a right child that is not `left + 1` (XGBoost's
 * scalar predictor goes to `LeftChild + 1` and never reads `right_children`, predict_fn.h), trees deeper than 8 (XGBoost's CPU
 * `pred_contribs` is an 8-point quadrature, exact only up to 8 distinct features on a path, shap.cc / quadrature.h), a cover that is
 * not positive (the quadrature's zero-cover fallbacks), a `best_iteration` short of the last tree (early stopping: the trainer saves
 * `bst[:best_iteration + 1]`), and objectives other than `binary:logistic`, `reg:logistic`, `multi:softprob`, `multi:softmax` and
 * `reg:squarederror`.
 */
import { MISSING_NAN, ModelRefusedError, type FlatTree, type OutputLink, type TreeEnsemble } from './tree-ensemble.types';
import { checkShape } from './lightgbm.parse';

/** `kRtEps` in XGBoost's base.h: the logistic intercept is clamped to [kRtEps, 1 - kRtEps] before the logit. */
const RT_EPS = Math.fround(1e-6);

export const XGBOOST_LIMITS = { maxTrees: 20_000, maxNodes: 1 << 17, maxFeatures: 4096, maxClasses: 64, maxDepth: 8 } as const;

const refuse = (reason: string): never => {
  throw new ModelRefusedError('xgboost', reason);
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function objectAt(parent: Json, key: string, label: string): Json {
  const v = parent[key];
  if (!isObject(v)) refuse(`${label} is missing`);
  return v as Json;
}

function intParam(parent: Json, key: string, label: string): number {
  const raw = parent[key];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n)) refuse(`${label} is not an integer`);
  return n;
}

function numberArray(tree: Json, key: string, size: number, label: string): number[] {
  const v = tree[key];
  if (!Array.isArray(v) || v.length !== size) refuse(`${label}.${key} must hold ${size} values`);
  return (v as unknown[]).map((x) => {
    const n = typeof x === 'boolean' ? (x ? 1 : 0) : x;
    if (typeof n !== 'number' || Number.isNaN(n)) refuse(`${label}.${key} has a non-number`);
    return n as number;
  });
}

/** `"5E-1"`, `"[5E-1]"` or `"[1E-1,2E-1,3E-1]"` → numbers. An empty list is refused, as XGBoost's loader refuses it. */
export function parseBaseScore(raw: unknown): number[] {
  if (typeof raw !== 'string' && typeof raw !== 'number') refuse('learner_model_param.base_score is missing');
  const text = String(raw).trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (text === '') refuse('learner_model_param.base_score is empty');
  const values = text.split(',').map((s) => (s.trim() === '' ? Number.NaN : Number(s.trim())));
  if (values.some((v) => !Number.isFinite(v))) refuse('learner_model_param.base_score is not a number list');
  return values;
}

/**
 * XGBoost's logistic `ProbToMargin` in float32: clamp to [kRtEps, 1 - kRtEps], then `common::Logit(x) = -logf(1.0f / x - 1.0f)`
 * (math.h). The intercept must be a probability (`CheckIntercept`, regression_loss.h).
 */
export function logisticMargin(baseScore: number): number {
  if (!(baseScore >= 0 && baseScore <= 1)) refuse('a logistic base_score must be in [0, 1]');
  const p = Math.fround(Math.min(Math.max(Math.fround(baseScore), RT_EPS), Math.fround(1 - RT_EPS)));
  const margin = Math.fround(-Math.fround(Math.log(Math.fround(Math.fround(1 / p) - 1))));
  return margin === 0 ? 0 : margin;
}

function linkOf(objective: string): { link: OutputLink; logisticIntercept: boolean; multiclass: boolean } {
  switch (objective) {
    case 'binary:logistic':
    case 'reg:logistic':
      return { link: { kind: 'sigmoid', scale: 1 }, logisticIntercept: true, multiclass: false };
    case 'multi:softprob':
    case 'multi:softmax':
      return { link: { kind: 'softmax' }, logisticIntercept: false, multiclass: true };
    case 'reg:squarederror':
      return { link: { kind: 'identity' }, logisticIntercept: false, multiclass: false };
    default:
      return refuse(`objective "${objective}" is not evaluated by the firewall`);
  }
}

function buildTree(raw: unknown, numFeatures: number, index: number): FlatTree {
  const label = `trees[${index}]`;
  if (!isObject(raw)) refuse(`${label} is not an object`);
  const t = raw as Json;
  const param = objectAt(t, 'tree_param', `${label}.tree_param`);
  const size = intParam(param, 'num_nodes', `${label}.tree_param.num_nodes`);
  if (size < 1 || size > XGBOOST_LIMITS.maxNodes) refuse(`${label} has an invalid node count`);
  if (intParam(param, 'num_deleted', `${label}.tree_param.num_deleted`) !== 0) refuse(`${label} has deleted nodes`);
  const leafVector = param.size_leaf_vector === undefined ? 1 : intParam(param, 'size_leaf_vector', `${label}.size_leaf_vector`);
  if (leafVector > 1) refuse(`${label} is a multi-output tree`);

  const left = numberArray(t, 'left_children', size, label);
  const right = numberArray(t, 'right_children', size, label);
  const splitIndex = numberArray(t, 'split_indices', size, label);
  const splitCond = numberArray(t, 'split_conditions', size, label);
  const defaultLeft = numberArray(t, 'default_left', size, label);
  const hess = numberArray(t, 'sum_hessian', size, label);
  const splitType = t.split_type === undefined ? new Array<number>(size).fill(0) : numberArray(t, 'split_type', size, label);
  const categoriesNodes = t.categories_nodes;
  if (Array.isArray(categoriesNodes) && categoriesNodes.length > 0) refuse(`${label} has categorical splits`);

  const tree = {
    size,
    isLeaf: new Uint8Array(size),
    feature: new Int32Array(size).fill(-1),
    threshold: new Float64Array(size),
    left: new Int32Array(size).fill(-1),
    right: new Int32Array(size).fill(-1),
    defaultLeft: new Uint8Array(size),
    missing: new Uint8Array(size).fill(MISSING_NAN),
    value: new Float64Array(size),
    cover: new Float64Array(size),
  };
  for (let n = 0; n < size; n++) {
    tree.cover[n] = Math.fround(hess[n]);
    if (!(tree.cover[n] > 0) || !Number.isFinite(tree.cover[n])) refuse(`${label} node ${n} has a cover that is not positive`);
    if (left[n] === -1) {
      if (right[n] !== -1) refuse(`${label} node ${n} has one child`);
      tree.isLeaf[n] = 1;
      tree.value[n] = Math.fround(splitCond[n]);
      continue;
    }
    if (splitType[n] !== 0) refuse(`${label} has a categorical split`);
    const f = splitIndex[n];
    if (!Number.isInteger(f) || f < 0 || f >= numFeatures) refuse(`${label} splits on a feature out of range`);
    if (!Number.isInteger(left[n]) || !Number.isInteger(right[n]) || left[n] <= 0 || right[n] <= 0 || left[n] >= size || right[n] >= size) {
      refuse(`${label} node ${n} has a child out of range`);
    }
    if (right[n] !== left[n] + 1) refuse(`${label} node ${n}: the right child is not left + 1`);
    tree.feature[n] = f;
    tree.threshold[n] = Math.fround(splitCond[n]);
    tree.left[n] = left[n];
    tree.right[n] = right[n];
    tree.defaultLeft[n] = defaultLeft[n] ? 1 : 0;
  }
  const maxDepth = checkShape(tree, label, refuse);
  if (maxDepth > XGBOOST_LIMITS.maxDepth) refuse(`${label} is deeper than ${XGBOOST_LIMITS.maxDepth}`);
  return { ...tree, maxDepth };
}

/** Parses an XGBoost JSON model (the parsed object or its text). Throws `ModelRefusedError` for anything 4.1 does not allow. */
export function parseXgBoostModel(input: string | unknown): TreeEnsemble {
  let root: unknown = input;
  if (typeof input === 'string') {
    try {
      root = JSON.parse(input);
    } catch {
      refuse('not JSON');
    }
  }
  if (!isObject(root)) refuse('not an XGBoost JSON model');
  const learner = objectAt(root as Json, 'learner', 'learner');
  const booster = objectAt(learner, 'gradient_booster', 'learner.gradient_booster');
  if (booster.name !== 'gbtree') refuse(`booster "${String(booster.name)}" is not supported (gbtree is)`);
  const model = objectAt(booster, 'model', 'gradient_booster.model');
  const gbParam = objectAt(model, 'gbtree_model_param', 'gbtree_model_param');
  if (intParam(gbParam, 'num_parallel_tree', 'num_parallel_tree') !== 1) refuse('num_parallel_tree > 1 (random forest) is not supported');

  const mparam = objectAt(learner, 'learner_model_param', 'learner_model_param');
  const numFeatures = intParam(mparam, 'num_feature', 'num_feature');
  if (numFeatures < 1 || numFeatures > XGBOOST_LIMITS.maxFeatures) refuse('invalid num_feature');
  if (mparam.num_target !== undefined && intParam(mparam, 'num_target', 'num_target') !== 1) refuse('multi-target models are not supported');
  const numClass = intParam(mparam, 'num_class', 'num_class');

  const objective = String(objectAt(learner, 'objective', 'learner.objective').name ?? '');
  const { link, logisticIntercept, multiclass } = linkOf(objective);
  if (multiclass && (numClass < 2 || numClass > XGBOOST_LIMITS.maxClasses)) refuse('multiclass objective with an invalid num_class');
  if (!multiclass && numClass > 1) refuse('num_class > 1 with a single-output objective');
  const numOutputs = multiclass ? numClass : 1;

  const featureNames = learner.feature_names;
  if (!Array.isArray(featureNames) || featureNames.length !== numFeatures || featureNames.some((n) => typeof n !== 'string' || n === '')) {
    refuse('learner.feature_names must name every feature');
  }

  const base = parseBaseScore(mparam.base_score);
  if (base.length !== 1 && base.length !== numOutputs) refuse('base_score has the wrong length');
  const baseMargin = new Float64Array(numOutputs);
  for (let k = 0; k < numOutputs; k++) {
    const b = base.length === 1 ? base[0] : base[k];
    baseMargin[k] = logisticIntercept ? logisticMargin(b) : Math.fround(b);
  }

  const rawTrees = model.trees;
  const treeInfo = model.tree_info;
  if (!Array.isArray(rawTrees) || rawTrees.length === 0) refuse('the model has no trees');
  if ((rawTrees as unknown[]).length > XGBOOST_LIMITS.maxTrees) refuse('too many trees');
  if (!Array.isArray(treeInfo) || treeInfo.length !== (rawTrees as unknown[]).length) refuse('tree_info does not match the trees');
  const trees = (rawTrees as unknown[]).map((t, i) => buildTree(t, numFeatures, i));
  const attributes = isObject(learner.attributes) ? learner.attributes : {};
  if (attributes.best_iteration !== undefined) {
    const best = Number(attributes.best_iteration);
    const lastIteration = trees.length / numOutputs - 1;
    if (!Number.isInteger(best) || best < lastIteration) refuse('best_iteration is short of the last tree (save bst[:best_iteration + 1])');
  }
  const treeOutput = new Int32Array(trees.length);
  for (let i = 0; i < trees.length; i++) {
    const g = (treeInfo as unknown[])[i];
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 0 || g >= numOutputs) refuse(`tree_info[${i}] is out of range`);
    treeOutput[i] = g as number;
  }

  return {
    library: 'xgboost',
    splitRule: 'xgboost',
    objective,
    numFeatures,
    featureNames: featureNames as string[],
    numOutputs,
    trees,
    treeOutput,
    baseMargin,
    link,
    float32Accumulate: true,
  };
}
