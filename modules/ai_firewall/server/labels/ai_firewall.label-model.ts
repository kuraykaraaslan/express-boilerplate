import { DETECTOR_IDS } from '../detect/ai_firewall.risk';
import { SCORE_REASON, detectorOfReason, type IncidentRecord } from '../incidents/ai_firewall.incident-model';
import type { EventRow } from '../store/ai_firewall.store';
import type { CapturedVectors } from '../dataset/ai_firewall.vector-capture';

/**
 * Labels (docs/phases/55-ai-firewall/03 §3.1, §3.2): what a source whose truth we know says about one incident or one stored event. PURE:
 * the closed lists, how a person's verdict, a honeytoken touch and an operator's ban decision become a label row, and the row the pages
 * read. The store (`ai_firewall.label-store.ts`) writes them; the producer (`ai_firewall.label-producer.ts`) runs the system sources. No
 * import with I/O (the incident page reads ATTACK_CLASSES from here).
 *
 * Classes are the detector ids of 02 (D55-75), so a detector's true positives are counted under its own name with no mapping table, plus
 * `benign` (a false positive, an operator's lifted ban, normal traffic), `honeytoken_touch` (a decoy touch: never legitimate) and `other`
 * (an attack none of the detectors names). A person's true positive picks an attack class: a detector's or `other` (ATTACK_CLASSES).
 */

export const LABEL_CLASSES = ['benign', ...DETECTOR_IDS, 'honeytoken_touch', 'other'] as const;
export type LabelClass = (typeof LABEL_CLASSES)[number];

/** What a person may name a true positive: a detector's class or `other` (benign is a false positive; a decoy touch is the system's). */
export const ATTACK_CLASSES = [...DETECTOR_IDS, 'other'] as const;
export type AttackClass = (typeof ATTACK_CLASSES)[number];

export const LABEL_SOURCES = ['honeytoken', 'admin', 'ban_confirmed', 'synthetic', 'benign_traffic'] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

export const LABEL_VERDICTS = ['true_positive', 'false_positive', 'unsure'] as const;
export type LabelVerdict = (typeof LABEL_VERDICTS)[number];

export const LABEL_REF_KINDS = ['incident', 'event'] as const;
export type LabelRefKind = (typeof LABEL_REF_KINDS)[number];

/**
 * Starting confidences (D55-77): a decoy touch is certain; a person's verdict is strong but a person can be wrong; "unsure" is half; a
 * ban an operator placed is their verdict on the address; an automatic or firewall ban an operator lifted says the address was harmless,
 * a little weaker (an operator may lift a ban to let a partner through). 04 weighs the examples by them; tuned with data.
 */
export const LABEL_CONFIDENCE = {
  honeytoken: 1,
  verdict: 0.9,
  unsure: 0.5,
  banPlaced: 0.9,
  banLifted: 0.8,
  /** An attack we ran ourselves (03 §3.3, D55-86): the class is known by construction. */
  synthetic: 1,
  /** Traffic of our own people and scenarios marked benign (03 §3.4, D55-86): benign by intent; a tester can still slip. */
  benignTraffic: 0.9,
} as const;

/** The producers that label without a person (`labelledBySystem`). */
export const SYSTEM_LABELLERS = { honeytoken: 'honeytoken_watch', ban: 'ban_watch', probe: 'probe_run', benign: 'benign_run' } as const;

/** Detectors an incident label carries at most (the incident's, strongest first). */
export const LABEL_DETECTORS_MAX = 10;

/** The audit-row kinds of an address ban and its lift (limiter.ip-strikes.ts, `security.ip_banned` / `security.ip_unbanned`). */
export const BAN_KIND = 'security.ip_banned';
export const UNBAN_KIND = 'security.ip_unbanned';
/** The ban sources an operator's lift calls wrong: the strikes' and the firewall's (a manual ban lifted is the operator's own change of mind). */
export const LIFTED_AS_WRONG_SOURCES: ReadonlySet<string> = new Set(['auto', 'firewall']);

/** One label as the store writes it. Times as ISO strings. */
export interface LabelWrite {
  tenantId: string;
  refKind: LabelRefKind;
  refId: string;
  refAt: string;
  actorKind: string;
  actorId: string;
  lane: string;
  kind: string | null;
  detectors: string[];
  labelClass: LabelClass;
  verdict: LabelVerdict | null;
  source: LabelSource;
  confidence: number;
  labelledBy: string | null;
  labelledBySystem: string | null;
  labelledAt: string;
  /** The probe or benign-traffic run that produced it (03 §3.3, §3.4; migration 005); null for every other source. */
  runId: string | null;
  /**
   * The vectors of the labelled behaviour (03 §3.5, migration 006), kept only on a staging or demo install: an event label's, read when it
   * was produced. An incident label leaves it out: its INSERT copies the incident's peak vectors in SQL (`labelInsertStatement`).
   */
  vectors?: CapturedVectors | null;
}

