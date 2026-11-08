/**
 * The request cascade (docs/phases/55-ai-firewall/04-tree-models.md 4.8, owner design FWD-7; actor actions FWD-8).
 *
 *   request ──► LightGBM (behaviour) ──► normal ──► allow
 *                                    └─► suspicious ──► XGBoost (attack) ──► benign ──► allow
 *                                                                        └─► attack ──► challenge / block, and at the top
 *                                                                                       end the session, exclude the device
 *
 * Pure decision logic: the caller passes the lane's policy and two lazy scorers, so XGBoost features are only built for the share
 * that reaches stage 2. The cascade decides what happens to THIS request; actor-level actions (end the session, exclude the device)
 * are returned as proposals that the responder (05) runs through the owning modules under the tenant's mode, budgets and undo:
 * this file never writes a session or a device.
 *
 * Fail open (FWA-7): a scorer that returns null or throws (model refused, over its time budget, store down) and thresholds that do
 * not validate allow the request; the rule floor is applied regardless (FWA-2). `decideCascade` never throws. Shadow: a stage whose
 * model is not promoted records what it would do (`verdict`, `wouldPropose`), enforces nothing and proposes nothing.
 */
import type { Lane, LanePolicy } from '@kuraykaraaslan-labs/common/server/lane.policy';

export type CascadeOutcome = 'allow' | 'challenge' | 'block';
export type ChallengeKind = 'step_up' | 'captcha' | 'delay';
/** Actor-level actions the cascade may propose (registered by their owning modules, run by the responder). */
export type ProposedAction = 'end_session' | 'exclude_device';

export type CascadeThresholds = {
  /** Stage 1: a behaviour probability at or above this is suspicious. Tuned for recall. */
  readonly suspicion: number;
  /** Stage 2: an attack probability at or above this challenges. */
  readonly challenge: number;
  /** Stage 2: at or above this, the request is blocked. Tuned for precision. */
  readonly block: number;
  /** Stage 2: at or above this (with stage 1 suspicious), the session is ended and the device excluded as well. */
  readonly terminate: number;
};

export type AttackScore = { readonly classes: readonly string[]; readonly probabilities: ArrayLike<number> };

export type CascadeInput = {
  readonly lane: Lane;
  readonly policy: LanePolicy;
  /** The actor has no baseline yet (anonymous caller, new address, new account, fresh key): stage 1 has nothing to compare. */
  readonly coldStart: boolean;
  /** This request is in the stage-1 audit sample (see `inAuditSample`). */
  readonly auditSample: boolean;
  /** Stage 1, LightGBM: the behaviour probability, or null when the model is off or over budget. */
  readonly scoreBehaviour: () => number | null;
  /** Stage 2, XGBoost: class probabilities of the actor's OWN row, or null when the model is off or over budget. */
  readonly scoreAttack: () => AttackScore | null;
  /**
   * 4.11, FWA-5 (D55-124): an attack row an outsider can produce in the actor's name, such as the address a signed-in person comes from
   * (every caller behind a shared NAT, CGNAT or office proxy writes it). It counts for a challenge, never for a block or the terminate
   * proposals: those need the actor's own row. Absent: none.
   */
  readonly scoreSharedAttack?: () => AttackScore | null;
  /** Each model acts only after promotion (4.7); before, the cascade runs in shadow. */
  readonly promoted: { readonly behaviour: boolean; readonly attack: boolean };
  readonly thresholds: CascadeThresholds;
  /** What the deterministic rules already decided for this request; the cascade can only add to it. */
  readonly ruleOutcome: CascadeOutcome;
  /** The request carries a signed-in session (a step-up is possible, the session can be ended). */
  readonly hasSession: boolean;
  /** The request names a device the platform can exclude (a known browser or app fingerprint, an IoT device credential). */
  readonly hasDevice: boolean;
  /** A captcha provider is configured (38-security A-5: no provider, no captcha). */
  readonly captchaConfigured: boolean;
  /**
   * 4.11: the actor keeps scoring just under the stage-1 suspicion threshold (`ai_firewall.cascade-hover.ts`). Its request goes to stage 2
   * even when stage 1 calls it normal, and is capped at a challenge there: stage 1 did not turn its key (FWA-13).
   */
  readonly hovering?: boolean;
};

export type CascadeDecision = {
  /** What is done to this request: max(rule floor, the cascade's enforced outcome). */
  readonly enforced: CascadeOutcome;
  /** What the cascade alone concluded, enforced or not (shadow mode, alerts-only lanes). */
  readonly verdict: CascadeOutcome;
  readonly challenge?: ChallengeKind;
  /** Actor actions for the responder; it applies the tenant's mode (Observe / Suggest / Auto) and budgets per action. Empty in shadow. */
  readonly proposedActions: readonly ProposedAction[];
  /** The verdict came from a model that is not promoted yet: recorded, nothing enforced, nothing proposed. */
  readonly shadow: boolean;
  /** In shadow, the actor actions the cascade would have proposed (for the pages and the promotion review only). */
  readonly wouldPropose?: readonly ProposedAction[];
  /** The last stage that ran. */
  readonly stage: 'stage1' | 'stage2' | 'none';
  readonly behaviourScore?: number;
  readonly attackClass?: string;
  readonly attackScore?: number;
  /** Stable codes for the signal and the pages (dictionary keys `ai_firewall.cascade.reason.<code>`). */
  readonly reasons: readonly string[];
  /** The stage-2 result of an audit-sample request that stage 1 called normal (shadow only, never enforced). */
  readonly audit?: { readonly attackClass: string; readonly attackScore: number };
};

