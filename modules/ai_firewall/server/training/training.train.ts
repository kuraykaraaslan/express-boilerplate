import { createHash } from 'node:crypto';
import type { LightGbm } from '../engines/lightgbm.wasm';
import type { XgBoost } from '../engines/xgboost.wasm';
import { benignScore, topAttack, validateThresholds, BENIGN_CLASS, type AttackScore } from '../cascade/cascade';
import { featureNames } from '../features/ai_firewall.feature-catalogue';
import type { ModelIndependence, ShippedModelMeta, ShippedModelName } from '../models/shipped-models.types';
import { INDEPENDENCE_BOUND_MAX } from '../models/shipped-models.meta';
import { parseLightGbmModel } from '../trees/lightgbm.parse';
import { parseXgBoostModel } from '../trees/xgboost.parse';
import { applyLink, leafOf, predict, prepareRow } from '../trees/tree-ensemble.predict';
import type { TreeEnsemble } from '../trees/tree-ensemble.types';
import { ATTACK_CLASS_OF_LABEL, ATTACK_MODEL_CLASSES, BEHAVIOUR_OUTPUT, type AttackModelClass } from './training.classes';
import {
  LIBRARY_VERSIONS, TrainingRefusedError, assertParams, checkTrainedModel, type Params,
} from './training.constraints';
import {
  DatasetRefusedError, datasetIsSynthetic, prepareRows, readDataset, readManifest, type DatasetHeader, type LoadedDataset, type ModelName,
  type PreparedRow, type PrepareSkip,
} from './training.dataset';
import {
  actorDayFpr, binaryLogLoss, confusion, earlyStoppingIteration, fprThreshold, justBelow, multiLogLoss, precisionThreshold,
  recallThreshold, rocAuc, round6, type Confusion, type ThresholdChoice,
} from './training.metrics';
import { independenceOf, type IndependenceReport, type JointInput } from './training.independence';
import { lightGbmParity, parityRows, xgBoostParity, PARITY_TOLERANCE } from './training.parity';
import { DEFAULT_SPLIT, SplitRefusedError, timeSplit, type SplitFractions, type TimeSplit } from './training.split';
import { evasionRecord, featureWeights, lightGbmFeatureContri } from './training.evasion';

/**
 * Offline training of the two cascade models (docs/phases/55-ai-firewall/04-tree-models.md 4.1, 4.4; D55-99 to D55-105). Reads the
 * 03.5 export (one dataset per model), trains with the vendored libraries (server/engines/*.wasm.ts) with fixed seeds, class weights
 * for the imbalance and early stopping on a time holdout, refuses to write a model the evaluator would refuse, checks the evaluator
 * against the library on the trained model, chooses the thresholds for the 4.7 targets on the holdout's calibration slice, reports the
 * metrics on its test slice and the two models' independence on their joint test rows. Returns the files to write; the CLI
 * (`scripts/train-models.mts`) writes them into a folder of its own, never into models/ (shipping stays the embed step, 4.5).
 */

export type TrainTargets = {
  /** Stage 1 is tuned for recall (04.8): the suspicion threshold lets through at most 1 - this of the anomalous rows. */
  readonly behaviourRecall: number;
  /** 4.7: the behaviour model's false-positive rate, per benign actor-day. */
  readonly behaviourActorDayFpr: number;
  /** Stage 2 is tuned for precision (04.8): challenge, block and terminate. */
  readonly attackChallengePrecision: number;
  readonly attackBlockPrecision: number;
  readonly attackTerminatePrecision: number;
};

export const DEFAULT_TARGETS: TrainTargets = {
  behaviourRecall: 0.95,
  behaviourActorDayFpr: 0.001,
  attackChallengePrecision: 0.9,
  attackBlockPrecision: 0.99,
  attackTerminatePrecision: 0.999,
};

