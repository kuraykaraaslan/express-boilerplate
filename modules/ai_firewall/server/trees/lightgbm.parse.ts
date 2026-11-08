/**
 * LightGBM text model (`Booster.save_model`, format `version=v4`) → `TreeEnsemble` (docs/phases/55-ai-firewall/04-tree-models.md 4.2).
 *
 * Read against LightGBM 4.7.0's writer (`src/boosting/gbdt_model_text.cpp`, `Tree::ToString` in `src/io/tree.cpp`): a header of
 * `key=value` lines, then one `Tree=<i>` block per tree, then `end of trees`. In a tree block internal nodes are `0..num_leaves-2`
 * and a negative child `c` is leaf `~c`; leaf values already include the learning rate and the start score (LightGBM folds
 * `boost_from_average` into the first trees), so the raw score is the plain sum of the trees of an output.
 *
 * Refused (4.1): categorical splits (`num_cat > 0` or the categorical bit of `decision_type`), linear trees (`is_linear=1`),
 * `average_output` (random forest mode) and objectives other than `binary`, `multiclass` and `regression`.
 */
import { MISSING_NAN, MISSING_NONE, MISSING_ZERO, ModelRefusedError, type FlatTree, type OutputLink, type TreeEnsemble } from './tree-ensemble.types';

/** `kCategoricalMask` / `kDefaultLeftMask` in LightGBM's tree.h. */
const CATEGORICAL_MASK = 1;
const DEFAULT_LEFT_MASK = 2;

/** A refused model must never cost unbounded work; real firewall models are far below these. */
export const LIGHTGBM_LIMITS = { maxTrees: 20_000, maxLeaves: 1 << 16, maxFeatures: 4096, maxDepth: 64 } as const;

const refuse = (reason: string): never => {
  throw new ModelRefusedError('lightgbm', reason);
};

/**
 * One number as LightGBM's `AtofPrecise` reads it (common.h): a decimal, or through the `strtod` fallback `inf` / `infinity` / `nan`
 * in any case with a sign. The writer prints an infinite threshold as `inf` (a NaN-type split that sends every number left).
 */
export function parseLightGbmNumber(token: string): number {
  const special = /^([+-]?)(inf|infinity|nan)$/i.exec(token);
  if (special) {
    if (special[2].toLowerCase() === 'nan') return Number.NaN;
    return special[1] === '-' ? -Infinity : Infinity;
  }
  return token === '' ? Number.NaN : Number(token);
}

function numbers(raw: string | undefined, expected: number, field: string): number[] {
  if (expected === 0) return [];
  if (raw === undefined) refuse(`tree field ${field} is missing`);
  const parts = raw!.trim() === '' ? [] : raw!.trim().split(/\s+/);
  if (parts.length !== expected) refuse(`tree field ${field} has ${parts.length} values, expected ${expected}`);
  return parts.map((p) => {
    const n = parseLightGbmNumber(p);
    if (Number.isNaN(n) && !/^[+-]?nan$/i.test(p)) refuse(`tree field ${field} has a non-number "${p.slice(0, 20)}"`);
    return n;
  });
}

function parseObjective(raw: string | undefined, numTreePerIteration: number, numClass: number): OutputLink {
  if (!raw) refuse('the model has no objective');
  const [name, ...params] = raw!.trim().split(/\s+/);
  const param = (key: string) => params.find((p) => p.startsWith(`${key}:`))?.slice(key.length + 1);
  switch (name) {
    case 'binary': {
      if (numTreePerIteration !== 1) refuse('binary objective with more than one tree per iteration');
      const scale = Number(param('sigmoid') ?? '1');
      if (!Number.isFinite(scale) || scale <= 0) refuse('binary objective with an invalid sigmoid');
      return { kind: 'sigmoid', scale };
    }
    case 'multiclass':
      if (numClass < 2 || numTreePerIteration !== numClass) refuse('multiclass objective with an inconsistent class count');
      return { kind: 'softmax' };
    case 'regression':
      if (numTreePerIteration !== 1) refuse('regression objective with more than one tree per iteration');
      // `regression sqrt` squares the output in ConvertOutput (regression_objective.hpp); anything after the name is refused.
      if (params.length > 0) refuse(`regression objective with "${params.join(' ')}" is not supported`);
      return { kind: 'identity' };
    default:
      return refuse(`objective "${name}" is not evaluated by the firewall (binary, multiclass and regression are)`);
  }
}