const RANK: Record<CascadeOutcome, number> = { allow: 0, challenge: 1, block: 2 };
const maxOutcome = (a: CascadeOutcome, b: CascadeOutcome): CascadeOutcome => (RANK[a] >= RANK[b] ? a : b);

/** The benign class name in the attack model's class list (04 table). */
export const BENIGN_CLASS = 'benign';

/**
 * Lanes on which the cascade challenges and blocks: the human and public lanes, the ones that take part in IP bans
 * (`banParticipation === true` in LANE_POLICY). Machine, cron, webhook and device lanes are never challenged (FWA-6, 38 L-4).
 */
export const laneEnforces = (policy: LanePolicy): boolean => policy.banParticipation === true;

/** Thresholds must be ordered: 0 < suspicion < 1 and 0 < challenge ≤ block ≤ terminate ≤ 1. */
export function validateThresholds(t: CascadeThresholds): void {
  const inUnit = (v: number) => Number.isFinite(v) && v > 0 && v <= 1;
  if (!inUnit(t.suspicion) || t.suspicion >= 1) throw new RangeError('suspicion threshold must be in (0, 1)');
  if (!inUnit(t.challenge) || !inUnit(t.block) || !inUnit(t.terminate)) throw new RangeError('stage-2 thresholds must be in (0, 1]');
  if (!(t.challenge <= t.block && t.block <= t.terminate)) throw new RangeError('thresholds must satisfy challenge <= block <= terminate');
}

/**
 * The probability of the benign class. A one-output attack model (the trainer's one-class variant, `binary:logistic` naming its one attack
 * class) gives P(attack) only, so benign is 1 − P (D55-132); a model with several outputs and no benign class: 0.
 */
export function benignScore(score: AttackScore): number {
  const i = score.classes.indexOf(BENIGN_CLASS);
  if (i < 0) {
    if (score.classes.length !== 1 || score.probabilities.length !== 1) return 0;
    const p = score.probabilities[0];
    return Number.isFinite(p) ? Math.min(1, Math.max(0, 1 - p)) : 0;
  }
  const p = score.probabilities[i];
  return Number.isFinite(p) ? p : 0;
}

/** The leading attack class of a row when it beats benign (04.8: the most likely class is an attack), else null. */
function leadingAttack(score: AttackScore | null): { attackClass: string; attackScore: number } | null {
  if (!score) return null;
  const top = topAttack(score);
  return top && benignScore(score) < top.attackScore ? top : null;
}

/** The most likely attack class (anything but benign) and its probability. */
export function topAttack(score: AttackScore): { attackClass: string; attackScore: number } | null {
  let best: { attackClass: string; attackScore: number } | null = null;
  for (let i = 0; i < score.classes.length; i++) {
    if (score.classes[i] === BENIGN_CLASS) continue;
    const p = score.probabilities[i];
    if (!Number.isFinite(p)) continue;
    if (!best || p > best.attackScore) best = { attackClass: score.classes[i], attackScore: p };
  }
  return best;
}

function challengeKind(input: CascadeInput): ChallengeKind {
  if (input.policy.stepUp && input.hasSession) return 'step_up';
  if (input.policy.captcha && input.captchaConfigured) return 'captcha';
  return 'delay';
}

/**
 * Deterministic audit sampling: the same key (a request id) always lands in or out, so a replay of a request is scored the same way.
 * FNV-1a over the key → [0, 1).
 */
export function inAuditSample(key: string, rate: number): boolean {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000 < rate;
}

