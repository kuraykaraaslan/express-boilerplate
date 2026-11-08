import type { ActorKind, ActorRef, SignalLane } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { FeatureVector } from '../features/ai_firewall.feature-vector';
import type { CapturedVectors } from '../dataset/ai_firewall.vector-capture';

/**
 * The shape every scorer of the firewall answers in (docs/phases/55-ai-firewall/02 §2.2, 04 §4.2, §4.10): the rule scorer of 02 now,
 * the two tree models of 04 later, so the pages (2.4), the alert pipeline (2.7) and the responder (05) read one shape and do not change
 * when a model arrives.
 *
 * Per catalogue the contributions are what `tree-shap.ts` returns for one output: one number per feature in the catalogue's order and
 * the bias LAST (`values.length === names.length + 1`). For the rule scorer the space is `points` (risk points, bias 0): the values of
 * every catalogue together add up to the score exactly (test). For a tree model the space is `margin`: the values add up to the raw
 * margin (TreeSHAP local accuracy), and the score is the model's probability × 100.
 */
export interface FeatureContributions {
  /** `behaviour.v1`, `attack.v1`, `rules.v1`. */
  catalogue: string;
  /** The catalogue's content hash the vector was built with. */
  hash: string;
  names: string[];
  /** One per name, then the bias. */
  values: number[];
}

export type ScoreSpace = 'points' | 'margin';

export interface RiskScore {
  /** Who scored: the rule floor, or one of the two tree models (04). */
  model: 'rules' | 'behaviour' | 'attack';
  /** 0..100. */
  score: number;
  space: ScoreSpace;
  contributions: FeatureContributions[];
}

/** The detectors of 2.3 (rules first). Dictionary keys `ai_firewall.detector.<id>` come with the pages of 2.4. */
export const DETECTOR_IDS = [
  'credential_stuffing',
  'password_spray',
  'enumeration',
  'session_hijack',
  'data_exfiltration',
  'admin_misuse',
  'api_key_abuse',
  'public_bot',
  'signup_abuse',
  'device_lane',
] as const;
export type DetectorId = (typeof DETECTOR_IDS)[number];

export interface DetectionEvidence {
  feature: string;
  /** The feature's share of the detection's strength (the shares of one detection add up to 1). */
  share: number;
}

export interface Detection {
  detector: DetectorId;
  /** 0..1: how strongly the pattern holds. */
  strength: number;
  /** The detection's part of the score (risk points), already spread over its evidence features in the contributions. */
  points: number;
  /** Stable reason code (`detector.<id>`), never free text. */
  reason: string;
  evidence: DetectionEvidence[];
  /** FWA-6: a device-lane detection raises an alert and never a human control. */
  alertsOnly: boolean;
}

export interface RuleScoreResult {
  risk: RiskScore;
  detections: Detection[];
}

/**
 * One actor, scored: what the periodic evaluator hands the incident grouping of 2.4. Observe (2.7): nothing here acts or is proposed
 * for execution; the record is scored, grouped and shown.
 */
export interface ScoredDetection {
  /** The tenant its rows are stored under: the platform's under the ROOT tenant (as the event store). */
  tenantId: string;
  /**
   * A platform-scope finding (an address or an anonymous caller across tenants, or an actor of the ROOT tenant): shown in ROOT only;
   * a tenant's own people, sessions and keys are shown to its admins with `ai_firewall.events.read` (D55-24, FWO-5 open).
   */
  platform: boolean;
  actor: ActorRef;
  lane: SignalLane;
  /** When it was scored, ISO 8601 UTC. */
  at: string;
  risk: RiskScore;
  detections: Detection[];
  /** No own baseline yet: the behaviour deviations read the role prior or are missing. */
  coldStart: boolean;
  /** FWA-6: a device or machine finding: an alert at most, never a human control. */
  alertsOnly: boolean;
  /**
   * The scoring's behaviour.v1 and attack.v1 vectors as the dataset export keeps them (03 §3.5, D55-88): attached by the evaluator only on
   * a staging or demo install; the incident grouping keeps the peak's. Absent on production.
   */
  vectors?: CapturedVectors;
  /**
   * 04.6: what the two tree models said about the same vectors, in shadow (nothing acts on them). Present only for the models that are
   * loaded and apply to the actor (the behaviour model never scores a cold-start actor, 04.8). The incident keeps them beside the rules.
   */
  models?: ModelShadowScores;
}

