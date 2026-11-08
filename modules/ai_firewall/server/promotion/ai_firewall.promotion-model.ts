/**
 * The automatic promotion gate (docs/phases/55-ai-firewall/04-tree-models.md 4.7; owner decision FWD-12: no human promotion step). Pure:
 * what the gate decides from a model, its stored state, what shadow saw and the drift report; the job (ai_firewall.promotion.job.ts)
 * gathers the inputs and writes the result, the route (ai-firewall-models.route.ts) applies an owner's hold.
 *
 * A model is PROMOTED when every criterion holds (`pass` or `not_applicable`), and DEMOTED back to shadow, automatically too, when a later
 * evaluation fails any of them. The criteria, each alone enough to keep a model in shadow:
 *
 *   loaded                       the shipped model loaded: sha256 verified against its meta, parsed under the evaluator's constraints;
 *   not_synthetic                not trained on the synthetic dataset (04.1);
 *   trained_by_pipeline          its meta carries the trainer's record (thresholds, their targets, the independence check);
 *   thresholds_met               every threshold met its target on the calibration slice (D55-105);
 *   independence_ok              the error-correlation report is `ok` (the flag off, 04.4), against a bound no looser than
 *                                INDEPENDENCE_BOUND_MAX (D55-131), and measured on THIS pair: the model and the loaded other stage
 *                                name each other's sha256 (D55-130);
 *   parity_green                 the trainer's parity check against the vendored library passed on this very file (`training.parity`,
 *                                the loader's sha256 ties the file to it, D55-108);
 *   shadow_period                at least SHADOW_MIN_DAYS in shadow on this install (since this model file was first seen);
 *   evidence_complete            every tenant and the shadow counts could be read for this evaluation (an unread tenant could hide a
 *                                confirmed false positive, D55-109);
 *   false_positive_rate          the flagged actor-days nobody confirmed as an attack, over the active actor-days of the window, at most
 *                                FP_RATE_MAX (0.1 %), on at least MIN_ACTIVE_ACTOR_DAYS (D55-107);
 *   precision                    behaviour: of the flagged incidents a person gave a verdict, at least PRECISION_MIN true positives (with
 *                                at least MIN_LABELLED verdicts; fewer: not applicable);
 *   class_metrics                attack: per attack class with at least MIN_CLASS_LABELS synthetic (probe) labels, precision at least
 *                                CLASS_PRECISION_MIN and recall at least CLASS_RECALL_MIN (no synthetic label: not applicable);
 *   benign_false_positives       attack: of the benign-traffic labels, at most FP_RATE_MAX flagged (none: not applicable);
 *   no_confirmed_false_positive  no incident the model flagged at a rung of step-up or above was called a false positive by a person;
 *   drift_quiet                  the latest weekly drift check is `quiet` (4.9);
 *   not_held                     no ROOT owner holds the model in shadow (the override never promotes).
 *
 * The window is the last EVIDENCE_WINDOW_DAYS (D55-107), whatever the model's state, so a confirmed false positive keeps a model in shadow
 * for up to four weeks and a promoted model keeps being checked on the same terms.
 */
import type { ModelLoadResult } from '../models/shipped-models';
import { independencePaired, promotionRefusals } from '../models/shipped-models.meta';
import type { ShadowModelId } from '../detect/ai_firewall.risk';
import type { DriftReport } from './ai_firewall.drift';

export const SHADOW_MIN_DAYS = 14;
export const EVIDENCE_WINDOW_DAYS = 28;
export const FP_RATE_MAX = 0.001;
/** With no false positive in 3 000 actor-days the rate's 95 % upper bound is 0.1 % (the rule of three): fewer cannot show the target. */
export const MIN_ACTIVE_ACTOR_DAYS = 3_000;
export const PRECISION_MIN = 0.5;
export const MIN_LABELLED = 10;
export const MIN_CLASS_LABELS = 20;
export const CLASS_PRECISION_MIN = 0.9;
export const CLASS_RECALL_MIN = 0.8;
/** Each library's parity tolerance (D55-2), the one the trainer checked the model file at. */
export const PARITY_TOLERANCE_MAX: Readonly<Record<'lightgbm' | 'xgboost', number>> = { lightgbm: 1e-9, xgboost: 1e-5 };