/** A person's label of an incident, as the incident drawer shows it. */
export type IncidentLabel = {
  verdict: LabelVerdict;
  labelClass: LabelClass;
  confidence: number;
  labelledBy: string | null;
  labelledAt: string;
};

/** A person's feedback on an incident (the route's input, D55-78). */
export type IncidentVerdictInput =
  | { verdict: 'true_positive'; labelClass: AttackClass }
  | { verdict: 'false_positive' }
  | { verdict: 'unsure' };

export const isLabelClass = (v: unknown): v is LabelClass => typeof v === 'string' && (LABEL_CLASSES as readonly string[]).includes(v);
export const isLabelVerdict = (v: unknown): v is LabelVerdict => typeof v === 'string' && (LABEL_VERDICTS as readonly string[]).includes(v);

/** The incident's detectors, strongest first, at most LABEL_DETECTORS_MAX; `score.rules` when none held (many weak signs). */
export function incidentDetectors(r: Pick<IncidentRecord, 'detections'>): string[] {
  const ids = Object.entries(r.detections ?? {})
    .filter(([id]) => (DETECTOR_IDS as readonly string[]).includes(id))
    .sort(([, a], [, b]) => (b?.maxStrength ?? 0) - (a?.maxStrength ?? 0))
    .map(([id]) => id)
    .slice(0, LABEL_DETECTORS_MAX);
  return ids.length ? ids : [SCORE_REASON];
}

/** What an incident looks like: its reason's detector, else its strongest detector, else `other` (many weak signs). */
export function suspectedClassOf(r: Pick<IncidentRecord, 'detections' | 'reason'>): LabelClass {
  const byReason = detectorOfReason(r.reason);
  if (byReason) return byReason;
  const strongest = incidentDetectors(r)[0];
  return strongest && isLabelClass(strongest) ? strongest : 'other';
}

/**
 * A person's verdict on an incident as its label (source admin): a true positive with the class they chose, a false positive as
 * `benign`, unsure with the class the incident looks like at half confidence. The behaviour's time is the incident's opening.
 */
export function incidentLabelOf(
  r: Pick<IncidentRecord, 'incidentId' | 'tenantId' | 'actorKind' | 'actorId' | 'lane' | 'openedAt' | 'detections' | 'reason'>,
  input: IncidentVerdictInput, labelledBy: string | null, atIso: string,
): LabelWrite {
  const labelClass: LabelClass = input.verdict === 'true_positive' ? input.labelClass
    : input.verdict === 'false_positive' ? 'benign'
      : suspectedClassOf(r);
  return {
    tenantId: r.tenantId,
    refKind: 'incident',
    refId: r.incidentId,
    refAt: r.openedAt,
    actorKind: r.actorKind,
    actorId: r.actorId,
    lane: r.lane,
    kind: null,
    detectors: incidentDetectors(r),
    labelClass,
    verdict: input.verdict,
    source: 'admin',
    confidence: input.verdict === 'unsure' ? LABEL_CONFIDENCE.unsure : LABEL_CONFIDENCE.verdict,
    labelledBy,
    labelledBySystem: null,
    labelledAt: atIso,
    runId: null,
  };
}

/** A stored attribute's text: a string, or an `UntrustedText` (`{ untrusted: true, text }`) as the intake wraps request strings. */
const textOf = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  const u = v as { untrusted?: unknown; text?: unknown } | null;
  return u && typeof u === 'object' && u.untrusted === true && typeof u.text === 'string' ? u.text : null;
};

/** A stored event as the label of a decoy touch (source honeytoken, class honeytoken_touch, confidence 1), about whoever touched it. */
export function honeytokenLabelOf(row: EventRow, atIso: string): LabelWrite {
  return {
    tenantId: row.tenantId,
    refKind: 'event',
    refId: row.signalId,
    refAt: row.at,
    actorKind: row.actorKind,
    actorId: row.actorId,
    lane: row.lane,
    kind: row.kind,
    detectors: [],
    labelClass: 'honeytoken_touch',
    verdict: null,
    source: 'honeytoken',
    confidence: LABEL_CONFIDENCE.honeytoken,
    labelledBy: null,
    labelledBySystem: SYSTEM_LABELLERS.honeytoken,
    labelledAt: atIso,
    runId: null,
  };
}

/** The address or block a ban or lift event is about (its subject, else the `m.ip` the audit row carried); null when neither. */
export function banTargetOf(row: Pick<EventRow, 'subjectType' | 'subjectId' | 'attrs'>): string | null {
  if (row.subjectType === 'ip' && row.subjectId) return row.subjectId;
  const ip = textOf(row.attrs?.['m.ip']);
  return ip && ip.length <= 128 ? ip : null;
}

