/**
 * Shadow mode (docs/phases/55-ai-firewall/04-tree-models.md 4.6): the two tree models score the same vectors the rule scorer reads, in the
 * worker's detection evaluator, and nothing acts on what they say. Pure: a loaded model (the loader's `ok` result) and an actor's vectors
 * in; per model a probability, what it means at the model's own thresholds (the trainer's meta, 04.1) and, when asked, its TreeSHAP
 * contributions in the shared `RiskScore` shape (02 §2.2), so the pages show the rules and both models alike.
 *
 *   behaviour (LightGBM)  people, sessions and API keys with a baseline of their own (a cold-start actor has nothing to deviate from and
 *                         never reaches stage 1, 04.8); P(anomalous) against `suspicion` and `fprTarget`;
 *   attack (XGBoost)      every actor kind the catalogue describes; the most likely attack class against `challenge`, `block`, `terminate`
 *                         when it beats `benign` (the cascade's own rule, `topAttack` / `benignScore`).
 *
 * A vector of another catalogue, version or pinned hash than the model's is not scored (`catalogue_mismatch`): a model is never explained
 * with another catalogue's names. Fail open (FWA-7): a model that throws on a row scores nothing for it; the caller counts it.
 */
import { contributions } from '../trees/tree-shap';
import { predict } from '../trees/tree-ensemble.predict';
import type { TreeEnsemble } from '../trees/tree-ensemble.types';
import type { ShippedModelMeta } from '../models/shipped-models.types';
import { benignScore, topAttack, type AttackScore } from '../cascade/cascade';
import { ATTACK_V1, BEHAVIOUR_V1, type FeatureCatalogue } from '../features/ai_firewall.feature-catalogue';
import type { FeatureVector } from '../features/ai_firewall.feature-vector';
import {
  treeContributions, verdictRung, type ModelShadowScore, type ModelShadowScores, type ModelVerdict, type ShadowModelId,
} from '../detect/ai_firewall.risk';

/** A model as the shadow scores it: the loader's parsed ensemble and its meta. */
export interface ShadowModel {
  readonly ensemble: TreeEnsemble;
  readonly meta: ShippedModelMeta;
}
export type ShadowModels = Partial<Record<ShadowModelId, ShadowModel>>;

export interface ShadowInput {
  actorKind: string;
  coldStart: boolean;
  behaviour: Pick<FeatureVector, 'catalogue' | 'hash' | 'names' | 'values'>;
  attack: Pick<FeatureVector, 'catalogue' | 'hash' | 'names' | 'values'>;
}

/** Why a model did not score an actor: it is not loaded, does not apply to the actor, reads another catalogue, or failed on the row. */
export type ShadowSkip = 'not_loaded' | 'not_applicable' | 'cold_start' | 'catalogue_mismatch' | 'failed';

export interface ShadowResult {
  scores: ModelShadowScores;
  skipped: Partial<Record<ShadowModelId, ShadowSkip>>;
}

const CATALOGUES: Readonly<Record<ShadowModelId, FeatureCatalogue>> = { behaviour: BEHAVIOUR_V1, attack: ATTACK_V1 };

/** Whether a catalogue describes an actor of `kind` (one of its own features applies; the shared lane and kind do not count). */
export const shadowApplies = (model: ShadowModelId, kind: string): boolean =>
  CATALOGUES[model].features.some((f) => f.model !== 'shared' && (f.actorKinds as readonly string[]).includes(kind));

/** The first 12 hex characters of a sha256: enough to tell two shipped models apart in keys and incidents. */
export const shortSha = (sha256: string): string => sha256.toLowerCase().slice(0, 12);