function buildTree(fields: Map<string, string>, numFeatures: number, index: number): FlatTree {
  const numLeaves = Number(fields.get('num_leaves'));
  if (!Number.isInteger(numLeaves) || numLeaves < 1 || numLeaves > LIGHTGBM_LIMITS.maxLeaves) refuse(`tree ${index} has an invalid num_leaves`);
  if (Number(fields.get('num_cat') ?? '0') !== 0) refuse(`tree ${index} has categorical splits`);
  if (Number(fields.get('is_linear') ?? '0') !== 0) refuse(`tree ${index} is a linear tree`);

  const internal = numLeaves - 1;
  const size = internal + numLeaves;
  const leafValue = numbers(fields.get('leaf_value'), numLeaves, 'leaf_value');
  const leafCount = numbers(fields.get('leaf_count'), numLeaves, 'leaf_count');
  const splitFeature = numbers(fields.get('split_feature'), internal, 'split_feature');
  const threshold = numbers(fields.get('threshold'), internal, 'threshold');
  const decisionType = numbers(fields.get('decision_type'), internal, 'decision_type');
  const leftChild = numbers(fields.get('left_child'), internal, 'left_child');
  const rightChild = numbers(fields.get('right_child'), internal, 'right_child');
  const internalCount = numbers(fields.get('internal_count'), internal, 'internal_count');

  const tree = {
    size,
    isLeaf: new Uint8Array(size),
    feature: new Int32Array(size).fill(-1),
    threshold: new Float64Array(size),
    left: new Int32Array(size).fill(-1),
    right: new Int32Array(size).fill(-1),
    defaultLeft: new Uint8Array(size),
    missing: new Uint8Array(size),
    value: new Float64Array(size),
    cover: new Float64Array(size),
  };
  const nodeOf = (child: number): number => {
    if (!Number.isInteger(child)) refuse(`tree ${index} has a non-integer child`);
    const node = child >= 0 ? child : internal + ~child;
    if (child >= 0 ? child >= internal : ~child >= numLeaves) refuse(`tree ${index} has a child out of range`);
    return node;
  };
  for (let i = 0; i < internal; i++) {
    const dt = decisionType[i];
    if (!Number.isInteger(dt) || dt < 0 || dt > 127) refuse(`tree ${index} has an invalid decision_type`);
    if (dt & CATEGORICAL_MASK) refuse(`tree ${index} has a categorical split`);
    const missing = (dt >> 2) & 3;
    if (missing !== MISSING_NONE && missing !== MISSING_ZERO && missing !== MISSING_NAN) refuse(`tree ${index} has an unknown missing type`);
    const f = splitFeature[i];
    if (!Number.isInteger(f) || f < 0 || f >= numFeatures) refuse(`tree ${index} splits on a feature out of range`);
    if (Number.isNaN(threshold[i])) refuse(`tree ${index} has a NaN threshold`);
    tree.feature[i] = f;
    tree.threshold[i] = threshold[i];
    tree.defaultLeft[i] = dt & DEFAULT_LEFT_MASK ? 1 : 0;
    tree.missing[i] = missing;
    tree.left[i] = nodeOf(leftChild[i]);
    tree.right[i] = nodeOf(rightChild[i]);
    tree.cover[i] = internalCount[i];
    if (!(internalCount[i] > 0)) refuse(`tree ${index} has an internal count that is not positive`);
  }
  for (let j = 0; j < numLeaves; j++) {
    const node = internal + j;
    if (!Number.isFinite(leafValue[j])) refuse(`tree ${index} has a non-finite leaf value`);
    tree.isLeaf[node] = 1;
    tree.value[node] = leafValue[j];
    tree.cover[node] = leafCount[j];
    if (numLeaves > 1 && !(leafCount[j] > 0)) refuse(`tree ${index} has a leaf count that is not positive`);
  }
  // TreeSHAP allocates (depth + 1)(depth + 2) / 2 path entries and recurses per level: a deep tree is refused at load, not at the
  // first explanation in the request path.
  const maxDepth = checkShape(tree, `tree ${index}`, refuse);
  if (maxDepth > LIGHTGBM_LIMITS.maxDepth) refuse(`tree ${index} is deeper than ${LIGHTGBM_LIMITS.maxDepth}`);
  return { ...tree, maxDepth };
}

/**
 * Walks the tree once from the root: every node reached exactly once (a tree, not a graph with cycles or shared children), and
 * returns the depth. Shared with the XGBoost parser.
 */
export function checkShape(
  tree: { size: number; isLeaf: Uint8Array; left: Int32Array; right: Int32Array },
  label: string,
  fail: (reason: string) => never,
): number {
  const seen = new Uint8Array(tree.size);
  const stack: Array<[number, number]> = [[0, 0]];
  let reached = 0;
  let maxDepth = 0;
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (node < 0 || node >= tree.size || seen[node]) fail(`${label} is not a tree`);
    seen[node] = 1;
    reached++;
    if (depth > maxDepth) maxDepth = depth;
    if (!tree.isLeaf[node]) {
      stack.push([tree.left[node], depth + 1], [tree.right[node], depth + 1]);
    }
  }
  if (reached !== tree.size) fail(`${label} has unreachable nodes`);
  return maxDepth;
}