export type TrainOptions = {
  readonly seed: number;
  readonly maxRounds: number;
  readonly patience: number;
  readonly split: SplitFractions;
  readonly targets: TrainTargets;
  /** 04.4: a joint-holdout error correlation above this flags the run (D55-103); at most INDEPENDENCE_BOUND_MAX for the gate (D55-131). */
  readonly maxErrorCorrelation: number;
  /** Fewer usable rows than this and the model is not trained. */
  readonly minRows: number;
  readonly now: Date;
};

export const DEFAULT_TRAIN_OPTIONS: Omit<TrainOptions, 'now'> = {
  seed: 1,
  maxRounds: 500,
  patience: 30,
  split: DEFAULT_SPLIT,
  targets: DEFAULT_TARGETS,
  maxErrorCorrelation: INDEPENDENCE_BOUND_MAX,
  minRows: 50,
};

export const MODEL_FILES: Readonly<Record<ShippedModelName, string>> = { behaviour: 'behaviour.model.txt', attack: 'attack.model.json' };
export const metaFileOf = (name: ShippedModelName) => `${name}.meta.json`;
export const REPORT_FILE = 'training-report.json';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const flatten = (rows: readonly PreparedRow[], ncol: number) => {
  const flat = new Float64Array(rows.length * ncol);
  rows.forEach((r, i) => flat.set(r.x, i * ncol));
  return flat;
};
const refuseAs = (model: ShippedModelName, err: unknown): never => {
  if (err instanceof TrainingRefusedError) throw err;
  if (err instanceof SplitRefusedError || err instanceof DatasetRefusedError) throw new TrainingRefusedError(model, err.message);
  throw err;
};

/**
 * The validation loss after each boosting iteration, from the max-round model (the trees of an iteration added in order, XGBoost in
 * float32 as its predictor does). `loss` receives every row's linked outputs.
 */
export function lossPerIteration(ensemble: TreeEnsemble, rows: readonly Float64Array[], loss: (outputs: Float64Array[]) => number): number[] {
  const k = ensemble.numOutputs;
  const iterations = Math.floor(ensemble.trees.length / k);
  const x = rows.map((r) => prepareRow(ensemble, r));
  const raw = rows.map(() => Float64Array.from(ensemble.baseMargin));
  const losses: number[] = [];
  for (let it = 0; it < iterations; it++) {
    for (let t = it * k; t < (it + 1) * k; t++) {
      const tree = ensemble.trees[t];
      const out = ensemble.treeOutput[t];
      for (let i = 0; i < x.length; i++) {
        const v = tree.value[leafOf(tree, ensemble.splitRule, x[i])];
        raw[i][out] = ensemble.float32Accumulate ? Math.fround(raw[i][out] + v) : raw[i][out] + v;
      }
    }
    losses.push(loss(raw.map((r) => applyLink(ensemble, r))));
  }
  return losses;
}

/** Balanced class weights over the training rows' targets: N / (classes × n_c). */
export function classWeights(targets: readonly number[], classCount: number): number[] {
  const counts = new Array<number>(classCount).fill(0);
  for (const t of targets) counts[t] += 1;
  return counts.map((n) => (n > 0 ? targets.length / (classCount * n) : 0));
}

/** The behaviour model's parameters (fixed seed, deterministic, gbdt, numeric only; 4.1). */
export function behaviourParams(seed: number, trainRows: number): Params {
  return {
    objective: 'binary', boosting: 'gbdt', linear_tree: false, num_leaves: 31, max_depth: 12, learning_rate: 0.05,
    min_data_in_leaf: Math.max(5, Math.min(20, Math.floor(trainRows / 50))), min_sum_hessian_in_leaf: 0.001,
    feature_fraction: 0.9, bagging_fraction: 0.8, bagging_freq: 1, lambda_l2: 1, max_bin: 255,
    use_missing: true, zero_as_missing: false, seed, deterministic: true, force_row_wise: true, num_threads: 1,
  };
}

