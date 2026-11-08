import { loadModelSource } from '../models/shipped-models';
import type { ShippedModelMeta, ShippedModelName } from '../models/shipped-models.types';
import { LIGHTGBM_LIMITS } from '../trees/lightgbm.parse';
import { XGBOOST_LIMITS } from '../trees/xgboost.parse';
import type { TreeEnsemble } from '../trees/tree-ensemble.types';

/**
 * The training constraints the evaluator relies on (docs/phases/55-ai-firewall/04-tree-models.md 4.1). The trainer checks them twice:
 * on the parameters before it trains (a parameter set that could produce a refused model is never run), and on the model it is about
 * to write, by loading it exactly as the request path will (`loadModelSource`: the module's own parsers with their refusals, the
 * stage's library and objective, the feature names and outputs against the meta, the sha256) plus the checks a parser cannot see
 * (LightGBM's recorded parameters). A model that breaks one is never written (TrainingRefusedError).
 */

/** The vendored libraries' versions (vendor/<library>/BUILD.json; `training.constraints.test.ts` ties them). */
export const LIBRARY_VERSIONS = { lightgbm: '4.7.0', xgboost: '3.4.2' } as const;

/** The objectives the trainer writes per stage (a subset of the loader's STAGE_OBJECTIVES: no `multi:softmax`, it has no probabilities). */
export const TRAINER_OBJECTIVES: Readonly<Record<ShippedModelName, readonly string[]>> = {
  behaviour: ['binary'],
  attack: ['multi:softprob', 'binary:logistic'],
};

export class TrainingRefusedError extends Error {
  constructor(
    readonly model: ShippedModelName,
    readonly reason: string,
  ) {
    super(`${model} model refused: ${reason}`);
    this.name = 'TrainingRefusedError';
  }
}

export type Params = Readonly<Record<string, string | number | boolean>>;

const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const CATEGORICAL_KEYS = ['categorical_feature', 'categorical_column', 'cat_feature', 'categorical_features'];

/** What is wrong with a LightGBM parameter set for the behaviour stage (empty: none). */
export function lightGbmParamProblems(p: Params): string[] {
  const out: string[] = [];
  if (p.boosting !== 'gbdt' || p.boosting_type !== undefined || p.boost !== undefined) out.push('boosting must be "gbdt", set as `boosting`');
  if (p.objective !== 'binary') out.push('objective must be "binary"');
  if (truthy(p.linear_tree) || truthy(p.linear_trees)) out.push('linear_tree is not supported');
  if (CATEGORICAL_KEYS.some((k) => p[k] !== undefined && p[k] !== '')) out.push('categorical features are not supported (encode them as numbers in the feature code)');
  const depth = Number(p.max_depth);
  if (!Number.isInteger(depth) || depth < 1 || depth > LIGHTGBM_LIMITS.maxDepth) out.push(`max_depth must be set, 1 to ${LIGHTGBM_LIMITS.maxDepth}`);
  if (p.num_class !== undefined && Number(p.num_class) !== 1) out.push('num_class must be 1 for a binary model');
  // The export's null is a missing value and 0 is a value (manifest `missing`): never zero-as-missing, never missing as zero.
  if (truthy(p.zero_as_missing)) out.push('zero_as_missing is not allowed: 0 is a value, null is missing');
  if (p.use_missing !== undefined && !truthy(p.use_missing)) out.push('use_missing must stay on');
  if (p.deterministic !== true || p.seed === undefined) out.push('training must be deterministic with a fixed seed');
  return out;
}

/** What is wrong with an XGBoost parameter set for the attack stage (empty: none). */
export function xgboostParamProblems(p: Params): string[] {
  const out: string[] = [];
  if (p.booster !== 'gbtree') out.push('booster must be "gbtree" (no dart, no gblinear)');
  if (p.num_parallel_tree !== undefined && Number(p.num_parallel_tree) !== 1) out.push('num_parallel_tree must be 1');
  if (p.multi_strategy !== undefined && p.multi_strategy !== 'one_output_per_tree') out.push('multi_strategy must be one_output_per_tree (single-output trees)');
  if (truthy(p.enable_categorical)) out.push('enable_categorical is not supported');
  const depth = Number(p.max_depth);
  if (!Number.isInteger(depth) || depth < 1 || depth > XGBOOST_LIMITS.maxDepth) out.push(`max_depth must be set, 1 to ${XGBOOST_LIMITS.maxDepth}`);
  if (p.objective === 'multi:softprob') {
    const k = Number(p.num_class);
    if (!Number.isInteger(k) || k < 2 || k > XGBOOST_LIMITS.maxClasses) out.push('multi:softprob needs num_class 2 or more');
  } else if (p.objective === 'binary:logistic') {
    if (p.num_class !== undefined) out.push('binary:logistic takes no num_class');
  } else {
    out.push('objective must be multi:softprob (or binary:logistic for a one-class model)');
  }
  if (p.seed === undefined) out.push('training must use a fixed seed');
  return out;
}

/** Refuses before training when the parameters break a constraint. */
export function assertParams(model: ShippedModelName, params: Params): void {
  const problems = model === 'behaviour' ? lightGbmParamProblems(params) : xgboostParamProblems(params);
  if (problems.length) throw new TrainingRefusedError(model, problems.join('; '));
}

/** LightGBM's `parameters:` section of a text model, as key → value (`[boosting: gbdt]`). */
export function lightGbmRecordedParams(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const start = text.indexOf('\nparameters:\n');
  if (start < 0) return out;
  const end = text.indexOf('\nend of parameters', start);
  for (const line of text.slice(start, end < 0 ? undefined : end).split('\n')) {
    const m = /^\[([A-Za-z0-9_]+): ?(.*)\]$/.exec(line.trim());
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * The model about to be written, checked as the request path will load it (FWA-7: a model the loader would refuse is never written).
 * Returns the parsed ensemble.
 */
export function checkTrainedModel(model: ShippedModelName, text: string, meta: ShippedModelMeta): TreeEnsemble {
  const loaded = loadModelSource(model, { meta, text }, { allowSynthetic: meta.synthetic === true });
  if (!loaded.ok) throw new TrainingRefusedError(model, `${loaded.reason}: ${loaded.detail}`);
  const ensemble = loaded.ensemble;
  if (!TRAINER_OBJECTIVES[model].includes(ensemble.objective)) {
    throw new TrainingRefusedError(model, `objective ${ensemble.objective} is not one the trainer writes (${TRAINER_OBJECTIVES[model].join(', ')})`);
  }
  if (model === 'behaviour') {
    const recorded = lightGbmRecordedParams(text);
    if (recorded.size === 0) throw new TrainingRefusedError(model, 'the model records no parameters section');
    if (recorded.get('boosting') !== 'gbdt') throw new TrainingRefusedError(model, `boosting ${recorded.get('boosting') ?? '(none)'} is not gbdt`);
    if ((recorded.get('linear_tree') ?? '0') !== '0') throw new TrainingRefusedError(model, 'a linear-tree model');
    const cats = recorded.get('categorical_feature') ?? '';
    if (cats !== '') throw new TrainingRefusedError(model, 'a model with categorical features');
  }
  const limit = model === 'behaviour' ? LIGHTGBM_LIMITS.maxDepth : XGBOOST_LIMITS.maxDepth;
  if (ensemble.trees.some((t) => t.maxDepth > limit)) throw new TrainingRefusedError(model, `a tree deeper than ${limit}`);
  return ensemble;
}
