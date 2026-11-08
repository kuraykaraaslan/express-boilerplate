import type { ActorKind } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { FeatureVector } from '../features/ai_firewall.feature-vector';
import { DETECTORS, lookupOf, ramp, runDetectors, type DetectorDef, type FeatureLookup } from './ai_firewall.detectors';
import { zeroContributions, type Detection, type FeatureContributions, type RuleScoreResult } from './ai_firewall.risk';

/**
 * Rule scorer v0 (docs/phases/55-ai-firewall/02 §2.2): weighted rules, baseline deviations and the detectors of 2.3 → a risk of 0..100
 * per actor, with per-feature contributions in the shape `tree-shap.ts` produces (`ai_firewall.risk.ts`), so the pages and the
 * responder read the rule floor and, later, the two tree models alike (FWA-2: final risk = max(rule floor, model), 05).
 *
 * Every rule and every detection is one "reason" with a probability-like part p in [0, 1) (its weight × how strongly it holds) and a
 * split over the features that made it. The reasons combine as a noisy-OR, so one strong reason gives its own share and many weak ones
 * cannot sum past 100:
 *
 *     score = 100 × (1 − Π (1 − p_i)) = 100 × (1 − e^(−Λ)),  λ_i = −ln(1 − p_i),  Λ = Σ λ_i
 *
 * and reason i contributes score × λ_i / Λ, spread over its features by their shares: the contributions add up to the score exactly
 * (bias 0; test). Pure; never throws (a reason that fails is left out).
 */

/** A single-feature rule: a weight and the ramp of the feature from nothing (`lo`) to fully there (`hi`). */
export interface RuleDef {
  id: string;
  feature: string;
  lo: number;
  hi: number;
  weight: number;
}

const rule = (feature: string, lo: number, hi: number, weight: number): RuleDef => ({ id: `rule.${feature}`, feature, lo, hi, weight });

/**
 * The weighted rules: the actor against its own baseline (behaviour.v1 deviations, log2 of current over usual: 1 = twice as much),
 * attack indicators and refusals (attack.v1), and the registry-weighted signal mass (rules.v1). Small weights: a single deviation
 * is a hint, not an incident; the detectors carry the patterns.
 */
export const RULES: readonly RuleDef[] = [
  rule('volume_read_1h_vs_usual', 1, 5, 0.06),
  rule('volume_list_1h_vs_usual', 1, 5, 0.08),
  rule('volume_write_1h_vs_usual', 1, 5, 0.08),
  rule('volume_admin_1h_vs_usual', 1, 5, 0.1),
  rule('volume_export_1h_vs_usual', 1, 5, 0.1),
  rule('volume_auth_1h_vs_usual', 1, 5, 0.06),
  rule('volume_total_24h_vs_usual', 1, 4, 0.08),
  rule('distinct_subjects_24h_vs_usual', 1, 4, 0.1),
  rule('distinct_addresses_24h_vs_usual', 1, 3, 0.06),
  rule('export_bytes_24h_vs_usual', 1, 5, 0.1),
  rule('admin_actions_24h_vs_usual', 1, 4, 0.08),
  rule('new_countries_today', 0, 2, 0.08),
  rule('new_asns_today', 0, 2, 0.04),
  rule('new_devices_today', 0, 3, 0.04),
  rule('fingerprint_switches_24h', 0, 3, 0.1),
  rule('unusual_hour', 0.8, 1, 0.03),
  rule('indicator_sql_5m', 0, 5, 0.2),
  rule('indicator_script_5m', 0, 5, 0.2),
  rule('indicator_traversal_5m', 0, 5, 0.2),
  rule('indicator_template_5m', 0, 5, 0.15),
  rule('indicator_command_5m', 0, 5, 0.2),
  rule('csrf_refusals_1h', 0, 10, 0.08),
  rule('odd_methods_5m', 0, 10, 0.05),
  rule('status_429_ratio_5m', 0.1, 0.8, 0.06),
  rule('high_severity_signals_1h', 0, 5, 0.12),
  rule('signal_weight_1h', 0.5, 5, 0.15),
  // D443: a gateway that keeps reporting children the platform refuses. At most one row per reason an hour (three reasons), so 41+ rows
  // a day (two reasons all day: a router claiming direct devices' serials and past its limits) reach the report line alone; one reason
  // all day (a router at its child limit) stays a hint (~14 points) that adds to the device lane's findings.
  rule('gateway_child_refusals_24h', 4, 48, 0.3),
  // D443: a gateway's new children over a day. A router being commissioned reports its whole network at once (up to the 500-child cap), so
  // this stays a hint (at most 10 points; with the signal mass of 500 children in one hour under the report line); with refusals beside it
  // (a flood that ran into the device limit) it reaches the line.
  rule('gateway_children_created_24h', 50, 500, 0.1),
];