/** The attack model's parameters (gbtree, single-output trees, depth 6 of at most 8; 4.1). */
export function attackParams(seed: number, classCount: number): Params {
  return {
    booster: 'gbtree', ...(classCount > 2 ? { objective: 'multi:softprob', num_class: classCount } : { objective: 'binary:logistic' }),
    max_depth: 6, eta: 0.1, subsample: 0.8, colsample_bytree: 0.9, min_child_weight: 0.5, lambda: 1, tree_method: 'hist', max_bin: 256,
    num_parallel_tree: 1, seed,
  };
}

const windowOf = <T extends { hour: string }>(s: TimeSplit<T>) => ({
  train: { from: s.train.from, to: s.train.to, rows: s.train.rows.length },
  calibration: { from: s.calibration.from, to: s.calibration.to, rows: s.calibration.rows.length },
  test: { from: s.test.from, to: s.test.to, rows: s.test.rows.length },
});

const reportConfusion = (c: Confusion) => ({ ...c, precision: round6(c.precision), recall: round6(c.recall), fpr: round6(c.fpr) });
const reportChoice = (c: ThresholdChoice) => ({ value: c.value, target: c.target, met: c.met });

/** The run of one model: what the orchestrator needs for the meta, the report and the joint holdout. */
export type ModelRun = {
  name: ShippedModelName;
  text: string;
  ensemble: TreeEnsemble;
  /** The meta without `independence` (the orchestrator adds it once both models ran). */
  meta: Omit<ShippedModelMeta, 'independence'>;
  /** The test slice's rows, scored: the joint holdout's inputs. */
  joint: JointInput[];
};

type RunContext = { header: DatasetHeader; synthetic: boolean; options: TrainOptions; dataset: LoadedDataset; skipped: Record<PrepareSkip, number>; rowsRead: number };

function baseMeta(name: ShippedModelName, ctx: RunContext, text: string, classes: string[]): Omit<ShippedModelMeta, 'independence'> {
  const library = name === 'behaviour' ? 'lightgbm' : 'xgboost';
  return {
    name,
    library,
    libraryVersion: LIBRARY_VERSIONS[library],
    modelFile: MODEL_FILES[name],
    sha256: sha256(text),
    catalogue: ctx.dataset.catalogue.name,
    catalogueHash: ctx.dataset.hash,
    featureNames: featureNames(ctx.dataset.catalogue),
    classes,
    trainedAt: ctx.options.now.toISOString(),
    synthetic: ctx.synthetic,
  };
}

const datasetRecord = (ctx: RunContext, used: number) => ({
  format: ctx.header.format,
  createdHour: ctx.header.createdHour,
  installRole: ctx.header.installRole,
  synthetic: ctx.synthetic,
  rowsRead: ctx.rowsRead,
  rowsUsed: used,
  skipped: ctx.skipped,
});

/* ──────────────────────────────── Behaviour: LightGBM binary ──────────────────────────────── */