/** A scorer's result, or null when it returned nothing usable or threw (FWA-7: a broken scorer allows, it never breaks the request). */
function safely<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function decideCascade(input: CascadeInput): CascadeDecision {
  const { thresholds: t } = input;
  const reasons: string[] = [];
  const finish = (
    d: Omit<CascadeDecision, 'enforced' | 'reasons' | 'shadow'> & { cascadeEnforced: CascadeOutcome; shadow?: boolean },
  ): CascadeDecision => {
    const { cascadeEnforced, shadow = false, ...rest } = d;
    return { ...rest, shadow, enforced: maxOutcome(input.ruleOutcome, cascadeEnforced), reasons };
  };

  try {
    validateThresholds(t);
  } catch {
    reasons.push('thresholds_invalid');
    return finish({ verdict: 'allow', cascadeEnforced: 'allow', proposedActions: [], stage: 'none' });
  }
  const enforces = laneEnforces(input.policy);
  if (!enforces) reasons.push('lane_alerts_only');

  // Stage 1. A cold-start actor has nothing to deviate from, so it goes to stage 2 directly (a first-time attacker would look normal).
  let behaviourScore: number | undefined;
  if (input.coldStart) {
    reasons.push('cold_start');
  } else {
    const b = safely(input.scoreBehaviour);
    if (b === null || !Number.isFinite(b)) {
      reasons.push('behaviour_unavailable');
      return finish({ verdict: 'allow', cascadeEnforced: 'allow', proposedActions: [], stage: 'none' });
    }
    behaviourScore = b;
    if (b < t.suspicion && input.hovering === true) {
      reasons.push('behaviour_hovering');
    } else if (b < t.suspicion) {
      reasons.push('behaviour_normal');
      let audit: CascadeDecision['audit'];
      if (input.auditSample) {
        const a = safely(input.scoreAttack);
        const top = a ? topAttack(a) : null;
        if (top) {
          audit = top;
          reasons.push('audit_sample');
        }
      }
      return finish({ verdict: 'allow', cascadeEnforced: 'allow', proposedActions: [], stage: 'stage1', behaviourScore, audit });
    } else {
      reasons.push('behaviour_suspicious');
    }
  }

  // Stage 2: the actor's own row, and a row an outsider can shape in its name (D55-124), which can challenge and never block.
  const a = safely(input.scoreAttack);
  const shared = input.scoreSharedAttack ? safely(input.scoreSharedAttack) : null;
  const ownTop = a ? topAttack(a) : null;
  const sharedTop = shared ? topAttack(shared) : null;
  if (!ownTop && !sharedTop) {
    reasons.push('attack_unavailable');
    return finish({ verdict: 'allow', cascadeEnforced: 'allow', proposedActions: [], stage: 'stage2', behaviourScore });
  }
  const own = leadingAttack(a);
  const outside = leadingAttack(shared);

  // Benign → allow (04.8): when the most likely class of every row is benign, no attack threshold applies.
  if (!own && !outside) {
    const shown = (ownTop ?? sharedTop)!;
    reasons.push('attack_model_benign');
    return finish({
      verdict: 'allow', cascadeEnforced: 'allow', proposedActions: [], stage: 'stage2', behaviourScore,
      attackClass: shown.attackClass, attackScore: shown.attackScore,
    });
  }
  // The stronger leading row decides a challenge; only the actor's own row can turn the block key.
  const strongest = !own ? outside! : !outside || own.attackScore >= outside.attackScore ? own : outside;

  // Two keys (FWA-13): a block needs both stages. A cold-start actor has only stage 2, so the cascade challenges it at most;
  // repeated challenges become signals the responder escalates (an IP ban on the public lane, for example).
  const hoveredOnly = !input.coldStart && behaviourScore !== undefined && behaviourScore < t.suspicion;
  const twoKeys = !input.coldStart && !hoveredOnly;
  let verdict: CascadeOutcome = 'allow';
  if (own && own.attackScore >= t.block && twoKeys) verdict = 'block';
  else if (strongest.attackScore >= t.challenge) verdict = 'challenge';
  if (verdict !== 'block' && strongest.attackScore >= t.block) {
    reasons.push(!twoKeys ? (hoveredOnly ? 'block_capped_hovering' : 'block_capped_cold_start') : 'block_capped_shared');
  }
  const reported = verdict === 'block' ? own! : strongest;
  if (reported === outside && reported !== own) reasons.push('attack_shared_row');
  const { attackClass, attackScore } = reported;
  reasons.push(verdict === 'allow' ? 'attack_below_threshold' : `attack_${verdict}`);

  // Actor actions at the top of the scale, both keys turned: end the session, exclude the device. Proposed on every lane (a device
  // lane's device can be excluded); the responder applies the tenant's mode per action and lane, IoT devices default to Suggest.
  const actions: ProposedAction[] = [];
  if (twoKeys && own && own.attackScore >= t.terminate) {
    if (input.hasSession) actions.push('end_session');
    if (input.hasDevice) actions.push('exclude_device');
  }

  // Shadow and lane gating: the cascade enforces and proposes only with the models its verdict used promoted, and enforces only on
  // enforcing lanes.
  const modelsPromoted = input.promoted.attack && (input.coldStart || input.promoted.behaviour);
  if (!modelsPromoted) reasons.push('shadow');
  else if (actions.length > 0) reasons.push('actor_actions_proposed');
  const cascadeEnforced: CascadeOutcome = enforces && modelsPromoted ? verdict : 'allow';
  const challenge = cascadeEnforced === 'challenge' ? challengeKind(input) : undefined;

  return finish({
    verdict,
    cascadeEnforced,
    challenge,
    proposedActions: modelsPromoted ? actions : [],
    wouldPropose: modelsPromoted || actions.length === 0 ? undefined : actions,
    shadow: !modelsPromoted,
    stage: 'stage2',
    behaviourScore,
    attackClass,
    attackScore,
  });
}