const round = (x: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Whether the vector is the one the model was trained on: same catalogue and, when the meta pins it, the same content hash. */
export function vectorMatches(meta: Pick<ShippedModelMeta, 'catalogue' | 'catalogueHash' | 'featureNames'>, v: Pick<FeatureVector, 'catalogue' | 'hash' | 'names'>): boolean {
  if (meta.catalogue !== v.catalogue) return false;
  if (meta.catalogueHash && meta.catalogueHash !== v.hash) return false;
  return meta.featureNames.length === v.names.length && meta.featureNames.every((n, i) => n === v.names[i]);
}

/** The behaviour verdict at the meta's thresholds (`unrated` without them). */
export function behaviourVerdict(p: number, thresholds: ShippedModelMeta['thresholds']): ModelVerdict {
  const suspicion = num(thresholds?.suspicion);
  const fprTarget = num(thresholds?.fprTarget);
  if (suspicion === null || fprTarget === null) return 'unrated';
  if (p >= fprTarget) return 'step_up';
  if (p >= suspicion) return 'suspicious';
  return 'normal';
}

/** The attack verdict: benign when the benign class leads (04.8), else the highest of the three stage-2 thresholds reached. */
export function attackVerdict(score: AttackScore, thresholds: ShippedModelMeta['thresholds']): { verdict: ModelVerdict; attackClass?: string; probability: number; benign: number } {
  const top = topAttack(score);
  const benign = benignScore(score);
  if (!top) return { verdict: 'benign', probability: 0, benign };
  const { attackClass, attackScore } = top;
  if (benign >= attackScore) return { verdict: 'benign', attackClass, probability: attackScore, benign };
  const challenge = num(thresholds?.challenge);
  const block = num(thresholds?.block);
  const terminate = num(thresholds?.terminate);
  if (challenge === null || block === null || terminate === null) return { verdict: 'unrated', attackClass, probability: attackScore, benign };
  const verdict: ModelVerdict = attackScore >= terminate ? 'terminate' : attackScore >= block ? 'block' : attackScore >= challenge ? 'challenge' : 'below';
  return { verdict, attackClass, probability: attackScore, benign };
}

/** The values a tree reads: a missing feature is NaN (the evaluator sends it down each split's default branch). */
export const rowOf = (values: ReadonlyArray<number | null>): Float64Array =>
  Float64Array.from(values, (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN));

function scoreOne(name: ShadowModelId, m: ShadowModel, v: ShadowInput['behaviour'], explain: boolean): ModelShadowScore {
  const row = rowOf(v.values);
  const { output } = predict(m.ensemble, row);
  let probability: number;
  let verdict: ModelVerdict;
  let attackClass: string | undefined;
  let benign: number | undefined;
  let k = 0;
  if (name === 'behaviour') {
    probability = output[0] ?? 0;
    verdict = behaviourVerdict(probability, m.meta.thresholds);
  } else {
    const score: AttackScore = { classes: m.meta.classes, probabilities: output };
    const a = attackVerdict(score, m.meta.thresholds);
    ({ verdict, attackClass, probability, benign } = a);
    // The explained output is the leading attack class's (a one-class model has one output).
    k = attackClass ? Math.max(0, m.meta.classes.indexOf(attackClass)) : 0;
    if (m.ensemble.numOutputs === 1) k = 0;
  }
  const risk = {
    model: name,
    score: round(Math.max(0, Math.min(1, probability)) * 100),
    space: 'margin' as const,
    contributions: explain ? [treeContributions(v, contributions(m.ensemble, row)[k]!)] : [],
  };
  return {
    risk,
    probability,
    verdict,
    flagged: verdictRung(verdict) >= 1,
    ...(attackClass !== undefined ? { attackClass } : {}),
    ...(benign !== undefined ? { benign } : {}),
    sha: shortSha(m.meta.sha256),
  };
}

/**
 * Both models' shadow scores of one actor. `explain`: add the TreeSHAP contributions (only for a scoring that is handed on to the incident
 * grouping: bounded work). Never throws.
 */
export function scoreShadow(models: ShadowModels, input: ShadowInput, explain = false): ShadowResult {
  const out: ShadowResult = { scores: {}, skipped: {} };
  for (const name of ['behaviour', 'attack'] as const) {
    const m = models[name];
    if (!m) { out.skipped[name] = 'not_loaded'; continue; }
    if (!shadowApplies(name, input.actorKind)) { out.skipped[name] = 'not_applicable'; continue; }
    if (name === 'behaviour' && input.coldStart) { out.skipped[name] = 'cold_start'; continue; }
    const v = input[name];
    if (!vectorMatches(m.meta, v)) { out.skipped[name] = 'catalogue_mismatch'; continue; }
    try {
      out.scores[name] = scoreOne(name, m, v, explain);
    } catch {
      out.skipped[name] = 'failed';
    }
  }
  return out;
}

/** Whether any model flagged the actor (a rung of step-up or above): such a scoring is handed to the incident grouping in shadow too. */
export const anyFlagged = (scores: ModelShadowScores): boolean => Object.values(scores).some((s) => s?.flagged === true);