export function trainBehaviour(lib: LightGbm, ctx: RunContext): ModelRun {
  const { options: o, dataset } = ctx;
  const names = featureNames(dataset.catalogue);
  const prepared = prepareRows('behaviour', dataset.rows);
  ctx.skipped = prepared.skipped;
  if (prepared.rows.length < o.minRows) throw new TrainingRefusedError('behaviour', `${prepared.rows.length} usable rows, at least ${o.minRows} needed`);
  let split: TimeSplit<PreparedRow>;
  try { split = timeSplit(prepared.rows, o.split); } catch (e) { return refuseAs('behaviour', e); }
  const train = split.train.rows;
  const y = train.map((r) => r.target);
  if (!y.includes(0) || !y.includes(1)) throw new TrainingRefusedError('behaviour', 'the training part needs benign and anomalous rows');
  const cw = classWeights(y, 2);
  const weightOf = (r: PreparedRow) => cw[r.target] * r.confidence;
  // 4.11: a feature the attacker shapes for free must explain more to be chosen (D55-121).
  const params = { ...behaviourParams(o.seed, train.length), feature_contri: lightGbmFeatureContri(names) };
  assertParams('behaviour', params);
  const input = { data: flatten(train, names.length), nrow: train.length, ncol: names.length, labels: y, weights: train.map(weightOf), featureNames: names, params };

  // Early stopping on the calibration slice's weighted log loss, then the model of exactly the best iteration count (same seed).
  const full = lib.train({ ...input, rounds: o.maxRounds });
  const fullModel = parseLightGbmModel(full);
  const calib = split.calibration.rows;
  const calibY = calib.map((r) => r.target);
  const calibW = calib.map((r) => (cw[r.target] || 1) * r.confidence);
  const losses = lossPerIteration(fullModel, calib.map((r) => r.x), (out) => binaryLogLoss(out.map((v) => v[0]), calibY, calibW));
  const best = earlyStoppingIteration(losses, o.patience);
  const trainedIterations = fullModel.trees.length;
  const text = best + 1 === trainedIterations ? full : lib.train({ ...input, rounds: best + 1 });

  const draft = baseMeta('behaviour', ctx, text, [BEHAVIOUR_OUTPUT]);
  const ensemble = checkTrainedModel('behaviour', text, draft);
  const parity = lightGbmParity(lib, text, ensemble, parityRows(ensemble, split.test.rows.slice(0, 100).map((r) => r.x), o.seed));
  if (parity.mismatches.length) throw new TrainingRefusedError('behaviour', `the evaluator and LightGBM disagree: ${parity.mismatches.slice(0, 3).join('; ')}`);

  const score = (rows: readonly PreparedRow[]) => Float64Array.from(rows, (r) => predict(ensemble, r.x).output[0]);
  const calibScores = score(calib);
  let suspicion = recallThreshold(calibScores, calibY, o.targets.behaviourRecall);
  if (suspicion.value >= 1) suspicion = { ...suspicion, value: justBelow(1) };
  if (suspicion.value <= 0) suspicion = { ...suspicion, value: Number.MIN_VALUE };
  const fpr = fprThreshold(calib.map((r) => ({ actor: r.actor, day: r.day, y: r.target })), calibScores, o.targets.behaviourActorDayFpr);

  const metricsOf = (rows: readonly PreparedRow[], scores: Float64Array) => {
    const yy = rows.map((r) => r.target);
    const days = rows.map((r) => ({ actor: r.actor, day: r.day, y: r.target }));
    const at = (t: number) => ({ ...reportConfusion(confusion(Array.from(scores, (s) => s >= t), yy)), actorDayFpr: round6(actorDayFpr(days, scores, t).fpr) });
    return {
      rows: rows.length,
      anomalous: yy.filter(Boolean).length,
      benignActorDays: actorDayFpr(days, scores, 1).actorDays,
      auc: round6(rocAuc(scores, yy)),
      logLoss: round6(binaryLogLoss(scores, yy)),
      atSuspicion: at(suspicion.value),
      atFprTarget: at(fpr.value),
    };
  };
  const testScores = score(split.test.rows);
  const meta = {
    ...draft,
    thresholds: { suspicion: suspicion.value, fprTarget: fpr.value },
    thresholdTargetsMet: { suspicion: suspicion.met, fprTarget: fpr.met },
    training: {
      dataset: datasetRecord(ctx, prepared.rows.length),
      window: windowOf(split),
      split: o.split,
      seed: o.seed,
      params,
      evasion: evasionRecord('behaviour', names),
      rounds: { max: o.maxRounds, trained: trainedIterations, best: best + 1, patience: o.patience, calibrationLoss: losses.map((l) => round6(l)) },
      classWeights: { benign: round6(cw[0]), [BEHAVIOUR_OUTPUT]: round6(cw[1]) },
      weights: 'class weight × label confidence',
      thresholdChoices: { suspicion: reportChoice(suspicion), fprTarget: reportChoice(fpr) },
      targets: { recall: o.targets.behaviourRecall, actorDayFpr: o.targets.behaviourActorDayFpr },
      metrics: { calibration: metricsOf(calib, calibScores), test: metricsOf(split.test.rows, testScores) },
      parity: { rows: parity.rows, tolerance: PARITY_TOLERANCE.lightgbm },
    },
  };
  const joint: JointInput[] = split.test.rows.map((r, i) => ({ ref: r.ref, y: r.target, suspicion: testScores[i], flag: testScores[i] >= suspicion.value }));
  return { name: 'behaviour', text, ensemble, meta, joint };
}