const DAY_MS = 86_400_000;
/**
 * A promotion stands only while the gate keeps re-checking it (FWD-12, D55-128): a stored `promoted` whose last evaluation is older than
 * this (the daily run missed a day and a half: leader or queue down, a job that keeps failing) counts as shadow for the cascade, and ROOT's
 * alert sweep raises `model.<name>.gate_not_run`.
 */
export const PROMOTION_FRESH_MS = 36 * 60 * 60 * 1000;

export const GATE_CRITERIA = [
  'loaded', 'not_synthetic', 'trained_by_pipeline', 'thresholds_met', 'independence_ok', 'parity_green', 'shadow_period',
  'evidence_complete', 'false_positive_rate', 'precision', 'class_metrics', 'benign_false_positives', 'no_confirmed_false_positive',
  'drift_quiet', 'not_held',
] as const;
export type GateCriterionId = (typeof GATE_CRITERIA)[number];
export type CriterionStatus = 'pass' | 'fail' | 'not_applicable' | 'insufficient';

export interface GateCriterion {
  id: GateCriterionId;
  status: CriterionStatus;
  /** What was measured, and the target it was held to (numbers only). */
  value?: number | null;
  target?: number | null;
  /** Per attack class (class_metrics): its labels, precision and recall. */
  classes?: Record<string, { labels: number; precision: number | null; recall: number | null; status: CriterionStatus }>;
}

/** What shadow saw in the window, over every tenant of the install (ai_firewall.promotion-evidence.ts). Counts only. */
export interface ShadowEvidence {
  /** Every tenant and the shadow counts were read; false when any was not. */
  complete: boolean;
  windowDays: number;
  /** Σ over the window's days of the actors the model scored, and of those it flagged (HyperLogLog counts). */
  activeActorDays: number;
  flaggedActorDays: number;
  /** Flagged actor-days of incidents a source confirmed as an attack (a person's true positive, a decoy touch, a probe, a confirmed ban). */
  confirmedActorDays: number;
  /** Flagged incidents a person gave a verdict. */
  labelled: { truePositive: number; falsePositive: number };
  /** Flagged incidents (a rung of step-up or above) a person called a false positive. */
  confirmedFalsePositives: number;
  /** Attack only: per attack class, the synthetic labels and how the model scored their kept vectors. */
  classes: Record<string, { labels: number; detected: number; predicted: number }>;
  /** Attack only: the benign-traffic labels scored, and those the model flagged. */
  benign: { labels: number; flagged: number };
}

export interface GateVerdict {
  model: ShadowModelId;
  /** The model file's sha256, or null when none is loaded. */
  sha256: string | null;
  at: string;
  passed: boolean;
  failing: GateCriterionId[];
  criteria: GateCriterion[];
  /** The derived numbers the page shows beside the criteria. */
  metrics: {
    shadowDays: number | null;
    falsePositiveRate: number | null;
    precision: number | null;
    benignFalsePositiveRate: number | null;
    activeActorDays: number;
    flaggedActorDays: number;
    confirmedActorDays: number;
  };
}

/** The stored state of one model (ai_firewall_model_states, one row per model under ROOT). Times as ISO strings. */
export interface ModelStateRecord {
  model: ShadowModelId;
  modelSha256: string | null;
  state: 'shadow' | 'promoted';
  shadowStartedAt: string | null;
  promotedAt: string | null;
  demotedAt: string | null;
  /** The failing criteria of the demotion (or `model_changed`, `model_unloaded`, `held`), comma separated. */
  demotedReason: string | null;
  /** A ROOT owner holds the model in shadow since then (the override); null when not held. */
  heldAt: string | null;
  lastEvaluatedAt: string | null;
  verdict: GateVerdict | null;
  drift: StoredDrift | null;
}