/** The tree models' names as the shadow records them (04.6). */
export const SHADOW_MODELS = ['behaviour', 'attack'] as const;
export type ShadowModelId = (typeof SHADOW_MODELS)[number];

/**
 * What a model's score means at its own thresholds (04.1 meta `thresholds`, 04.8). Behaviour: `normal` under the suspicion threshold,
 * `suspicious` (stage 1 hands the request to stage 2, nothing else), `step_up` at or above `fprTarget` (the threshold chosen for at most
 * 0.1 % of benign actor-days; one model alone reaches at most a step-up, FWA-13). Attack: `benign` (the benign class is the most likely),
 * `below` (an attack class leads, under `challenge`), `challenge`, `block`, `terminate`. `unrated`: the meta names no thresholds.
 */
export const MODEL_VERDICTS = ['unrated', 'normal', 'suspicious', 'step_up', 'benign', 'below', 'challenge', 'block', 'terminate'] as const;
export type ModelVerdict = (typeof MODEL_VERDICTS)[number];

/** The rung of a verdict: 0 nothing, 1 a step-up or a challenge, 2 a block, 3 the session ended and the device excluded. */
export function verdictRung(verdict: string): number {
  switch (verdict) {
    case 'step_up':
    case 'challenge': return 1;
    case 'block': return 2;
    case 'terminate': return 3;
    default: return 0;
  }
}

/** One tree model's shadow score of one actor (04.6): the shared RiskScore shape plus what it means. */
export interface ModelShadowScore {
  /** `model` is `behaviour` | `attack`, `space` is `margin`, `score` is the probability × 100; contributions only when explained. */
  risk: RiskScore;
  /** Behaviour: P(anomalous). Attack: the probability of the most likely attack class. */
  probability: number;
  verdict: ModelVerdict;
  /** At a rung of step-up or above (`verdictRung >= 1`): what the gate's false-positive rate counts (4.7). */
  flagged: boolean;
  /** Attack only: the most likely attack class and the benign class's probability. */
  attackClass?: string;
  benign?: number;
  /** The first 12 hex characters of the model file's sha256: a new model's scores are never counted as the old one's. */
  sha: string;
}

export type ModelShadowScores = Partial<Record<ShadowModelId, ModelShadowScore>>;

/** Contributions all zero, in the shape of a vector (a catalogue nothing scored on). */
export function zeroContributions(v: Pick<FeatureVector, 'catalogue' | 'hash' | 'names'>): FeatureContributions {
  return { catalogue: v.catalogue, hash: v.hash, names: [...v.names], values: new Array(v.names.length + 1).fill(0) };
}

/**
 * A tree model's TreeSHAP output for one row (`contributions(ensemble, row)[k]` of tree-shap.ts) in the shared shape. Throws a
 * RangeError when the widths disagree (a model of another catalogue version must never be explained with this one's names).
 */
export function treeContributions(v: Pick<FeatureVector, 'catalogue' | 'hash' | 'names'>, phi: ArrayLike<number>): FeatureContributions {
  if (phi.length !== v.names.length + 1) throw new RangeError(`contributions of ${phi.length} values for ${v.names.length} features + bias`);
  return { catalogue: v.catalogue, hash: v.hash, names: [...v.names], values: Array.from(phi) };
}

/** The sum of every value of every catalogue (features and bias): the score for `points`, the raw margin for `margin`. */
export const contributionTotal = (risk: Pick<RiskScore, 'contributions'>): number =>
  risk.contributions.reduce((s, c) => s + c.values.reduce((t, x) => t + x, 0), 0);

/** The largest contributions across catalogues, for an explanation ("because …", 04.10). */
export function topContributions(risk: Pick<RiskScore, 'contributions'>, n = 5): Array<{ catalogue: string; feature: string; value: number }> {
  const all: Array<{ catalogue: string; feature: string; value: number }> = [];
  for (const c of risk.contributions) c.names.forEach((feature, i) => { if (c.values[i] !== 0) all.push({ catalogue: c.catalogue, feature, value: c.values[i]! }); });
  return all.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, n);
}

/** A platform-scope actor kind (keyed in the platform scope, D55-23). */
export const isPlatformActor = (kind: ActorKind): boolean => kind === 'ip' || kind === 'anon';