/* ──────────────────────────────── Attack: XGBoost multi:softprob ──────────────────────────────── */

/** The cascade's view of an attack model's output: the classes and probabilities as `decideCascade` reads them. */
export function attackScoreOf(classes: readonly string[], output: Float64Array): AttackScore {
  return { classes, probabilities: output };
}

/** The attack score the stage-2 thresholds compare: the top attack class's probability when it beats benign, else 0. */
export function stage2Score(score: AttackScore): number {
  const top = topAttack(score);
  return top && benignScore(score) < top.attackScore ? top.attackScore : 0;
}

/** How suspicious the attack model finds a row (for the error correlation): 1 - P(benign) (for the one-class variant, its one P). */
export function attackSuspicion(score: AttackScore): number {
  return score.classes.includes(BENIGN_CLASS) ? 1 - benignScore(score) : (topAttack(score)?.attackScore ?? 0);
}

export function trainAttack(lib: XgBoost, ctx: RunContext): ModelRun & { stage2: { challenge: number; block: number; terminate: number } } {
  const { options: o, dataset } = ctx;
  const names = featureNames(dataset.catalogue);
  const prepared = prepareRows('attack', dataset.rows);
  ctx.skipped = prepared.skipped;
  if (prepared.rows.length < o.minRows) throw new TrainingRefusedError('attack', `${prepared.rows.length} usable rows, at least ${o.minRows} needed`);
  let split: TimeSplit<PreparedRow>;
  try { split = timeSplit(prepared.rows, o.split); } catch (e) { return refuseAs('attack', e); }
  const train = split.train.rows;
  const present = ATTACK_MODEL_CLASSES.filter((c) => train.some((r) => r.attackClass === c));
  if (!present.includes('benign')) throw new TrainingRefusedError('attack', 'the training part has no benign rows');
  if (present.length < 2) throw new TrainingRefusedError('attack', 'the training part has no attack rows');
  const multi = present.length > 2;
  // One attack class only: the one-class variant (binary:logistic) names that class; the loader requires it not to be "benign".
  const modelClasses: string[] = multi ? [...present] : present.filter((c) => c !== 'benign');
  const labelOf = (c: AttackModelClass | undefined): number => (multi ? present.indexOf(c as AttackModelClass) : c === 'benign' ? 0 : 1);
  const known = (r: PreparedRow) => present.includes(r.attackClass as AttackModelClass);
  const y = train.map((r) => labelOf(r.attackClass));
  const cw = classWeights(y, multi ? present.length : 2);
  const params = attackParams(o.seed, present.length);
  assertParams('attack', params);
  const input = {
    data: flatten(train, names.length), nrow: train.length, ncol: names.length, labels: y, weights: train.map((r, i) => cw[y[i]] * r.confidence),
    // 4.11: the column sampling draws a feature the attacker shapes for free half as often (D55-121).
    featureWeights: featureWeights('attack', names), featureNames: names, params,
  };

  const full = lib.train({ ...input, rounds: o.maxRounds });
  const fullModel = parseXgBoostModel(full);
  const calib = split.calibration.rows;
  const calibKnown = calib.filter(known);
  if (calibKnown.length === 0) throw new TrainingRefusedError('attack', 'the calibration part has no rows of a trained class');
  const calibY = calibKnown.map((r) => labelOf(r.attackClass));
  const calibW = calibKnown.map((r, i) => (cw[calibY[i]] || 1) * r.confidence);
  const losses = lossPerIteration(fullModel, calibKnown.map((r) => r.x), (out) =>
    multi ? multiLogLoss(out, calibY, calibW) : binaryLogLoss(out.map((v) => v[0]), calibY, calibW));
  const best = earlyStoppingIteration(losses, o.patience);
  const trainedIterations = fullModel.trees.length / fullModel.numOutputs;
  const text = best + 1 === trainedIterations ? full : lib.train({ ...input, rounds: best + 1 });

  const draft = baseMeta('attack', ctx, text, modelClasses);
  const ensemble = checkTrainedModel('attack', text, draft);
  const parity = xgBoostParity(lib, text, ensemble, parityRows(ensemble, split.test.rows.slice(0, 100).map((r) => r.x), o.seed));
  if (parity.mismatches.length) throw new TrainingRefusedError('attack', `the evaluator and XGBoost disagree: ${parity.mismatches.slice(0, 3).join('; ')}`);

  const scoreRows = (rows: readonly PreparedRow[]) => rows.map((r) => attackScoreOf(modelClasses, predict(ensemble, r.x).output));
  const isAttack = (r: PreparedRow) => (r.attackClass === 'benign' ? 0 : 1);
  const calibScores = scoreRows(calib);
  const calibS = Float64Array.from(calibScores, stage2Score);
  const calibBin = calib.map(isAttack);
  const challenge = precisionThreshold(calibS, calibBin, o.targets.attackChallengePrecision);
  const blockRaw = precisionThreshold(calibS, calibBin, o.targets.attackBlockPrecision);
  const block = { ...blockRaw, value: Math.max(blockRaw.value, challenge.value) };
  const terminateRaw = precisionThreshold(calibS, calibBin, o.targets.attackTerminatePrecision);
  const terminate = { ...terminateRaw, value: Math.max(terminateRaw.value, block.value) };

  const predicted = (s: AttackScore): AttackModelClass => {
    if (!multi) return (s.probabilities[0] >= 0.5 ? modelClasses[0] : 'benign') as AttackModelClass;
    let bi = 0;
    for (let i = 1; i < s.probabilities.length; i++) if (s.probabilities[i] > s.probabilities[bi]) bi = i;
    return present[bi];
  };
  const metricsOf = (rows: readonly PreparedRow[], scores: AttackScore[]) => {
    const s = Float64Array.from(scores, stage2Score);
    const bin = rows.map(isAttack);
    const pred = scores.map(predicted);
    const perClass: Record<string, { support: number; precision: number | null; recall: number | null }> = {};
    for (const c of present) {
      const c1 = confusion(pred.map((p) => p === c), rows.map((r) => (r.attackClass === c ? 1 : 0)));
      perClass[c] = { support: c1.tp + c1.fn, precision: round6(c1.precision), recall: round6(c1.recall) };
    }
    const matrix: Record<string, Record<string, number>> = {};
    rows.forEach((r, i) => {
      const truth = r.attackClass as string;
      matrix[truth] ??= {};
      matrix[truth][pred[i]] = (matrix[truth][pred[i]] ?? 0) + 1;
    });
    const benignTraffic = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.source === 'benign_traffic' && r.attackClass === 'benign');
    const knownRows = rows.map((r, i) => ({ r, i })).filter(({ r }) => known(r));
    const kY = knownRows.map(({ r }) => labelOf(r.attackClass));
    const kOut = knownRows.map(({ i }) => Float64Array.from(scores[i].probabilities));
    const at = (t: number) => reportConfusion(confusion(Array.from(s, (v) => v >= t), bin));
    return {
      rows: rows.length,
      attacks: bin.filter(Boolean).length,
      unseenClassRows: rows.length - knownRows.length,
      logLoss: round6(multi ? multiLogLoss(kOut, kY) : binaryLogLoss(kOut.map((v) => v[0]), kY)),
      perClass,
      confusionMatrix: matrix,
      atChallenge: at(challenge.value),
      atBlock: at(block.value),
      atTerminate: at(terminate.value),
      benignTrafficFpr: {
        rows: benignTraffic.length,
        fpr: benignTraffic.length ? round6(benignTraffic.filter(({ i }) => s[i] >= challenge.value).length / benignTraffic.length) : null,
      },
    };
  };
  const testScores = scoreRows(split.test.rows);
  const meta = {
    ...draft,
    thresholds: { challenge: challenge.value, block: block.value, terminate: terminate.value },
    thresholdTargetsMet: { challenge: challenge.met, block: block.met, terminate: terminate.met },
    training: {
      dataset: datasetRecord(ctx, prepared.rows.length),
      window: windowOf(split),
      split: o.split,
      seed: o.seed,
      params,
      evasion: evasionRecord('attack', names),
      rounds: { max: o.maxRounds, trained: trainedIterations, best: best + 1, patience: o.patience, calibrationLoss: losses.map((l) => round6(l)) },
      classWeights: Object.fromEntries((multi ? ([...present] as string[]) : ['benign', modelClasses[0]]).map((c, i) => [c, round6(cw[i])])),
      weights: 'class weight × label confidence',
      labelMapping: ATTACK_CLASS_OF_LABEL,
      classesWithoutRows: ATTACK_MODEL_CLASSES.filter((c) => !present.includes(c)),
      thresholdChoices: { challenge: reportChoice(challenge), block: reportChoice(block), terminate: reportChoice(terminate) },
      targets: { challenge: o.targets.attackChallengePrecision, block: o.targets.attackBlockPrecision, terminate: o.targets.attackTerminatePrecision },
      metrics: { calibration: metricsOf(calib, calibScores), test: metricsOf(split.test.rows, testScores) },
      parity: { rows: parity.rows, tolerance: PARITY_TOLERANCE.xgboost },
    },
  };
  const joint: JointInput[] = split.test.rows.map((r, i) => ({
    ref: r.ref, y: isAttack(r), suspicion: attackSuspicion(testScores[i]), flag: stage2Score(testScores[i]) >= challenge.value && stage2Score(testScores[i]) > 0,
  }));
  return { name: 'attack', text, ensemble, meta, joint, stage2: { challenge: challenge.value, block: block.value, terminate: terminate.value } };
}

