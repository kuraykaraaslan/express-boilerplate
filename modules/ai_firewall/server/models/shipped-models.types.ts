/**
 * The shape of a model shipped inside the module (docs/phases/55-ai-firewall/04-tree-models.md 4.5). The trained file and its
 * `<name>.meta.json` live in `modules/ai_firewall/models/`; `npm run ai-firewall:embed-models` copies them into
 * `shipped-models.generated.ts` so every bundle (the Next server, the workers) carries them as code, with no file to trace or read.
 */

/** The two cascade stages (04.8): the behaviour model is LightGBM, the attack model XGBoost. */
export type ShippedModelName = 'behaviour' | 'attack';

export type ShippedModelMeta = {
  readonly name: ShippedModelName;
  readonly library: 'lightgbm' | 'xgboost';
  /** The library version that trained it (`lightgbm==4.7.0`, `xgboost==3.4.2` in 04.1). */
  readonly libraryVersion: string;
  /** The model file next to the meta file. */
  readonly modelFile: string;
  /** sha256 of the model file's bytes, hex. */
  readonly sha256: string;
  /** The feature catalogue it reads, with its version (`behaviour.v1`, `attack.v1`). */
  readonly catalogue: string;
  /** The model's features in input order; must equal the catalogue's and the model file's own names. */
  readonly featureNames: readonly string[];
  /** Output names: one for a binary model (`anomalous`), the classes in order for a multiclass one (`benign` first is not required). */
  readonly classes: readonly string[];
  /** ISO time the training run finished. */
  readonly trainedAt: string;
  /** The catalogue's pinned content hash (CATALOGUE_HISTORY) the training rows were built with (04.1). */
  readonly catalogueHash?: string;
  /**
   * Trained on the synthetic dataset (04.1, CI and smoke runs). A synthetic model is never shipped: the embed step refuses it, the
   * loader refuses it (`synthetic`) and the promotion gate refuses it (`promotionRefusals`).
   */
  readonly synthetic?: boolean;
  /** The thresholds the trainer chose on the calibration slice of the time holdout (04.1, 4.7, 4.8), each in [0, 1]. */
  readonly thresholds?: Readonly<Record<string, number>>;
  /** Whether each threshold met its target on the calibration slice (a missed one blocks promotion). */
  readonly thresholdTargetsMet?: Readonly<Record<string, boolean>>;
  /** The independence check of the run that trained it (04.4). */
  readonly independence?: ModelIndependence;
  /** Everything else the trainer records: dataset, split and window, parameters, seeds, rounds, class weights, metrics. */
  readonly training?: Readonly<Record<string, unknown>>;
};

/**
 * 04.4: on the joint holdout, the correlation of the two models' errors. `ok` when it is at or under the bound, `flagged` above it
 * (the second model adds little), `insufficient` with too few joint rows or no variance, `not_run` when only one model was trained.
 * Only `ok` lets a model through the promotion gate.
 */
export type ModelIndependence = {
  readonly status: 'ok' | 'flagged' | 'insufficient' | 'not_run';
  readonly errorCorrelation: number | null;
  readonly bound: number;
  readonly jointRows: number;
  /**
   * The sha256 of the OTHER model of the run the correlation was measured against (D55-130): independence is a property of the pair, so
   * the gate holds a model only to the partner it was measured with. Null when only one model was trained; absent in an older meta
   * (which the gate refuses).
   */
  readonly peerSha256?: string | null;
};

export type ShippedModelSource = {
  readonly meta: ShippedModelMeta;
  /** The model file's text (LightGBM text model or XGBoost JSON). */
  readonly text: string;
};
