/**
 * One tree shape for both tree libraries the firewall ships models of (docs/phases/55-ai-firewall/04-tree-models.md 4.2).
 *
 * The LightGBM text model and the XGBoost JSON model are parsed into this shape; prediction and TreeSHAP read only this shape and
 * the ensemble's `splitRule`, which carries the one place the two libraries differ in how a value walks a node. Pure data: no NB
 * imports, no I/O (FWA-8), so the library can move into `insight`'s methods library when that exists.
 */

/** How a value chooses a child. Each library's own rule, copied from its source (see `nextNode` in tree-ensemble.predict.ts). */
export type SplitRule = 'lightgbm' | 'xgboost';

/** LightGBM's per-node missing type (`(decision_type >> 2) & 3` in its tree.h). XGBoost nodes are always `MISSING_NAN`. */
export const MISSING_NONE = 0;
export const MISSING_ZERO = 1;
export const MISSING_NAN = 2;

/** One tree in flat arrays; node 0 is the root. Leaves have `feature = -1`, `left = right = -1`. */
export type FlatTree = {
  readonly size: number;
  readonly isLeaf: Uint8Array;
  readonly feature: Int32Array;
  /** The split value. XGBoost values are float32 (stored widened to double, exactly). */
  readonly threshold: Float64Array;
  readonly left: Int32Array;
  readonly right: Int32Array;
  /** 1 when a missing value goes to the left child. */
  readonly defaultLeft: Uint8Array;
  /** `MISSING_NONE` | `MISSING_ZERO` | `MISSING_NAN` per node. */
  readonly missing: Uint8Array;
  /** The leaf output; 0 on internal nodes. */
  readonly value: Float64Array;
  /** What TreeSHAP weighs a branch by: LightGBM's data count, XGBoost's hessian sum. */
  readonly cover: Float64Array;
  /** Edges on the longest root-to-leaf path (0 for a single leaf). */
  readonly maxDepth: number;
};

export type OutputLink =
  | { readonly kind: 'identity' }
  | { readonly kind: 'sigmoid'; readonly scale: number }
  | { readonly kind: 'softmax' };

export type TreeEnsemble = {
  readonly library: 'lightgbm' | 'xgboost';
  readonly splitRule: SplitRule;
  /** The library's objective name as written in the model (`binary`, `multi:softprob`, …). */
  readonly objective: string;
  readonly numFeatures: number;
  readonly featureNames: readonly string[];
  /** 1 for a binary or regression model, the class count for a multiclass one. */
  readonly numOutputs: number;
  readonly trees: readonly FlatTree[];
  /** The output (class) each tree adds to. */
  readonly treeOutput: Int32Array;
  /** Added to each output's raw score. LightGBM folds its start score into the first trees, so its margin is 0. */
  readonly baseMargin: Float64Array;
  readonly link: OutputLink;
  /** XGBoost sums leaf values in float32; mirroring that keeps parity with its predictions to the last bit. */
  readonly float32Accumulate: boolean;
};

/** A model that this evaluator does not evaluate exactly is refused, never approximated (04.2: fail closed, the rule scorer carries on). */
export class ModelRefusedError extends Error {
  constructor(
    readonly library: 'lightgbm' | 'xgboost',
    readonly reason: string,
  ) {
    super(`${library} model refused: ${reason}`);
    this.name = 'ModelRefusedError';
  }
}