/* ──────────────────────────────── The run ──────────────────────────────── */

export type TrainingInput = {
  /** The export's files by name (`manifest.json`, `behaviour.v1.jsonl`, `attack.v1.jsonl`). */
  readonly files: Readonly<Record<string, string>>;
  readonly libs: { readonly lightgbm?: LightGbm; readonly xgboost?: XgBoost };
  readonly options: TrainOptions;
  /** Train one model only (its independence is then `not_run`, which blocks promotion). */
  readonly only?: ShippedModelName;
};

export type TrainingResult = {
  /** File name → text: the model files, their metas and the report. */
  readonly files: Record<string, string>;
  readonly metas: Partial<Record<ShippedModelName, ShippedModelMeta>>;
  readonly report: TrainingReport;
};

export type TrainingReport = {
  readonly format: 'nb.ai_firewall.training-report/1';
  readonly trainedAt: string;
  readonly synthetic: boolean;
  readonly dataset: DatasetHeader;
  readonly models: Partial<Record<ShippedModelName, { file: string; sha256: string; thresholds: unknown; thresholdTargetsMet: unknown; metrics: unknown }>>;
  readonly independence: IndependenceReport | { status: 'not_run'; bound: number; jointRows: 0; errorCorrelation: null };
};

/** Trains what the dataset and `only` ask for; throws TrainingRefusedError (or DatasetRefusedError) and writes nothing on any refusal. */
export function runTraining(input: TrainingInput): TrainingResult {
  const { files, libs, options } = input;
  const manifestText = files['manifest.json'];
  if (manifestText === undefined) throw new DatasetRefusedError('manifest.json is missing');
  const { header, raw } = readManifest(manifestText);
  const wanted: ModelName[] = input.only ? [input.only] : ['behaviour', 'attack'];
  const datasets = Object.fromEntries(wanted.map((m) => [m, readDataset(raw, m, files[`${m}.v1.jsonl`])])) as Partial<Record<ModelName, LoadedDataset>>;
  const synthetic = datasetIsSynthetic(header, Object.values(datasets) as LoadedDataset[]);
  const ctxOf = (m: ModelName): RunContext => ({ header, synthetic, options, dataset: datasets[m]!, skipped: {} as Record<PrepareSkip, number>, rowsRead: datasets[m]!.rows.length });

  let behaviour: ModelRun | undefined;
  let attack: ReturnType<typeof trainAttack> | undefined;
  if (wanted.includes('behaviour')) {
    if (!libs.lightgbm) throw new TrainingRefusedError('behaviour', 'no LightGBM library');
    behaviour = trainBehaviour(libs.lightgbm, ctxOf('behaviour'));
  }
  if (wanted.includes('attack')) {
    if (!libs.xgboost) throw new TrainingRefusedError('attack', 'no XGBoost library');
    attack = trainAttack(libs.xgboost, ctxOf('attack'));
  }

  // The thresholds of the two stages together must satisfy the cascade's own check (04.8).
  try {
    validateThresholds({
      suspicion: (behaviour?.meta.thresholds?.suspicion as number | undefined) ?? 0.5,
      challenge: attack?.stage2.challenge ?? 0.5,
      block: attack?.stage2.block ?? 0.5,
      terminate: attack?.stage2.terminate ?? 0.5,
    });
  } catch (e) {
    throw new TrainingRefusedError(attack ? 'attack' : 'behaviour', `thresholds: ${(e as Error).message}`);
  }

  const independence: TrainingReport['independence'] = behaviour && attack
    ? independenceOf(behaviour.joint, attack.joint, options.maxErrorCorrelation)
    : { status: 'not_run', bound: options.maxErrorCorrelation, jointRows: 0, errorCorrelation: null };
  // D55-130: each meta names the partner it was measured against (null with one model trained).
  const peerOf = (name: ShippedModelName): string | null => (name === 'behaviour' ? attack?.meta.sha256 : behaviour?.meta.sha256)?.toLowerCase() ?? null;
  const metaIndependence = (name: ShippedModelName): ModelIndependence => ({
    status: independence.status, errorCorrelation: independence.errorCorrelation, bound: independence.bound, jointRows: independence.jointRows,
    peerSha256: independence.status === 'not_run' ? null : peerOf(name),
  });

  const out: Record<string, string> = {};
  const metas: Partial<Record<ShippedModelName, ShippedModelMeta>> = {};
  const models: TrainingReport['models'] = {};
  for (const run of [behaviour, attack]) {
    if (!run) continue;
    const meta: ShippedModelMeta = { ...run.meta, independence: metaIndependence(run.name) };
    // The written pair, loaded once more exactly as the request path will load it (fail closed before anything is written).
    checkTrainedModel(run.name, run.text, meta);
    out[MODEL_FILES[run.name]] = run.text;
    out[metaFileOf(run.name)] = `${JSON.stringify(meta, null, 2)}\n`;
    metas[run.name] = meta;
    models[run.name] = {
      file: MODEL_FILES[run.name], sha256: meta.sha256, thresholds: meta.thresholds, thresholdTargetsMet: meta.thresholdTargetsMet,
      metrics: (meta.training as { metrics?: unknown } | undefined)?.metrics,
    };
  }
  const report: TrainingReport = {
    format: 'nb.ai_firewall.training-report/1', trainedAt: options.now.toISOString(), synthetic, dataset: { ...header, synthetic }, models, independence,
  };
  out[REPORT_FILE] = `${JSON.stringify(report, null, 2)}\n`;
  return { files: out, metas, report };
}
