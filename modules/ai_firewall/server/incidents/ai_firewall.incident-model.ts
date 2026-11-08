import type { IncidentStatus } from '../store/ai_firewall.store';
import {
  DETECTOR_IDS, SHADOW_MODELS, topContributions, verdictRung, type DetectorId, type RiskScore, type ScoredDetection, type ScoreSpace, type ShadowModelId,
} from '../detect/ai_firewall.risk';

/**
 * Incidents (docs/phases/55-ai-firewall/02 §2.4, §2.7): how scored detections of one actor become one case, what a person may do with
 * it, and which incidents enter the alert pipeline. PURE: no I/O, no clock of its own (the caller passes `nowMs`), no raw id beyond the
 * actor the incident is about. The store (`ai_firewall.incident-store.ts`) runs these rules inside one tenant transaction; the alert
 * source (`ai_firewall.alert-source.ts`) and the pages read the same shapes.
 *
 * Grouping (D55-36): one actor (tenant, actor kind, actor id) has at most ONE active incident (open or acknowledged; a partial unique
 * index holds it across worker processes). A scored detection joins the actor's active incident while that one is live: its last
 * scoring is at most INCIDENT_QUIET_MS ago and it opened at most INCIDENT_MAX_SPAN_MS ago. Otherwise the active one is closed as
 * `expired` and a new one opens. The time window of an incident is therefore "while the actor keeps being flagged, at most 7 days".
 *
 * Observe (2.7): nothing here acts, proposes an action or reaches the responder; an incident is scored, grouped, shown and, over
 * ALERT_MIN_SCORE, listed to the alert pipeline.
 */