/** The operator of a ban or lift event: a person actor (an automatic ban or a firewall run without a person is the system's). */
export const operatorOf = (row: Pick<EventRow, 'actorKind' | 'actorId'>): string | null => (row.actorKind === 'user' && row.actorId ? row.actorId : null);

/** The source a ban event recorded (`auto`, `manual`, `firewall`), from its `m.source` attribute (stored as untrusted text). */
export const banSourceOf = (value: unknown): string | null => textOf(value);

/**
 * An address ban an operator placed (manual, or a firewall proposal an operator approved): their verdict that the address is hostile, of
 * the class of the address's latest incident when there is one (`classHint`), else `other`. Source ban_confirmed, about the address.
 */
export function banPlacedLabelOf(row: EventRow, target: string, classHint: LabelClass | null, atIso: string): LabelWrite {
  return {
    tenantId: row.tenantId,
    refKind: 'event',
    refId: row.signalId,
    refAt: row.at,
    actorKind: 'ip',
    actorId: target,
    lane: row.lane,
    kind: row.kind,
    detectors: [],
    labelClass: classHint && classHint !== 'benign' ? classHint : 'other',
    verdict: null,
    source: 'ban_confirmed',
    confidence: LABEL_CONFIDENCE.banPlaced,
    labelledBy: operatorOf(row),
    labelledBySystem: operatorOf(row) ? null : SYSTEM_LABELLERS.ban,
    labelledAt: atIso,
    runId: null,
  };
}

/** An automatic or firewall ban an operator lifted: the address was harmless (benign), source ban_confirmed, about the address. */
export function banLiftedLabelOf(row: EventRow, target: string, atIso: string): LabelWrite {
  return {
    ...banPlacedLabelOf(row, target, null, atIso),
    labelClass: 'benign',
    confidence: LABEL_CONFIDENCE.banLifted,
  };
}

/** What a batch of stored events asks of the label producer: decoy touches are labels as they are; bans and lifts need one look-up each. */
export interface EventLabelPlan {
  touches: LabelWrite[];
  /** Bans an operator placed, with their target. */
  bans: Array<{ row: EventRow; target: string }>;
  /** Lifts by an operator, with their target (labelled only when the lifted ban was automatic or the firewall's). */
  lifts: Array<{ row: EventRow; target: string }>;
}

/** Splits stored events into what the producer labels (pure). `honeytokenKinds`: the detector kinds of every registered decoy. */
export function planEventLabels(rows: readonly EventRow[], honeytokenKinds: ReadonlySet<string>, atIso: string): EventLabelPlan {
  const plan: EventLabelPlan = { touches: [], bans: [], lifts: [] };
  for (const row of rows) {
    if (honeytokenKinds.has(row.kind)) { plan.touches.push(honeytokenLabelOf(row, atIso)); continue; }
    if (row.kind !== BAN_KIND && row.kind !== UNBAN_KIND) continue;
    if (!operatorOf(row)) continue;
    const target = banTargetOf(row);
    if (!target) continue;
    (row.kind === BAN_KIND ? plan.bans : plan.lifts).push({ row, target });
  }
  return plan;
}

/** A stored label row as the incident drawer reads it; null when it is not a person's verdict (or not a label row at all). */
export function incidentLabelViewOf(row: Record<string, unknown> | undefined): IncidentLabel | null {
  const verdict = row?.verdict;
  const labelClass = row?.labelClass;
  if (!row || !isLabelVerdict(verdict) || !isLabelClass(labelClass)) return null;
  const at = row.labelledAt instanceof Date ? row.labelledAt : new Date(String(row.labelledAt));
  const confidence = Number(row.confidence);
  return {
    verdict,
    labelClass,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    labelledBy: typeof row.labelledBy === 'string' ? row.labelledBy : null,
    labelledAt: Number.isFinite(at.getTime()) ? at.toISOString() : new Date(0).toISOString(),
  };
}

/** True and false positives and unsure verdicts per detector, the read 04.8's per-tenant calibration starts from. */
export type DetectorVerdictCounts = Record<string, { truePositive: number; falsePositive: number; unsure: number }>;

/** The counter's rows (detector, verdict, n) as per-detector counts (pure); an unknown verdict is left out. */
export function verdictCountsOf(rows: ReadonlyArray<{ detector: unknown; verdict: unknown; n: unknown }>): DetectorVerdictCounts {
  const out: DetectorVerdictCounts = {};
  for (const r of rows) {
    const { detector, verdict } = r;
    if (typeof detector !== 'string' || !isLabelVerdict(verdict)) continue;
    const c = (out[detector] ??= { truePositive: 0, falsePositive: 0, unsure: 0 });
    const n = Number(r.n) || 0;
    if (verdict === 'true_positive') c.truePositive += n;
    else if (verdict === 'false_positive') c.falsePositive += n;
    else c.unsure += n;
  }
  return out;
}