/** The drift reference (the model's first week with enough scorings) and the latest report, kept in the state row. */
export interface StoredDrift {
  sha256: string;
  reference: { week: string; n: number; score: number[]; features: number[][] } | null;
  report: DriftReport | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** The trainer's parity record on the meta (04.1: written only when the check passed), held to the library's tolerance. */
export function parityGreen(meta: { library: 'lightgbm' | 'xgboost'; training?: Readonly<Record<string, unknown>> }): boolean {
  const p = meta.training?.parity;
  if (!isRecord(p)) return false;
  const rows = p.rows;
  const tolerance = p.tolerance;
  return typeof rows === 'number' && Number.isInteger(rows) && rows > 0
    && typeof tolerance === 'number' && tolerance > 0 && tolerance <= PARITY_TOLERANCE_MAX[meta.library];
}

export interface GateInput {
  model: ShadowModelId;
  load: ModelLoadResult;
  /** The other stage's model as this process loaded it (independence is the pair's, D55-130); absent or not loaded: not independent. */
  peer?: ModelLoadResult | null;
  state: ModelStateRecord | null;
  /** null: it could not be gathered (counts as incomplete). */
  evidence: ShadowEvidence | null;
  drift: DriftReport | null;
  nowMs: number;
}

const c = (id: GateCriterionId, status: CriterionStatus, value?: number | null, target?: number | null): GateCriterion =>
  ({ id, status, ...(value !== undefined ? { value } : {}), ...(target !== undefined ? { target } : {}) });
const passIf = (ok: boolean): CriterionStatus => (ok ? 'pass' : 'fail');

/** The gate's verdict on one model (pure). */
export function evaluateGate(input: GateInput): GateVerdict {
  const { model, load, peer, state, evidence: ev, drift, nowMs } = input;
  const sha256 = load.ok ? load.meta.sha256.toLowerCase() : null;
  const criteria: GateCriterion[] = [];
  criteria.push(c('loaded', passIf(load.ok)));

  const refusals = load.ok ? promotionRefusals(load.meta) : ['invalid_meta'];
  const metaOk = load.ok && !refusals.includes('invalid_meta');
  criteria.push(c('not_synthetic', passIf(metaOk && !refusals.includes('synthetic'))));
  criteria.push(c('trained_by_pipeline', passIf(metaOk && !refusals.includes('not_trained_by_pipeline'))));
  criteria.push(c('thresholds_met', passIf(metaOk && !refusals.includes('not_trained_by_pipeline') && !refusals.includes('thresholds_unmet'))));
  const paired = load.ok && !!peer && peer.ok && independencePaired(load.meta, peer.meta);
  criteria.push(c('independence_ok', passIf(metaOk && !refusals.includes('not_trained_by_pipeline') && !refusals.includes('independence_not_ok') && paired)));
  criteria.push(c('parity_green', passIf(load.ok && parityGreen(load.meta))));

  // The shadow period counts only for the model file the state row names (a new file starts again).
  const started = state && sha256 && state.modelSha256 === sha256 && state.shadowStartedAt ? Date.parse(state.shadowStartedAt) : Number.NaN;
  const shadowDays = Number.isFinite(started) ? (nowMs - started) / DAY_MS : null;
  criteria.push(c('shadow_period', passIf(shadowDays !== null && shadowDays >= SHADOW_MIN_DAYS), shadowDays === null ? null : Math.floor(shadowDays * 10) / 10, SHADOW_MIN_DAYS));

  criteria.push(c('evidence_complete', passIf(ev !== null && ev.complete)));

  const unconfirmed = ev ? Math.max(0, ev.flaggedActorDays - ev.confirmedActorDays) : 0;
  const fpRate = ev ? ratio(unconfirmed, ev.activeActorDays) : null;
  criteria.push(c(
    'false_positive_rate',
    !ev || ev.activeActorDays < MIN_ACTIVE_ACTOR_DAYS ? 'insufficient' : passIf(fpRate !== null && fpRate <= FP_RATE_MAX),
    fpRate, FP_RATE_MAX,
  ));

  let precision: number | null = null;
  if (model === 'behaviour') {
    const n = ev ? ev.labelled.truePositive + ev.labelled.falsePositive : 0;
    precision = ev ? ratio(ev.labelled.truePositive, n) : null;
    criteria.push(c('precision', n < MIN_LABELLED ? 'not_applicable' : passIf(precision !== null && precision >= PRECISION_MIN), precision, PRECISION_MIN));
    criteria.push(c('class_metrics', 'not_applicable'));
    criteria.push(c('benign_false_positives', 'not_applicable'));
  } else {
    criteria.push(c('precision', 'not_applicable'));
    const classes: NonNullable<GateCriterion['classes']> = {};
    let any = false;
    let failed = false;
    for (const [cls, x] of Object.entries(ev?.classes ?? {})) {
      const p = ratio(x.detected, x.predicted);
      const r = ratio(x.detected, x.labels);
      let status: CriterionStatus = 'not_applicable';
      if (x.labels >= MIN_CLASS_LABELS) {
        any = true;
        status = passIf(p !== null && p >= CLASS_PRECISION_MIN && r !== null && r >= CLASS_RECALL_MIN);
        if (status === 'fail') failed = true;
      }
      classes[cls] = { labels: x.labels, precision: p, recall: r, status };
    }
    criteria.push({ id: 'class_metrics', status: !any ? 'not_applicable' : passIf(!failed), classes, target: CLASS_PRECISION_MIN });
    const benignRate = ev ? ratio(ev.benign.flagged, ev.benign.labels) : null;
    criteria.push(c('benign_false_positives', !ev || ev.benign.labels === 0 ? 'not_applicable' : passIf(benignRate !== null && benignRate <= FP_RATE_MAX), benignRate, FP_RATE_MAX));
  }

  criteria.push(c('no_confirmed_false_positive', ev ? passIf(ev.confirmedFalsePositives === 0) : 'insufficient', ev?.confirmedFalsePositives ?? null, 0));
  criteria.push(c('drift_quiet', passIf(drift?.status === 'quiet'), drift?.scorePsi ?? null, drift?.bound ?? null));
  criteria.push(c('not_held', passIf(!state?.heldAt)));

  const failing = criteria.filter((x) => x.status === 'fail' || x.status === 'insufficient').map((x) => x.id);
  const benignFalsePositiveRate = model === 'attack' && ev ? ratio(ev.benign.flagged, ev.benign.labels) : null;
  return {
    model,
    sha256,
    at: new Date(nowMs).toISOString(),
    passed: failing.length === 0,
    failing,
    criteria,
    metrics: {
      shadowDays: shadowDays === null ? null : Math.floor(shadowDays * 10) / 10,
      falsePositiveRate: fpRate,
      precision,
      benignFalsePositiveRate,
      activeActorDays: ev?.activeActorDays ?? 0,
      flaggedActorDays: ev?.flaggedActorDays ?? 0,
      confirmedActorDays: ev?.confirmedActorDays ?? 0,
    },
  };
}

export type StateChange = 'promoted' | 'demoted' | 'reset' | 'none';

export interface Transition {
  record: ModelStateRecord;
  change: StateChange;
  /** Why it was demoted (or reset): the failing criteria, `model_changed` or `model_unloaded`. */
  reason: string | null;
}

/** A fresh state for a model file seen now (shadow from now; nothing loaded: no shadow start). */
export function freshState(model: ShadowModelId, sha256: string | null, nowIso: string, heldAt: string | null = null): ModelStateRecord {
  return {
    model, modelSha256: sha256, state: 'shadow', shadowStartedAt: sha256 ? nowIso : null, promotedAt: null, demotedAt: null,
    demotedReason: null, heldAt, lastEvaluatedAt: null, verdict: null, drift: null,
  };
}

/**
 * The state after an evaluation (pure). A new model file (or none) starts a new shadow period and demotes a promoted one (`model_changed`,
 * `model_unloaded`); the owner's hold stays whatever the file. Otherwise a passing shadow model is promoted and a failing promoted model is
 * demoted with the failing criteria as its reason; the shadow period is not restarted by a demotion (the evidence window does the waiting).
 */
export function nextState(prev: ModelStateRecord | null, verdict: GateVerdict, drift: StoredDrift | null, nowMs: number): Transition {
  const nowIso = new Date(nowMs).toISOString();
  const sha = verdict.sha256;
  const stamp = (r: ModelStateRecord): ModelStateRecord => ({ ...r, lastEvaluatedAt: nowIso, verdict, drift });
  if (!prev || prev.modelSha256 !== sha) {
    const fresh = freshState(verdict.model, sha, nowIso, prev?.heldAt ?? null);
    if (prev?.state === 'promoted') {
      const reason = sha ? 'model_changed' : 'model_unloaded';
      return { record: stamp({ ...fresh, demotedAt: nowIso, demotedReason: reason, promotedAt: prev.promotedAt }), change: 'demoted', reason };
    }
    return { record: stamp({ ...fresh, demotedAt: prev?.demotedAt ?? null, demotedReason: prev?.demotedReason ?? null, promotedAt: prev?.promotedAt ?? null }), change: prev ? 'reset' : 'none', reason: prev ? (sha ? 'model_changed' : 'model_unloaded') : null };
  }
  if (prev.state === 'shadow' && verdict.passed) {
    return { record: stamp({ ...prev, state: 'promoted', promotedAt: nowIso }), change: 'promoted', reason: null };
  }
  if (prev.state === 'promoted' && !verdict.passed) {
    const reason = verdict.failing.join(',').slice(0, 256);
    return { record: stamp({ ...prev, state: 'shadow', demotedAt: nowIso, demotedReason: reason }), change: 'demoted', reason };
  }
  return { record: stamp(prev), change: 'none', reason: null };
}

/** A ROOT owner's hold (pure): the model goes back to shadow at once and stays there until released. Never promotes. */
export function holdState(prev: ModelStateRecord | null, model: ShadowModelId, sha256: string | null, nowMs: number): Transition {
  const nowIso = new Date(nowMs).toISOString();
  const base = prev ?? freshState(model, sha256, nowIso);
  if (base.heldAt) return { record: base, change: 'none', reason: null };
  if (base.state === 'promoted') {
    return { record: { ...base, state: 'shadow', heldAt: nowIso, demotedAt: nowIso, demotedReason: 'held' }, change: 'demoted', reason: 'held' };
  }
  return { record: { ...base, heldAt: nowIso }, change: 'none', reason: 'held' };
}

/** Releasing the hold (pure): only the hold goes; the next evaluation decides, so a release never promotes by itself. */
export function releaseState(prev: ModelStateRecord | null): Transition | null {
  if (!prev || !prev.heldAt) return null;
  return { record: { ...prev, heldAt: null }, change: 'none', reason: null };
}

/** Whether the gate evaluated the model within PROMOTION_FRESH_MS of `nowMs` (pure). */
export function gateRanLately(state: ModelStateRecord | null | undefined, nowMs: number): boolean {
  const at = state?.lastEvaluatedAt ? Date.parse(state.lastEvaluatedAt) : Number.NaN;
  return Number.isFinite(at) && nowMs - at <= PROMOTION_FRESH_MS;
}

/**
 * Whether the request cascade may treat a stage as promoted (pure): the stored state is `promoted`, names the model file this process
 * loaded (a process of another release with another file is not promoted), is not held, and the gate re-checked it lately (D55-128: a
 * gate that cannot run demotes to shadow on its own, as one that fails does).
 */
export function stagePromoted(state: ModelStateRecord | null | undefined, load: ModelLoadResult, nowMs: number): boolean {
  return !!state && load.ok && state.state === 'promoted' && !state.heldAt && state.modelSha256 === load.meta.sha256.toLowerCase()
    && gateRanLately(state, nowMs);
}

/**
 * Both stages as the cascade may enforce them (pure): each promoted (`stagePromoted`) and the two loaded files the pair their independence
 * was measured on (D55-130). Either alone promoted still reports per stage; enforcement needs both (FWD-12).
 */
export function promotedStages(
  states: ReadonlyMap<ShadowModelId, ModelStateRecord> | null | undefined,
  loads: Readonly<Record<ShadowModelId, ModelLoadResult>>,
  nowMs: number,
): { behaviour: boolean; attack: boolean } {
  if (!states) return { behaviour: false, attack: false };
  const b = loads.behaviour;
  const a = loads.attack;
  const paired = b.ok && a.ok && independencePaired(b.meta, a.meta);
  return {
    behaviour: paired && stagePromoted(states.get('behaviour'), b, nowMs),
    attack: paired && stagePromoted(states.get('attack'), a, nowMs),
  };
}