/** An incident with no scoring for this long is over: the next detection opens a new one; the nightly run closes it as expired. */
export const INCIDENT_QUIET_HOURS = 24;
export const INCIDENT_QUIET_MS = INCIDENT_QUIET_HOURS * 60 * 60 * 1000;
/** An incident never spans more than this: a constantly flagged actor gets a new incident a week (a bounded history, a fresh review). */
export const INCIDENT_MAX_SPAN_DAYS = 7;
export const INCIDENT_MAX_SPAN_MS = INCIDENT_MAX_SPAN_DAYS * 24 * 60 * 60 * 1000;
/** Scorings kept in an incident's history: the first and the newest (HISTORY_MAX - 1). */
export const HISTORY_MAX = 50;
/** Contributions kept in the peak's explanation, and per history entry. */
export const EXPLANATION_MAX = 8;
export const HISTORY_TOP_MAX = 3;
/** An open incident whose peak reaches this enters the alert pipeline (observability:alert-source, the seeded Security route). */
export const ALERT_MIN_SCORE = 60;
/** At most this many incidents are listed per tenant and sync (the pipeline caps a provider at 200). */
export const ALERT_MAX_SPECS = 50;

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** `erased`: the person the incident was about was erased (privacy:erasure closes their active incident). */
export const CLOSE_REASONS = ['resolved', 'false_positive', 'expired', 'erased'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
/** What a person may close with (`expired` is the grouping's own). */
export const MANUAL_CLOSE_REASONS = ['resolved', 'false_positive'] as const;
export type ManualCloseReason = (typeof MANUAL_CLOSE_REASONS)[number];

/** The reason code of an incident no detector opened: many weak reasons together (dictionary `ai_firewall.reason.score_rules`). */
export const SCORE_REASON = 'score.rules';

/** The severity of a score (0..100). */
export function severityOfScore(score: number): IncidentSeverity {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

const SEVERITY_RANK: Readonly<Record<string, number>> = { low: 0, medium: 1, high: 2, critical: 3 };
export const severityRank = (severity: string): number => SEVERITY_RANK[severity] ?? 0;

/* ─────────────────────────────── Shapes ─────────────────────────────── */

export interface DetectorSummary {
  /** Scorings in which the detector held. */
  count: number;
  maxStrength: number;
  lastAt: string;
}
export type DetectionSummaries = Partial<Record<DetectorId, DetectorSummary>>;

export interface ExplanationItem {
  catalogue: string;
  feature: string;
  /** The feature's contribution: risk points for the rules (`points`), a margin share for a tree model (`margin`). */
  value: number;
}

export interface ExplanationDetection {
  detector: DetectorId;
  strength: number;
  points: number;
  evidence: Array<{ feature: string; share: number }>;
}

/** The peak scoring, explained: the top contributions and the detections with their evidence. Names and numbers only. */
export interface IncidentExplanation {
  model: string;
  space: ScoreSpace;
  score: number;
  at: string;
  items: ExplanationItem[];
  detections: ExplanationDetection[];
}

export interface HistoryEntry {
  at: string;
  score: number;
  detectors: Array<{ id: DetectorId; strength: number }>;
  top: Array<{ feature: string; value: number }>;
  /**
   * 04.6: the tree models' scores of the same scoring in shadow (0..100), when they scored it. 4.10: with each model's largest raising
   * contributions (feature names and margins, at most HISTORY_MODEL_TOP_MAX), which the timeline turns into sentences labelled by model.
   */
  models?: {
    behaviour?: number;
    attack?: number;
    attackClass?: string;
    behaviourTop?: Array<{ feature: string; value: number }>;
    attackTop?: Array<{ feature: string; value: number }>;
  };
}

/** 4.10: raising contributions kept per model and history entry (the timeline's sentences). */
export const HISTORY_MODEL_TOP_MAX = 3;

/** A model's largest contributions that RAISED its score (a sentence says why it flagged, not what spoke against it). Pure. */
export function raisingContributions(risk: Pick<RiskScore, 'contributions'>, n: number = HISTORY_MODEL_TOP_MAX): Array<{ feature: string; value: number }> {
  return topContributions(risk, 64).filter((c) => c.value > 0).slice(0, n).map((c) => ({ feature: c.feature, value: round(c.value) }));
}

/** One point of a model's track: its score (0..100), what it meant and, for the attack model, the leading class. */
export interface ModelTrackPoint {
  at: string;
  score: number;
  verdict: string;
  attackClass?: string;
}

/**
 * What one tree model said about the incident's actor in shadow (04.6), kept with the incident (`models`, migration 008): its latest and
 * its peak scoring (the peak with its top contributions), the UTC days it flagged the actor (a rung of step-up or above; the promotion
 * gate's false-positive counts read them, 4.7), the highest rung it reached, and the model file (short sha) the track belongs to: a new
 * model starts a new track. Names and numbers only.
 */
export interface ModelTrack {
  sha: string;
  scorings: number;
  latest: ModelTrackPoint;
  peak: ModelTrackPoint & { items: ExplanationItem[] };
  flaggedDays: string[];
  maxRung: number;
}
export type IncidentModels = Partial<Record<ShadowModelId, ModelTrack>>;

/** Flagged days kept per track: an incident spans at most 7 days (8 calendar days). */
export const MODEL_TRACK_DAYS_MAX = INCIDENT_MAX_SPAN_DAYS + 1;
/**
 * A scoring without a detection and with a rule score under this (the evaluator's REPORT_MIN_SCORE) is handed on only because a model
 * flagged it in shadow; its reason names the model (`model.attack`, `model.behaviour`), not "many weak signs".
 */
export const MODEL_ONLY_RULE_SCORE = 25;

/** An incident as the grouping reads and writes it (ISO strings for times). */
export interface IncidentRecord {
  incidentId: string;
  tenantId: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  actorKind: string;
  actorId: string;
  lane: string;
  score: number | null;
  peakScore: number | null;
  peakAt: string | null;
  reason: string | null;
  openedAt: string;
  lastSignalAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  platform: boolean;
  alertsOnly: boolean;
  coldStart: boolean;
  scorings: number;
  detections: DetectionSummaries;
  explanation: IncidentExplanation | null;
  history: HistoryEntry[];
  /** 04.6: the tree models' tracks in shadow (migration 008); null before any model scored the actor. */
  models?: IncidentModels | null;
}

/** The columns a scoring writes (an INSERT's values, or an UPDATE's SET). */
export interface IncidentWrite {
  status: IncidentStatus;
  severity: IncidentSeverity;
  lane: string;
  score: number;
  peakScore: number;
  peakAt: string;
  reason: string;
  openedAt: string;
  lastSignalAt: string;
  platform: boolean;
  alertsOnly: boolean;
  coldStart: boolean;
  scorings: number;
  detections: DetectionSummaries;
  explanation: IncidentExplanation;
  history: HistoryEntry[];
}

/* ─────────────────────────────── Grouping ─────────────────────────────── */

const round = (x: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};
const ms = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN);
const isoMax = (a: string, b: string): string => (ms(b) > ms(a) ? b : a);

/** The reason codes of a scoring only a tree model flagged in shadow (04.6). */
export const MODEL_REASONS = { attack: 'model.attack', behaviour: 'model.behaviour' } as const;

/**
 * The reason of a scoring: the detection with the most points (`detector.<id>`); else, when only a tree model flagged it in shadow (rule
 * score under MODEL_ONLY_RULE_SCORE), that model (`model.attack` first: it names a kind of attack); else the score of many weak reasons.
 */
export function reasonOf(d: Pick<ScoredDetection, 'detections'> & Partial<Pick<ScoredDetection, 'risk' | 'models'>>): string {
  let best: ScoredDetection['detections'][number] | null = null;
  for (const x of d.detections) if (!best || x.points > best.points) best = x;
  if (best) return best.reason;
  if (d.models && (d.risk?.score ?? 0) < MODEL_ONLY_RULE_SCORE) {
    if (d.models.attack?.flagged) return MODEL_REASONS.attack;
    if (d.models.behaviour?.flagged) return MODEL_REASONS.behaviour;
  }
  return SCORE_REASON;
}

/** The detector of a reason code, or null (`score.rules`, an unknown code). */
export function detectorOfReason(reason: string | null): DetectorId | null {
  if (!reason || !reason.startsWith('detector.')) return null;
  const id = reason.slice('detector.'.length);
  return (DETECTOR_IDS as readonly string[]).includes(id) ? (id as DetectorId) : null;
}

/** The scoring explained: its top contributions and its detections (rounded; the evidence by share). */
export function explanationOf(d: Pick<ScoredDetection, 'risk' | 'detections' | 'at'>): IncidentExplanation {
  return {
    model: d.risk.model,
    space: d.risk.space,
    score: round(d.risk.score, 1),
    at: d.at,
    items: topContributions(d.risk, EXPLANATION_MAX).map((c) => ({ catalogue: c.catalogue, feature: c.feature, value: round(c.value) })),
    detections: d.detections.map((x) => ({
      detector: x.detector,
      strength: round(x.strength),
      points: round(x.points, 1),
      evidence: [...x.evidence].sort((a, b) => b.share - a.share).map((e) => ({ feature: e.feature, share: round(e.share) })),
    })),
  };
}

export function historyEntryOf(d: Pick<ScoredDetection, 'risk' | 'detections' | 'at'> & Partial<Pick<ScoredDetection, 'models'>>): HistoryEntry {
  const entry: HistoryEntry = {
    at: d.at,
    score: round(d.risk.score, 1),
    detectors: d.detections.map((x) => ({ id: x.detector, strength: round(x.strength) })),
    top: topContributions(d.risk, HISTORY_TOP_MAX).map((c) => ({ feature: c.feature, value: round(c.value) })),
  };
  const b = d.models?.behaviour;
  const a = d.models?.attack;
  if (b || a) {
    const bTop = b ? raisingContributions(b.risk) : [];
    const aTop = a ? raisingContributions(a.risk) : [];
    entry.models = {
      ...(b ? { behaviour: round(b.risk.score, 1) } : {}),
      ...(a ? { attack: round(a.risk.score, 1), ...(a.attackClass ? { attackClass: a.attackClass } : {}) } : {}),
      ...(bTop.length ? { behaviourTop: bTop } : {}),
      ...(aTop.length ? { attackTop: aTop } : {}),
    };
  }
  return entry;
}

/**
 * The incident's model tracks with one more scoring (pure): per model that scored it, the latest point, the peak (a higher score moves it,
 * with the scoring's top contributions), the day it flagged the actor, the highest rung; a scoring by another model file starts that
 * model's track again. A model that did not score this time keeps its track. Null when no model ever scored the actor.
 */
export function mergeModels(prev: IncidentModels | null | undefined, d: Pick<ScoredDetection, 'at'> & Partial<Pick<ScoredDetection, 'models'>>): IncidentModels | null {
  const out: IncidentModels = { ...(prev ?? {}) };
  for (const name of SHADOW_MODELS) {
    const s = d.models?.[name];
    if (!s) continue;
    const was = out[name] && out[name]!.sha === s.sha ? out[name]! : null;
    const point: ModelTrackPoint = { at: d.at, score: round(s.risk.score, 1), verdict: s.verdict, ...(s.attackClass ? { attackClass: s.attackClass } : {}) };
    const higher = !was || point.score > was.peak.score;
    const day = d.at.slice(0, 10);
    const days = was ? [...was.flaggedDays] : [];
    if (s.flagged && !days.includes(day)) days.push(day);
    out[name] = {
      sha: s.sha,
      scorings: (was?.scorings ?? 0) + 1,
      latest: point,
      peak: higher
        ? { ...point, items: topContributions(s.risk, EXPLANATION_MAX).map((c) => ({ catalogue: c.catalogue, feature: c.feature, value: round(c.value) })) }
        : was!.peak,
      flaggedDays: days.sort().slice(-MODEL_TRACK_DAYS_MAX),
      maxRung: Math.max(was?.maxRung ?? 0, verdictRung(s.verdict)),
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The history with one more scoring: the first entry and the newest HISTORY_MAX - 1 are kept. */
export function appendHistory(history: readonly HistoryEntry[], entry: HistoryEntry, max: number = HISTORY_MAX): HistoryEntry[] {
  const next = [...history, entry];
  if (next.length <= max) return next;
  return [next[0]!, ...next.slice(next.length - (max - 1))];
}

export function mergeDetections(into: DetectionSummaries, d: Pick<ScoredDetection, 'detections' | 'at'>): DetectionSummaries {
  const out: DetectionSummaries = { ...into };
  for (const x of d.detections) {
    const was = out[x.detector];
    out[x.detector] = {
      count: (was?.count ?? 0) + 1,
      maxStrength: round(Math.max(was?.maxStrength ?? 0, x.strength)),
      lastAt: was ? isoMax(was.lastAt, d.at) : d.at,
    };
  }
  return out;
}

/** Whether an active incident is over (quiet too long, or open too long) at `nowMs`: the next scoring opens a new one. */
export function isStale(active: Pick<IncidentRecord, 'openedAt' | 'lastSignalAt'>, nowMs: number): boolean {
  return nowMs - ms(active.lastSignalAt) > INCIDENT_QUIET_MS || nowMs - ms(active.openedAt) > INCIDENT_MAX_SPAN_MS;
}

/**
 * When a stale incident ended: when it went quiet (its last scoring + the quiet window), never later than now. So an expired incident
 * about an address is deleted by the retention counted from its last activity, not from the night that noticed (2.8, D55-37).
 */
export function expiredAt(active: Pick<IncidentRecord, 'lastSignalAt'>, nowMs: number): string {
  return new Date(Math.min(ms(active.lastSignalAt) + INCIDENT_QUIET_MS, nowMs)).toISOString();
}

/** A new incident from its first scoring. */
export function openFrom(d: ScoredDetection): IncidentWrite {
  const score = round(d.risk.score, 1);
  return {
    status: 'open',
    severity: severityOfScore(score),
    lane: d.lane,
    score,
    peakScore: score,
    peakAt: d.at,
    reason: reasonOf(d),
    openedAt: d.at,
    lastSignalAt: d.at,
    platform: d.platform,
    alertsOnly: d.alertsOnly,
    coldStart: d.coldStart,
    scorings: 1,
    detections: mergeDetections({}, d),
    explanation: explanationOf(d),
    history: [historyEntryOf(d)],
  };
}

/** Whether one more scoring becomes the active incident's peak (a higher score, or the first explained one). Pure. */
export function setsPeak(active: Pick<IncidentRecord, 'peakScore' | 'explanation'>, d: Pick<ScoredDetection, 'risk'>): boolean {
  return round(d.risk.score, 1) > (active.peakScore ?? Number.NEGATIVE_INFINITY) || active.explanation === null;
}

/**
 * The active incident with one more scoring. The peak (score, time, reason, explanation) moves only up; the severity follows the peak, so
 * it never drops. An acknowledged incident whose severity rises goes back to open (it is new news and enters the alert pipeline again).
 * A human finding is never alerts-only again once one scoring was not (FWA-6 is the stricter reading for a device).
 */
export function mergeInto(active: IncidentRecord, d: ScoredDetection): IncidentWrite {
  const score = round(d.risk.score, 1);
  const prevPeak = active.peakScore ?? Number.NEGATIVE_INFINITY;
  const higher = setsPeak(active, d);
  const peakScore = higher ? score : prevPeak;
  const severity = severityOfScore(peakScore);
  const status: IncidentStatus = active.status === 'acknowledged' && severityRank(severity) > severityRank(active.severity) ? 'open' : active.status;
  return {
    status,
    severity,
    lane: active.lane === 'unknown' ? d.lane : active.lane,
    score,
    peakScore,
    peakAt: higher ? d.at : active.peakAt ?? d.at,
    reason: higher ? reasonOf(d) : active.reason ?? reasonOf(d),
    openedAt: active.openedAt,
    lastSignalAt: isoMax(active.lastSignalAt, d.at),
    platform: active.platform || d.platform,
    alertsOnly: active.alertsOnly && d.alertsOnly,
    coldStart: d.coldStart,
    scorings: active.scorings + 1,
    detections: mergeDetections(active.detections ?? {}, d),
    explanation: higher ? explanationOf(d) : active.explanation!,
    history: appendHistory(active.history ?? [], historyEntryOf(d)),
  };
}

/* ─────────────────────────────── What a person does ─────────────────────────────── */

export type IncidentChange =
  | { action: 'acknowledge' }
  | { action: 'resolve'; closeReason: ManualCloseReason }
  | { action: 'reopen' };

export type TransitionResult =
  | { ok: true; to: IncidentStatus; changed: boolean }
  | { ok: false; reason: 'AI_FIREWALL_INCIDENT_CLOSED' | 'AI_FIREWALL_INCIDENT_NOT_CLOSED' };

/**
 * open -> acknowledged (acknowledging again changes nothing); open | acknowledged -> closed (resolved or a false alarm); closed -> open
 * (reopen). Acknowledging or resolving a closed incident is refused (reopen it first); reopening an active one too.
 */
export function transitionOf(status: IncidentStatus, change: IncidentChange): TransitionResult {
  switch (change.action) {
    case 'acknowledge':
      if (status === 'closed') return { ok: false, reason: 'AI_FIREWALL_INCIDENT_CLOSED' };
      return { ok: true, to: 'acknowledged', changed: status !== 'acknowledged' };
    case 'resolve':
      if (status === 'closed') return { ok: false, reason: 'AI_FIREWALL_INCIDENT_CLOSED' };
      return { ok: true, to: 'closed', changed: true };
    case 'reopen':
      if (status !== 'closed') return { ok: false, reason: 'AI_FIREWALL_INCIDENT_NOT_CLOSED' };
      return { ok: true, to: 'open', changed: true };
    default:
      return { ok: false, reason: 'AI_FIREWALL_INCIDENT_NOT_CLOSED' };
  }
}

/* ─────────────────────────────── The alert pipeline (2.7) ─────────────────────────────── */

/** English titles of the alert (the pipeline's titles are English, as audit_log's security rules); the pages translate. */
const DETECTOR_TITLES: Readonly<Record<DetectorId, string>> = {
  credential_stuffing: 'credential stuffing',
  password_spray: 'password spraying',
  enumeration: 'enumeration or ID probing',
  session_hijack: 'a possible session hijack',
  data_exfiltration: 'possible data exfiltration',
  admin_misuse: 'unusual administrator activity',
  api_key_abuse: 'API key abuse',
  public_bot: 'a bot on public pages',
  signup_abuse: 'sign-up abuse',
  device_lane: 'a device credential used oddly',
};
const ACTOR_WORDS: Readonly<Record<string, string>> = {
  user: 'a person', session: 'a session', ip: 'an address', apiKey: 'an API key', device: 'a device', node: 'a node', anon: 'an anonymous caller',
};
/** The pipeline's order is INFO < WARNING < MINOR < MAJOR < CRITICAL (observability alert.enums.ts). */
const ALERT_SEVERITY: Readonly<Record<IncidentSeverity, 'WARNING' | 'MINOR' | 'MAJOR' | 'CRITICAL'>> = {
  low: 'WARNING', medium: 'MINOR', high: 'MAJOR', critical: 'CRITICAL',
};

export interface IncidentAlertSpec {
  key: string;
  title: string;
  severity: 'WARNING' | 'MINOR' | 'MAJOR' | 'CRITICAL';
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

/**
 * One firing incident as an `observability:alert-source` spec. Labelled `category=security`, the label the seeded Security route
 * (observability.seed.ts, phase 55 00.4) matches. The title and annotations carry the detector, the actor's kind and the incident id,
 * never the actor's id (an address or a user id would travel to every notification target; the page shows it to who may see it).
 * The key is stable per incident, so a rising score updates the same alert instead of raising a second one.
 */
export function alertSpecOf(incident: Pick<IncidentRecord, 'incidentId' | 'severity' | 'reason' | 'actorKind' | 'lane' | 'peakScore' | 'openedAt' | 'lastSignalAt' | 'platform' | 'alertsOnly'>): IncidentAlertSpec {
  const detector = detectorOfReason(incident.reason);
  const what = detector ? DETECTOR_TITLES[detector] : 'many weak signs together';
  const who = ACTOR_WORDS[incident.actorKind] ?? 'an actor';
  return {
    key: `incident.${incident.incidentId.toLowerCase()}`,
    title: `AI firewall: ${what} (${who})`,
    severity: ALERT_SEVERITY[incident.severity] ?? 'MAJOR',
    labels: {
      category: 'security',
      source: 'ai_firewall',
      detector: detector ?? 'score',
      actorKind: incident.actorKind,
      lane: incident.lane,
      scope: incident.platform ? 'platform' : 'tenant',
      ...(incident.alertsOnly ? { alertsOnly: 'true' } : {}),
    },
    annotations: {
      incidentId: incident.incidentId,
      peakScore: String(incident.peakScore ?? 0),
      openedAt: incident.openedAt,
      lastSignalAt: incident.lastSignalAt,
      page: `/admin/ai-firewall?incidents=1&incident=${encodeURIComponent(incident.incidentId)}`,
    },
  };
}

/** The incidents that fire now: open, peak at ALERT_MIN_SCORE or more; the highest first, ALERT_MAX_SPECS at most. Pure. */
export function firingSpecs(incidents: ReadonlyArray<Parameters<typeof alertSpecOf>[0] & Pick<IncidentRecord, 'status'>>): IncidentAlertSpec[] {
  return incidents
    .filter((i) => i.status === 'open' && (i.peakScore ?? 0) >= ALERT_MIN_SCORE)
    .sort((a, b) => (b.peakScore ?? 0) - (a.peakScore ?? 0) || ms(b.lastSignalAt) - ms(a.lastSignalAt))
    .slice(0, ALERT_MAX_SPECS)
    .map(alertSpecOf);
}