/** A tree block's `key=value` lines (the `Tree=<i>` line first), as LightGBM's `Tree(const char*)` constructor reads them. */
function fieldsOf(block: string[], index: number): Map<string, string> {
  const head = block[0]?.trim() ?? '';
  if (!head.startsWith('Tree=')) refuse(`tree ${index} does not start with a Tree= line`);
  if (Number(head.slice(5)) !== index) refuse('trees are not numbered in order');
  const fields = new Map<string, string>();
  for (const raw of block.slice(1)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (eq > 0) fields.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return fields;
}

/**
 * The tree blocks, located the way LightGBM's loader locates them (`GBDT::LoadModelFromString`, gbdt_model_text.cpp): with a
 * `tree_sizes` header, tree `k` is the byte range `[Σ sizes[<k], Σ sizes[≤k])` from the first `Tree=` line, so a file whose sizes
 * disagree with its blocks is refused here as it is there; without one, the blocks are read in order up to `end of trees`.
 */
function readTreeBlocks(text: string, lines: string[], firstTreeLine: number, treeSizes: string | undefined): string[][] {
  const tail = lines.slice(firstTreeLine);
  const end = tail.findIndex((l) => l.trim() === 'end of trees');
  if (end < 0) refuse('the model has no "end of trees" line (truncated?)');

  if (treeSizes === undefined) {
    const blocks: string[][] = [];
    for (const line of tail.slice(0, end)) {
      if (line.trim().startsWith('Tree=')) {
        if (blocks.length >= LIGHTGBM_LIMITS.maxTrees) refuse('too many trees');
        blocks.push([line]);
      } else if (blocks.length > 0) {
        blocks[blocks.length - 1].push(line);
      }
    }
    return blocks;
  }

  const sizes = treeSizes.trim().split(/\s+/).filter(Boolean).map(Number);
  if (sizes.length > LIGHTGBM_LIMITS.maxTrees) refuse('too many trees');
  if (sizes.some((s) => !Number.isInteger(s) || s <= 0)) refuse('tree_sizes has a value that is not a positive integer');
  // Byte offsets equal string offsets only for ASCII; a trained model with numeric features and ASCII names is ASCII.
  if (/[^\x00-\x7f]/.test(text)) refuse('the model text is not ASCII');
  const start = text.search(/^Tree=/m);
  if (start < 0) refuse('the model has no Tree= line');
  const blocks: string[][] = [];
  let offset = start;
  for (const size of sizes) {
    if (offset + size > text.length) refuse('tree_sizes runs past the end of the model');
    blocks.push(text.slice(offset, offset + size).split(/\r?\n/));
    offset += size;
  }
  return blocks;
}

/** Parses a LightGBM text model. Throws `ModelRefusedError` for anything 4.1 does not allow or anything malformed. */
export function parseLightGbmModel(text: string): TreeEnsemble {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== 'tree') refuse('not a LightGBM text model (first line is not "tree")');

  const header = new Map<string, string>();
  let averageOutput = false;
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('Tree=') || line === 'end of trees') break;
    if (line === '') continue;
    if (line === 'average_output') averageOutput = true;
    const eq = line.indexOf('=');
    if (eq > 0) header.set(line.slice(0, eq), line.slice(eq + 1));
  }
  const version = header.get('version');
  if (version !== 'v4' && version !== 'v3') refuse(`model version "${version ?? ''}" is not supported`);
  if (averageOutput) refuse('average_output (random forest) models are not supported');

  const numClass = Number(header.get('num_class') ?? '1');
  const numTreePerIteration = Number(header.get('num_tree_per_iteration') ?? '1');
  const numFeatures = Number(header.get('max_feature_idx')) + 1;
  if (!Number.isInteger(numClass) || numClass < 1) refuse('invalid num_class');
  if (!Number.isInteger(numTreePerIteration) || numTreePerIteration < 1) refuse('invalid num_tree_per_iteration');
  if (!Number.isInteger(numFeatures) || numFeatures < 1 || numFeatures > LIGHTGBM_LIMITS.maxFeatures) refuse('invalid max_feature_idx');
  const link = parseObjective(header.get('objective'), numTreePerIteration, numClass);
  const featureNames = (header.get('feature_names') ?? '').trim().split(/\s+/).filter(Boolean);
  if (featureNames.length !== numFeatures) refuse(`feature_names lists ${featureNames.length} names for ${numFeatures} features`);

  const trees = readTreeBlocks(text, lines, i, header.get('tree_sizes')).map((block, t) => buildTree(fieldsOf(block, t), numFeatures, t));
  if (trees.length === 0) refuse('the model has no trees');
  if (trees.length % numTreePerIteration !== 0) refuse('the tree count is not a multiple of num_tree_per_iteration');

  const treeOutput = new Int32Array(trees.length);
  for (let t = 0; t < trees.length; t++) treeOutput[t] = t % numTreePerIteration;
  return {
    library: 'lightgbm',
    splitRule: 'lightgbm',
    objective: (header.get('objective') ?? '').trim().split(/\s+/)[0],
    numFeatures,
    featureNames,
    numOutputs: numTreePerIteration,
    trees,
    treeOutput,
    baseMargin: new Float64Array(numTreePerIteration),
    link,
    float32Accumulate: false,
  };
}
