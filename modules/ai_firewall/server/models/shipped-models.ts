/**
 * Loading a shipped model (docs/phases/55-ai-firewall/04-tree-models.md 4.5): the meta must have every field, the sha256 of the
 * embedded text must equal the meta's, the file must parse under the evaluator's constraints (4.1), its objective must be the one
 * its stage needs, and its feature names and outputs must match the meta. Any failure turns the model off and says why; the cascade
 * then allows (FWA-7) and the rule scorer carries on. Never throws, and a failure is cached like a success.
 */
import { createHash } from 'node:crypto';
import { parseLightGbmModel } from '../trees/lightgbm.parse';
import { parseXgBoostModel } from '../trees/xgboost.parse';
import { ModelRefusedError, type TreeEnsemble } from '../trees/tree-ensemble.types';
import { SHIPPED_MODELS } from './shipped-models.generated';
import { metaProblem } from './shipped-models.meta';
import type { ShippedModelMeta, ShippedModelName, ShippedModelSource } from './shipped-models.types';

export type ModelLoadFailure =
  | 'absent'
  | 'invalid_meta'
  | 'checksum_mismatch'
  | 'refused'
  | 'library_mismatch'
  | 'objective_mismatch'
  | 'feature_mismatch'
  | 'class_mismatch'
  | 'synthetic';

export type ModelLoadResult =
  | { readonly ok: true; readonly ensemble: TreeEnsemble; readonly meta: ShippedModelMeta }
  | { readonly ok: false; readonly reason: ModelLoadFailure; readonly detail: string };

/** Which library each stage must be (FWD-6). A behaviour model trained with XGBoost is a mistake, not a variant. */
export const STAGE_LIBRARY: Readonly<Record<ShippedModelName, 'lightgbm' | 'xgboost'>> = { behaviour: 'lightgbm', attack: 'xgboost' };

/** The objectives each stage may have (04.1): a binary behaviour score; attack class probabilities (or a one-class variant). */
export const STAGE_OBJECTIVES: Readonly<Record<ShippedModelName, readonly string[]>> = {
  behaviour: ['binary'],
  attack: ['multi:softprob', 'multi:softmax', 'binary:logistic'],
};

/** The attack model's class list must name `benign` exactly once (multiclass), or be one attack class (the binary variant). */
const BENIGN = 'benign';

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const fail = (reason: ModelLoadFailure, detail: string): ModelLoadResult => ({ ok: false, reason, detail });

/** `allowSynthetic`: the trainer's own check of a synthetic run (04.1) and its tests; the shipped path never sets it. */
export type LoadOptions = { readonly allowSynthetic?: boolean };

function load(name: ShippedModelName, source: ShippedModelSource | undefined, options: LoadOptions): ModelLoadResult {
  if (!source) return fail('absent', `no ${name} model is shipped`);
  const problem = metaProblem(source.meta);
  if (problem) return fail('invalid_meta', problem);
  // 04.1: a model trained on the synthetic dataset is a smoke run's, never a stage's
  if (source.meta.synthetic === true && options.allowSynthetic !== true) return fail('synthetic', 'the meta says the model was trained on synthetic data');
  if (typeof source.text !== 'string') return fail('invalid_meta', 'the model text is missing');
  const { meta, text } = source;
  if (meta.name !== name || meta.library !== STAGE_LIBRARY[name]) {
    return fail('library_mismatch', `the ${name} stage needs a ${STAGE_LIBRARY[name]} model, the meta says ${meta.name}/${meta.library}`);
  }
  const actual = sha256Hex(text);
  if (actual !== meta.sha256.toLowerCase()) return fail('checksum_mismatch', `sha256 ${actual} does not match the meta's ${meta.sha256}`);

  let ensemble: TreeEnsemble;
  try {
    ensemble = meta.library === 'lightgbm' ? parseLightGbmModel(text) : parseXgBoostModel(text);
  } catch (err) {
    return fail('refused', err instanceof ModelRefusedError ? err.reason : `unreadable model: ${(err as Error)?.message ?? String(err)}`);
  }
  if (!STAGE_OBJECTIVES[name].includes(ensemble.objective)) {
    return fail('objective_mismatch', `the ${name} stage needs ${STAGE_OBJECTIVES[name].join(' or ')}, the model is ${ensemble.objective}`);
  }
  const names = ensemble.featureNames;
  if (names.length !== meta.featureNames.length || names.some((n, i) => n !== meta.featureNames[i])) {
    return fail('feature_mismatch', 'the model file and the meta name different features');
  }
  if (meta.classes.length !== ensemble.numOutputs) {
    return fail('class_mismatch', `the meta names ${meta.classes.length} outputs, the model has ${ensemble.numOutputs}`);
  }
  if (name === 'attack') {
    const benign = meta.classes.filter((c) => c === BENIGN).length;
    if (ensemble.numOutputs > 1 ? benign !== 1 : benign !== 0) {
      return fail('class_mismatch', ensemble.numOutputs > 1 ? 'a multiclass attack model must have exactly one "benign" class' : 'a one-class attack model names its attack class, not "benign"');
    }
  }
  return { ok: true, ensemble, meta };
}

/** Checks and parses one model source. Total: any unexpected error becomes a `refused` result. */
export function loadModelSource(name: ShippedModelName, source: ShippedModelSource | undefined, options: LoadOptions = {}): ModelLoadResult {
  try {
    return load(name, source, options);
  } catch (err) {
    return fail('refused', `unexpected: ${(err as Error)?.message ?? String(err)}`);
  }
}

const cache = new Map<ShippedModelName, ModelLoadResult>();

/** The shipped model of a stage, parsed once per process (a failure is remembered too). */
export function loadShippedModel(name: ShippedModelName): ModelLoadResult {
  let result = cache.get(name);
  if (!result) {
    result = loadModelSource(name, SHIPPED_MODELS[name]);
    cache.set(name, result);
  }
  return result;
}