/** A part p is capped below 1 so −ln(1 − p) stays finite. */
const P_MAX = 0.99;

interface Reason {
  p: number;
  split: Array<{ feature: string; share: number }>;
  detection?: Omit<Detection, 'points'>;
}

export interface ScoreInput {
  actorKind: ActorKind;
  /** The actor's vectors (behaviour.v1, attack.v1, rules.v1); the contributions come back in this order. */
  vectors: readonly FeatureVector[];
  rules?: readonly RuleDef[];
  detectors?: readonly DetectorDef[];
}

function reasonsOf(input: ScoreInput, f: FeatureLookup): Reason[] {
  const out: Reason[] = [];
  for (const r of input.rules ?? RULES) {
    const p = Math.min(P_MAX, r.weight * ramp(f(r.feature), r.lo, r.hi));
    if (p > 0) out.push({ p, split: [{ feature: r.feature, share: 1 }] });
  }
  for (const hit of runDetectors(input.actorKind, f, input.detectors ?? DETECTORS)) {
    const p = Math.min(P_MAX, hit.weight * hit.strength);
    if (!(p > 0) || hit.evidence.length === 0) continue;
    out.push({
      p,
      split: hit.evidence,
      detection: { detector: hit.detector, strength: hit.strength, reason: `detector.${hit.detector}`, evidence: hit.evidence, alertsOnly: hit.alertsOnly },
    });
  }
  return out;
}

/** The risk of one actor from its vectors, with its contributions and the detections that hold. */
export function scoreActor(input: ScoreInput): RuleScoreResult {
  const f = lookupOf(input.vectors);
  const contributions: FeatureContributions[] = input.vectors.map(zeroContributions);
  const where = new Map<string, { c: number; i: number }>();
  contributions.forEach((c, ci) => c.names.forEach((name, i) => { if (!where.has(name)) where.set(name, { c: ci, i }); }));

  const reasons = reasonsOf(input, f).map((r) => ({ ...r, lambda: -Math.log(1 - r.p) }));
  const lambda = reasons.reduce((s, r) => s + r.lambda, 0);
  const score = lambda > 0 ? 100 * (1 - Math.exp(-lambda)) : 0;
  const detections: Detection[] = [];
  let placed = 0;
  let dropped = 0;
  for (const r of reasons) {
    const points = score * (r.lambda / lambda);
    for (const s of r.split) {
      const at = where.get(s.feature);
      const part = points * s.share;
      if (!at) { dropped += part; continue; }
      const values = contributions[at.c]!.values;
      values[at.i] = (values[at.i] ?? 0) + part;
      placed += part;
    }
    if (r.detection) detections.push({ ...r.detection, points });
  }
  // A reason that names a feature none of the vectors carries cannot be placed; the score keeps only what the contributions explain,
  // so they still add up to it (tests check every rule and detector names a feature of the catalogues).
  const explained = dropped > 0 ? placed : score;
  return { risk: { model: 'rules', score: explained, space: 'points', contributions }, detections };
}
