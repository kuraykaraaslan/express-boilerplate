/**
 * The AI firewall's shared contract (docs/phases/55-ai-firewall/01 §1.2–1.4).
 *
 * It lives in `common` so a module that produces a signal, owns an action, a decoy or an analyst never imports `ai_firewall`, and
 * `ai_firewall` never imports a contributor (ADR-0008 §2; it also keeps the `limiter` <-> `ai_firewall` cycle from forming). A Pro,
 * Enterprise or IoT module contributes to the `ai_firewall:*` points from its own folder and imports only this file.
 *
 * Three parts:
 *  1. `SecuritySignal` (§1.3): the one event shape every intake produces. Strings a request controls (a user agent, a path, an
 *     e-mail address someone typed) are truncated and wrapped as `UntrustedText`, so no reader (a page, a rule, the analyst's prompt)
 *     can take them for the platform's own words.
 *  2. The contribution shapes of the points `ai_firewall` declares (§1.5): `FirewallSignalContribution`, `FirewallActionContribution`
 *     and its `FirewallActionResult`, `HoneytokenContribution`, `FirewallAnalyst`.
 *  3. `emitSecuritySignal()` (§1.4c): the tiny writer for the high-volume signals that are not audited (rate-limit hits,
 *     misbehaviour, 4xx bursts, edge decisions). It never awaits anything and never throws: the signal goes into a bounded buffer
 *     of this process, a timer writes the buffer to the capped Redis stream `fw:signals` (XADD MAXLEN ~), and whatever cannot be
 *     buffered or written is DROPPED and counted, never retried in the request (FWA-7: the firewall fails open).
 *
 * The drop counts are process-wide (held on `globalThis`: the instrumentation hook and the route bundles can each load this file)
 * and reach `/metrics` as `ai_firewall_signals_*` series: through `process-hooks` in a worker, and through the observability
 * registry in the web process (ai_firewall's runtime boot task, `ai_firewall.intake-metrics.ts`).
 */
import type { Lane } from './lane.policy';
import { LANES } from './lane.policy';
import { registerDrainHook, registerMetricSource, type MetricSource } from './process-hooks';
import { withProbeAttrs } from './common.firewall-probe-run';
import { ROOT_TENANT_ID } from './tenant-constants';

/* ──────────────────────────────── 1. The signal ──────────────────────────────── */

/** The wire version of a signal; a reader refuses an entry of a version it does not know. */
export const SIGNAL_SCHEMA_VERSION = 1 as const;

/** The lane the signal was produced on (38 L-4); `unknown` where the producer cannot tell (an audit row, a domain event). */
export type SignalLane = Lane | 'unknown';
export const SIGNAL_LANES: readonly SignalLane[] = [...LANES, 'unknown'];

/** Who acted. `anon` is a caller with nothing better to key on (its id is a stable anonymous id or `anonymous`). */
export const ACTOR_KINDS = ['user', 'session', 'ip', 'apiKey', 'device', 'node', 'anon'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface ActorRef {
  kind: ActorKind;
  /** A user id, session id, address, API key id, device id or node id. Never a secret (a key's id, never the key). */
  id: string;
}

/** The record touched, for the enumeration and exfiltration features (02). Polymorphic: a type and an id, no foreign key. */
export interface SubjectRef {
  type: string;
  id: string;
}

export const SIGNAL_OUTCOMES = ['allow', 'deny', 'fail', 'info'] as const;
export type SignalOutcome = (typeof SIGNAL_OUTCOMES)[number];

export const SIGNAL_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

/**
 * A string a request controls, labelled as such. Readers render it as quoted data and never follow it (06.2: the analyst's prompt
 * passes it only as quoted, truncated, labelled data). `truncated` says the original was longer than `UNTRUSTED_TEXT_MAX`.
 */
export interface UntrustedText {
  untrusted: true;
  text: string;
  truncated?: true;
}

export type SignalAttrValue = string | number | boolean | null | UntrustedText;
/** Typed per kind by the kind's registration in `ai_firewall:signal` (1.5); bounded here whatever the kind says. */
export type SignalAttrs = Record<string, SignalAttrValue>;

export interface SecuritySignal {
  v: typeof SIGNAL_SCHEMA_VERSION;
  /** A random uuid, assigned at emit: the consumer deduplicates on it. */
  id: string;
  /** When it happened, ISO 8601 UTC. */
  at: string;
  /** null = platform (the ROOT tenant's own rows and platform events; visible in ROOT only). */
  tenantId: string | null;
  lane: SignalLane;
  /** Registered in `ai_firewall:signal`, e.g. `auth.login_failed`. */
  kind: string;
  actor: ActorRef;
  subject?: SubjectRef;
  outcome: SignalOutcome;
  severity: SignalSeverity;
  attrs: SignalAttrs;
  /** The module that produced it. */
  source: string;
}

/** What a producer passes; `id`, `at`, `lane`, `severity` and `attrs` have defaults. */
export interface SecuritySignalInput {
  id?: string;
  at?: Date | string;
  tenantId: string | null;
  lane?: SignalLane;
  kind: string;
  actor: ActorRef;
  subject?: SubjectRef | null;
  outcome: SignalOutcome;
  severity?: SignalSeverity;
  attrs?: Record<string, SignalAttrValue | undefined>;
  source: string;
}

/** Longest request-controlled string kept (characters). */
export const UNTRUSTED_TEXT_MAX = 256;
/** Longest string the producer itself chose (a reason code, a route id) kept; longer ones are cut. */
export const TRUSTED_TEXT_MAX = 256;
/** Longest id (actor, subject, tenant) kept; a longer one makes the signal invalid rather than silently another actor. */
export const SIGNAL_ID_MAX = 128;
/** Most attributes one signal carries; the rest are left out. */
export const SIGNAL_ATTRS_MAX = 32;
/** Largest serialised signal; a larger one is dropped (`oversize`). */
export const SIGNAL_MAX_BYTES = 8_192;

const KIND_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const SOURCE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ATTR_KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A string a signal's `kind` may be (the writer drops a signal of another shape as `invalid`). */
export const isSignalKind = (v: unknown): v is string => typeof v === 'string' && KIND_RE.test(v);
/** A string an attribute's name may be (the writer leaves out an attribute of another shape). */
export const isSignalAttrKey = (v: unknown): v is string => typeof v === 'string' && ATTR_KEY_RE.test(v);

/** Wrap a request-controlled value: stringified, truncated to `max`, labelled. null for null / undefined / an empty string. */
export function untrusted(value: unknown, max: number = UNTRUSTED_TEXT_MAX): UntrustedText | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  if (text.length === 0) return null;
  const cap = Math.max(1, Math.min(max, UNTRUSTED_TEXT_MAX));
  return text.length > cap ? { untrusted: true, text: text.slice(0, cap), truncated: true } : { untrusted: true, text };
}

export function isUntrustedText(v: unknown): v is UntrustedText {
  return typeof v === 'object' && v !== null && (v as UntrustedText).untrusted === true && typeof (v as UntrustedText).text === 'string';
}

const shortId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= SIGNAL_ID_MAX;

function normaliseAttrs(input: Record<string, SignalAttrValue | undefined> | undefined): SignalAttrs {
  const out: SignalAttrs = {};
  if (!input || typeof input !== 'object') return out;
  let n = 0;
  for (const [key, value] of Object.entries(input)) {
    if (n >= SIGNAL_ATTRS_MAX) break;
    if (!ATTR_KEY_RE.test(key) || value === undefined) continue;
    if (value === null || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number') { if (!Number.isFinite(value)) continue; out[key] = value; }
    else if (typeof value === 'string') out[key] = value.length > TRUSTED_TEXT_MAX ? value.slice(0, TRUSTED_TEXT_MAX) : value;
    else if (isUntrustedText(value)) {
      const u = untrusted(value.text);
      if (!u) continue;
      out[key] = value.truncated && !u.truncated ? { ...u, truncated: true } : u;
    } else continue;
    n += 1;
  }
  return out;
}

/**
 * The signal a producer's input becomes: defaults filled, bounds applied. null when the input cannot be a signal (an unknown
 * actor kind, an outcome or severity outside the sets, a missing or overlong id, a kind or source of the wrong shape). Never throws.
 */
export function normaliseSecuritySignal(input: SecuritySignalInput): SecuritySignal | null {
  try {
    if (!input || typeof input !== 'object') return null;
    if (typeof input.kind !== 'string' || !KIND_RE.test(input.kind)) return null;
    if (typeof input.source !== 'string' || !SOURCE_RE.test(input.source)) return null;
    if (input.tenantId !== null && !shortId(input.tenantId)) return null;
    const actor = input.actor;
    if (!actor || !(ACTOR_KINDS as readonly string[]).includes(actor.kind) || !shortId(actor.id)) return null;
    if (!(SIGNAL_OUTCOMES as readonly string[]).includes(input.outcome)) return null;
    const severity = input.severity ?? 'info';
    if (!(SIGNAL_SEVERITIES as readonly string[]).includes(severity)) return null;
    const lane = input.lane ?? 'unknown';
    if (!SIGNAL_LANES.includes(lane)) return null;
    let subject: SubjectRef | undefined;
    if (input.subject) {
      if (!shortId(input.subject.type) || !shortId(input.subject.id)) return null;
      subject = { type: input.subject.type, id: input.subject.id };
    }
    const atDate = input.at === undefined ? new Date() : new Date(input.at);
    if (Number.isNaN(atDate.getTime())) return null;
    const id = input.id ?? globalThis.crypto.randomUUID();
    if (!shortId(id)) return null;
    return {
      v: SIGNAL_SCHEMA_VERSION,
      id,
      at: atDate.toISOString(),
      tenantId: input.tenantId,
      lane,
      kind: input.kind,
      actor: { kind: actor.kind, id: actor.id },
      ...(subject ? { subject } : {}),
      outcome: input.outcome,
      severity,
      attrs: normaliseAttrs(input.attrs),
      source: input.source,
    };
  } catch {
    return null;
  }
}

/** The stream entry's payload. */
export function serialiseSecuritySignal(signal: SecuritySignal): string {
  return JSON.stringify(signal);
}

/**
 * A stream entry back into a signal (the consumer, 02). Everything is checked again: an entry is data, and a writer of another
 * version or a hand-written XADD must not reach the store as a signal. null when it is not one.
 */
export function parseSecuritySignal(raw: string): SecuritySignal | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<SecuritySignal>;
  if (s.v !== SIGNAL_SCHEMA_VERSION || typeof s.at !== 'string' || !shortId(s.id)) return null;
  if (s.attrs !== undefined && (typeof s.attrs !== 'object' || s.attrs === null || Array.isArray(s.attrs))) return null;
  for (const v of Object.values(s.attrs ?? {})) {
    if (!(v === null || ['string', 'number', 'boolean'].includes(typeof v) || isUntrustedText(v))) return null;
  }
  const parsed = normaliseSecuritySignal({
    id: s.id, at: s.at, tenantId: s.tenantId ?? null, lane: s.lane, kind: s.kind as string, actor: s.actor as ActorRef,
    subject: s.subject ?? null, outcome: s.outcome as SignalOutcome, severity: s.severity, attrs: s.attrs, source: s.source as string,
  });
  return parsed && parsed.at === s.at ? parsed : null;
}

/* ──────────────────────── 2. The contributions of ai_firewall's points ──────────────────────── */

/** The ladder (05 §5.1), lowest first. A lane without an action for a rung skips it (FWA-6). */
export const FIREWALL_RUNGS = [
  'watch', 'step_up', 'throttle', 'end_session', 'exclude_device', 'end_all_sessions', 'lock', 'ban', 'notify',
] as const;
export type FirewallRung = (typeof FIREWALL_RUNGS)[number];

/** Per tenant, per action (05 §5.2). Observe is the mode of every action on install. */
export const FIREWALL_MODES = ['observe', 'suggest', 'auto'] as const;
export type FirewallMode = (typeof FIREWALL_MODES)[number];

/**
 * Where an action may run (01 §1.8): `platform` = only as the platform (a run with `tenantId` null: account-wide and installation-wide
 * controls, a lock, an address ban), `tenant` = only inside a tenant (a membership). Absent = both. The catalogue shows a tenant only the
 * modes it can choose: a platform action's mode is the root tenant's to set, a tenant action is never the platform's.
 */
export const FIREWALL_ACTION_SCOPES = ['tenant', 'platform'] as const;
export type FirewallActionScope = (typeof FIREWALL_ACTION_SCOPES)[number];

/** The platform cap of any action's TTL (1.5: boot refuses an action whose `ttl.maxMs` is above it). */
export const FIREWALL_ACTION_TTL_CAP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The rungs that act on a person (a session, an account): never on a machine or device lane (FWA-6, 38 L-4). `step_up` is further
 * bound to the lanes whose `LANE_POLICY.stepUp` allows it. Boot refuses an action of one of these rungs that lists another lane.
 */
export const FIREWALL_HUMAN_RUNGS: readonly FirewallRung[] = ['step_up', 'end_session', 'end_all_sessions', 'lock'];

/** The rungs strong enough that their evidence must be the actor's own (FWA-5); boot refuses one without `evidence.boundToActor`. */
export const FIREWALL_BOUND_EVIDENCE_RUNGS: readonly FirewallRung[] = ['end_all_sessions', 'lock'];

/**
 * What an attribute of a signal is, for privacy (01 §1.5): boot refuses an attribute without one. The class decides what export
 * redacts, what erasure removes and what the PII-free dataset of 03 may keep (only `none`).
 *  - `none`: not about a person (a reason code, a route id, a count, a status).
 *  - `identifier`: a person's pseudonymous id (a user, session, API key or member id).
 *  - `network`: an IP address or a block a person connects from.
 *  - `device`: a user agent, a device id or fingerprint.
 *  - `location`: a country, a city, coordinates.
 *  - `contact`: an e-mail address, a phone number or a name (also one someone typed).
 *  - `content`: free text a person wrote.
 */
export const PERSONAL_DATA_CLASSES = ['none', 'identifier', 'network', 'device', 'location', 'contact', 'content'] as const;
export type PersonalDataClass = (typeof PERSONAL_DATA_CLASSES)[number];

/** The value types an attribute may have; `untrusted` is an `UntrustedText` (a string a request controls). */
export const SIGNAL_ATTR_TYPES = ['string', 'number', 'boolean', 'untrusted'] as const;
export type SignalAttrType = (typeof SIGNAL_ATTR_TYPES)[number];

export interface FirewallSignalAttribute {
  type: SignalAttrType;
  /** Required (boot refuses an attribute without one). */
  pd: PersonalDataClass;
  /** One line for the catalogue, English. */
  description?: string;
}

/**
 * `ai_firewall:signal` (catalog): one signal kind a module emits (1.5). Default export: one of these or an array; the contribution's
 * `metadata.ids` lists the kinds (the snapshot refuses a kind two contributions list, `uniqueMetadata`) and `metadata.routes` the human
 * auth routes whose outcome these kinds record (the signal coverage check, `npm run check:firewall-signal-coverage`). Boot refuses a kind
 * registered twice, a kind the export and `metadata.ids` disagree on, and an attribute without a personal-data class.
 */
export interface FirewallSignalContribution {
  /** Stable forever, the `SecuritySignal.kind` it is emitted with: `auth.login_failed`, `limiter.rate_limited`. */
  kind: string;
  /** What an admin sees in the catalogue (dictionary key), e.g. `auth.firewallSignal.login_failed`. */
  labelKey?: string;
  /** The lanes it is produced on. */
  lanes: readonly SignalLane[];
  /** Whom it is about. */
  actorKinds: readonly ActorKind[];
  /** The outcomes it is emitted with; absent = any. */
  outcomes?: readonly SignalOutcome[];
  /** Its usual severity (the producer may raise it per signal). */
  severity: SignalSeverity;
  /** The rule scorer's starting weight (02), 0..1. */
  defaultWeight: number;
  /** Every attribute it carries, each with a personal-data class. An attribute not listed is left out by the store (02). */
  attrs: Readonly<Record<string, FirewallSignalAttribute>>;
  /**
   * true: the module emits this kind itself through `emitSecuritySignal` (1.4c: a decoy touch, a request-metadata count), so it is not
   * made of an audit row and carries only the attributes listed here, not the row's own (`AUDIT_ROW_SIGNAL_ATTRS`). Absent = an audit
   * row's kind (`auditRowSignal`).
   */
  emitted?: true;
  /**
   * An audit row's kind only (D443): who a row written WITHOUT an actor (no actor id, no node: the system's own row) is weighed against.
   * The audit intake makes that record the signal's actor, as `kind`, so the platform's notices about one record (a gateway whose children
   * it created or refused) fold on that record instead of on `anon:system` with every other system row. A row with an actor keeps it; the
   * subject stays the subject. `kind` must be one of `actorKinds`. See `SystemRowActor`.
   */
  systemRowActor?: SystemRowActor;
}

/**
 * `FirewallSignalContribution.systemRowActor`: where an actorless row's actor id comes from.
 *  - `from: 'subject'`: the row's subject (`resourceId`) when its `resourceType` is `subjectType` (a refused child: the gateway is the
 *    subject);
 *  - `from: 'metadata'`: the row's metadata field `field`, when it holds a uuid (a created child: the subject is the child, the gateway
 *    is `metadata.gatewayDeviceId`).
 * Anything else (another subject type, a missing or malformed value) leaves the row's actor as the intake reads it without one.
 */
export type SystemRowActor =
  | { kind: ActorKind; from: 'subject'; subjectType: string }
  | { kind: ActorKind; from: 'metadata'; field: string };

/** What the responder hands an action when it runs it. */
export interface FirewallActionContext {
  /** null = a platform action (ROOT). */
  tenantId: string | null;
  actor: ActorRef;
  subject?: SubjectRef;
  lane: Lane;
  /** The proposal this run belongs to: the idempotency key (a retried run must not act twice). */
  proposalId: string;
  incidentId?: string;
  /** The TTL the responder chose, within the action's default and max. */
  ttlMs: number;
  /** A stable reason code (dictionary key `ai_firewall.reason.<code>`), never free text. */
  reason: string;
  /** The signals the decision rests on (FWA-5: the responder checked they are bound to the actor when `evidence.boundToActor`). */
  evidence: readonly SecuritySignal[];
  signal?: AbortSignal;
}

/** What `undo` gets: the run it reverts, with what `execute` said it needs to revert it. */
export interface FirewallUndoContext {
  tenantId: string | null;
  actor: ActorRef;
  subject?: SubjectRef;
  proposalId: string;
  undoData: FirewallUndoData;
  /** `expired` when the TTL ran out, `manual` for the one-click undo, `kill_switch` when the tenant's or the platform's switch fired. */
  why: 'expired' | 'manual' | 'kill_switch';
  signal?: AbortSignal;
}

/** Small, non-secret facts `undo` needs (a ban id, a session id, a previous value). */
export type FirewallUndoData = Record<string, string | number | boolean | null>;

export interface FirewallActionResult {
  /**
   * `executed`: the change holds. `noop`: nothing to do (already banned, no such session). `refused`: the owning module would not
   * (the last admin of a tenant, a super-admin without approval). `failed`: it tried and could not; the responder pages and does not retry
   * on its own.
   */
  status: 'executed' | 'noop' | 'refused' | 'failed';
  /** A stable code for the pages and the audit row. */
  reason?: string;
  /** Required with `executed` for an action that changes something `undo` must revert. */
  undoData?: FirewallUndoData;
  /** When the change lapses on its own, if the owning module enforces the TTL itself (ISO 8601). */
  expiresAt?: string;
}

/**
 * `ai_firewall:action` (catalog): an action the responder may run through the module that owns it (1.5, 05). The owning module's own
 * service does the work; ai_firewall writes no other module's table. Boot refuses one without `undo` (FWA-4), a human rung on a machine
 * or device lane (FWA-6) and a `ttl.maxMs` above `FIREWALL_ACTION_TTL_CAP_MS`.
 */
export interface FirewallActionContribution {
  /** Stable forever: `<module>.<verb>`, e.g. `user_session.end_session`. */
  id: string;
  rung: FirewallRung;
  /** The lanes it may run on (FWA-6: human controls never on a machine or device lane). */
  lanes: readonly Lane[];
  /** The actor kinds it acts on (machine and device actors per credential, serial or node, never per address). */
  actorKinds: readonly ActorKind[];
  ttl: { defaultMs: number; maxMs: number };
  /**
   * The least oversight this action ever runs under. `suggest`: a person approves every run, whatever mode the tenant chose (the
   * responder turns Auto into Suggest for it). `auto`: the tenant's mode decides. Observe is never a floor: every action can be observed.
   */
  minimumMode: Exclude<FirewallMode, 'observe'>;
  /** The mode a promoted action starts in for a tenant that has not chosen one (install is always Observe). */
  defaultMode?: FirewallMode;
  /** Most automatic runs per tenant per hour; over it the action falls back to Suggest and pages (05 §5.4). */
  hourlyBudget: number;
  /** What the decision must rest on (FWA-5). */
  evidence: {
    /** The signals must come from the actor's own session or credential (an outsider's failed logins for an e-mail do not count). */
    boundToActor: boolean;
    /** Fewest signals of the kinds below. */
    minSignals: number;
    /** Kinds that count; empty or absent = any registered kind. */
    kinds?: readonly string[];
  };
  /**
   * false: what `execute` did cannot be restored (an ended session, a revoked certificate, revoked trusted devices); its `undo` exists
   * (FWA-4: boot refuses an action without one) and answers `noop` with the reason (`notReversible`), so the one-click undo says so
   * instead of pretending. Absent = true. The responder (05) shows it before an approval and never counts such an undo as a restore.
   */
  reversible?: boolean;
  /**
   * Where it may run (`FIREWALL_ACTION_SCOPES`); absent = in a tenant and as the platform. Declare what `execute` refuses with
   * `outOfScope`, so the catalogue never offers a mode that can never apply (01 §1.8).
   */
  scope?: FirewallActionScope;
  execute(ctx: FirewallActionContext): Promise<FirewallActionResult>;
  /** Required (FWA-4): reverts one executed run. Must be idempotent: undoing an undone run is a `noop`. */
  undo(ctx: FirewallUndoContext): Promise<FirewallActionResult>;
}

/** What `plant` answers for a planted decoy (02 §2.5). */
export interface PlantedHoneytoken {
  /** A short, non-secret reference the canary list shows (a masked key, a record id, a count of paths). */
  ref: string;
  /**
   * The bait itself, for the tenant's administrator to place where only an intruder would find it (the decoy key, the canary record
   * id, the trap paths). It authenticates and opens nothing; it is shown only in the firewall's canary list, never in a list a customer
   * reads elsewhere.
   */
  bait?: string;
  /** Where a touch is detected, for the canary list (an API path template such as `/api/members/<id>`); absent = everywhere. */
  where?: string;
}

/** `ai_firewall:honeytoken` (catalog): a decoy a module owns (02 §2.5). Boot refuses one without a detector, or with a detector that is not critical. */
export interface HoneytokenContribution {
  /** Stable forever: `<module>.<decoy>`. */
  id: string;
  kind: 'api_key' | 'record' | 'route' | 'credential' | 'other';
  /** What an admin sees in the catalogue (dictionary key). */
  labelKey: string;
  /** A one-line description for the canary list (dictionary key). */
  descriptionKey?: string;
  /**
   * How a touch is detected: the owning module emits this signal kind (severity `critical`) when the decoy is touched. The kind is
   * registered in `ai_firewall:signal` like every other, with severity `critical` (boot refuses another).
   */
  detector: { signalKind: string };
  /** Plants (or confirms) the decoy for a tenant (null = platform); answers its non-secret reference, or null when not planted. */
  plant?(tenantId: string | null): Promise<PlantedHoneytoken | null>;
  /** Removes the decoy (the tenant switched the decoy off, or the module is being uninstalled). */
  remove?(tenantId: string | null): Promise<void>;
}

/** What the analyst reads of an incident: structured facts only; the untrusted strings inside the evidence stay labelled. */
export interface FirewallIncidentBrief {
  incidentId: string;
  tenantId: string | null;
  actor: ActorRef;
  openedAt: string;
  score: number;
  /** Signal kinds and their counts in the incident's window. */
  kinds: Record<string, number>;
  /** The per-feature contributions behind the score (04 TreeSHAP), as stable feature names. */
  contributions: Record<string, number>;
  evidence: readonly SecuritySignal[];
}

export interface FirewallTriage {
  /** One of `allowed.classifications`; anything else is dropped (FWA-3). */
  classification: string;
  /** Never above `allowed.maxRung`; the verdict can only create a Suggest item (FWA-11). */
  suggestedRung: FirewallRung | null;
  confidence: number;
  /** Short, the analyst's words; shown as the model's text, never as the platform's. */
  rationale: string;
}

/** A filter over the event schema (06.4): what a question becomes, never SQL. */
export interface SignalFilter {
  from?: string;
  to?: string;
  kinds?: string[];
  actorKinds?: ActorKind[];
  actorIds?: string[];
  outcomes?: SignalOutcome[];
  minSeverity?: SignalSeverity;
  subjectTypes?: string[];
}

/**
 * `ai_firewall:analyst` (select, fallback none): the optional L2 analyst (Pro `ai`, 06). Every method may answer null (no provider,
 * over the firewall's own AI budget, output that does not fit the schema); the firewall then shows what it shows without one.
 */
export interface FirewallAnalyst {
  key: string;
  available(tenantId: string | null): Promise<boolean>;
  triage(
    incident: FirewallIncidentBrief,
    allowed: { classifications: readonly string[]; maxRung: FirewallRung },
  ): Promise<FirewallTriage | null>;
  digest(tenantId: string | null, period: { from: string; to: string }, facts: Record<string, number>): Promise<string | null>;
  toFilter(tenantId: string | null, question: string): Promise<SignalFilter | null>;
}

/* ──────────────────────────────── 3. The writer ──────────────────────────────── */

export const SIGNAL_STREAM_KEY = 'fw:signals';
/** The stream's approximate cap (`XADD MAXLEN ~`): Redis trims whole nodes, so the stream may hold a little more. */
export const SIGNAL_STREAM_MAXLEN = 100_000;
/** Signals this process holds while they wait for a write; one more is dropped (`buffer_full`). */
export const SIGNAL_BUFFER_MAX = 2_000;
/**
 * The last part of the buffer only a `critical` signal may take (a decoy touch, D55-54): a flood of lesser signals (a tally window, a burst
 * of audit rows) stops at `SIGNAL_BUFFER_MAX - SIGNAL_BUFFER_RESERVE`, so the touch that matters most is not dropped as `buffer_full`
 * exactly when an attack fills the buffer (D55-66).
 */
export const SIGNAL_BUFFER_RESERVE = 200;
/** Entries one write sends (one pipeline). */
export const SIGNAL_FLUSH_BATCH = 200;
/** How long a signal waits for company before the buffer is written. */
export const SIGNAL_FLUSH_DELAY_MS = 50;
/** A write that has not answered by then counts as failed (its entries are dropped, never retried). */
export const SIGNAL_WRITE_TIMEOUT_MS = 1_000;

export const SIGNAL_DROP_REASONS = ['invalid', 'oversize', 'buffer_full', 'redis_unavailable', 'write_failed'] as const;
export type SignalDropReason = (typeof SIGNAL_DROP_REASONS)[number];

/** Writes serialised signals to the stream; answers how many were written (the rest count as `write_failed`). */
export type SignalStreamWriter = (entries: readonly string[]) => Promise<number>;

interface IntakeState {
  buffer: string[];
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
  accepted: number;
  written: number;
  dropped: Record<SignalDropReason, number>;
  writer: SignalStreamWriter | null;
  hooksRegistered: boolean;
}

const STATE_KEY = Symbol.for('kuraykaraaslan-labs.common.firewallSignalIntake');
const holder = globalThis as unknown as Record<symbol, IntakeState | undefined>;

const freshState = (): IntakeState => ({
  buffer: [], timer: null, flushing: null, accepted: 0, written: 0,
  dropped: { invalid: 0, oversize: 0, buffer_full: 0, redis_unavailable: 0, write_failed: 0 },
  writer: null, hooksRegistered: false,
});
const state = (): IntakeState => (holder[STATE_KEY] ??= freshState());

const drop = (reason: SignalDropReason, n = 1): void => { state().dropped[reason] += n; };

class RedisUnavailableError extends Error {}

type RedisLike = {
  status?: string;
  pipeline(): { xadd(...args: Array<string | number>): unknown; exec(): Promise<Array<[Error | null, unknown]> | null> };
};
let redisImport: Promise<RedisLike> | null = null;

/** The default writer: one pipeline of `XADD fw:signals MAXLEN ~ <cap> * v 1 s <json>`. Redis is imported on first use. */
const redisWriter: SignalStreamWriter = async (entries) => {
  redisImport ??= import('@kuraykaraaslan-labs/redis').then((m) => m.default as unknown as RedisLike).catch((error: unknown) => {
    redisImport = null;
    throw error;
  });
  let redis: RedisLike;
  try { redis = await redisImport; } catch (error) { throw new RedisUnavailableError(String(error)); }
  // ioredis queues commands while it reconnects; the intake must not pile up behind that (FWA-7).
  if (redis.status && redis.status !== 'ready') throw new RedisUnavailableError(`Redis is ${redis.status}`);
  const pipe = redis.pipeline();
  for (const entry of entries) {
    pipe.xadd(SIGNAL_STREAM_KEY, 'MAXLEN', '~', SIGNAL_STREAM_MAXLEN, '*', 'v', String(SIGNAL_SCHEMA_VERSION), 's', entry);
  }
  const results = await pipe.exec();
  if (!results) return 0;
  return results.filter(([err]) => !err).length;
};

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function writeOnce(s: IntakeState): Promise<void> {
  const batch = s.buffer.splice(0, SIGNAL_FLUSH_BATCH);
  if (batch.length === 0) return;
  try {
    const written = await within((s.writer ?? redisWriter)(batch), SIGNAL_WRITE_TIMEOUT_MS);
    const ok = Math.max(0, Math.min(batch.length, Number.isFinite(written) ? written : 0));
    s.written += ok;
    if (ok < batch.length) s.dropped.write_failed += batch.length - ok;
  } catch (error) {
    s.dropped[error instanceof RedisUnavailableError ? 'redis_unavailable' : 'write_failed'] += batch.length;
  }
}

function schedule(delayMs: number): void {
  const s = state();
  // A running flush drains what arrives meanwhile; a pending timer is brought forward only when a full batch is waiting.
  if (s.flushing) return;
  if (s.timer) {
    if (delayMs > 0) return;
    clearTimeout(s.timer);
  }
  s.timer = setTimeout(() => {
    s.timer = null;
    void flushSecuritySignals();
  }, delayMs);
  (s.timer as { unref?: () => void }).unref?.();
}

/**
 * Writes what the buffer holds, one batch after another, until it is empty. One flush runs at a time per process; a second call
 * waits for it. Never rejects. Called by the timer, by the worker's drain hook, and by tests.
 */
export function flushSecuritySignals(): Promise<void> {
  const s = state();
  if (s.flushing) return s.flushing;
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (s.buffer.length === 0) return Promise.resolve();
  s.flushing = (async () => {
    // first yield, so `finally` below always runs after `s.flushing` was assigned
    await null;
    try {
      while (s.buffer.length > 0) await writeOnce(s);
    } catch {
      // writeOnce counts its own failures; nothing reaches a caller
    } finally {
      s.flushing = null;
    }
  })();
  return s.flushing;
}

function registerHooksOnce(): void {
  const s = state();
  if (s.hooksRegistered) return;
  s.hooksRegistered = true;
  for (const source of securitySignalMetricSources()) registerMetricSource(source);
  registerDrainHook('ai_firewall:signal-intake', () => flushSecuritySignals());
}

/**
 * Hands a signal to the firewall. Synchronous, never throws, never waits: the request that produced the signal is not slowed or
 * failed by it, whatever Redis does (FWA-7). Answers whether the signal was accepted into this process's buffer; a signal that is
 * invalid, too large, or finds the buffer full is dropped and counted (`ai_firewall_signals_dropped_total{reason}`), never retried. A
 * signal below `critical` finds the buffer full at `SIGNAL_BUFFER_MAX - SIGNAL_BUFFER_RESERVE`; a critical one at `SIGNAL_BUFFER_MAX`.
 */
export function emitSecuritySignal(input: SecuritySignalInput): boolean {
  try {
    registerHooksOnce();
    // Phase 55 03 §3.3 (D55-83): a `probe.*` attribute is never the producer's; the accepted probe run of this request, if any, is.
    const signal = normaliseSecuritySignal({ ...input, attrs: withProbeAttrs(input.attrs) });
    if (!signal) { drop('invalid'); return false; }
    const entry = serialiseSecuritySignal(signal);
    if (entry.length > SIGNAL_MAX_BYTES) { drop('oversize'); return false; }
    const s = state();
    const limit = signal.severity === 'critical' ? SIGNAL_BUFFER_MAX : SIGNAL_BUFFER_MAX - SIGNAL_BUFFER_RESERVE;
    if (s.buffer.length >= limit) { drop('buffer_full'); return false; }
    s.buffer.push(entry);
    s.accepted += 1;
    schedule(s.buffer.length >= SIGNAL_FLUSH_BATCH ? 0 : SIGNAL_FLUSH_DELAY_MS);
    return true;
  } catch {
    try { drop('invalid'); } catch { /* counting never throws either */ }
    return false;
  }
}

export interface SignalIntakeStats {
  accepted: number;
  written: number;
  buffered: number;
  dropped: Record<SignalDropReason, number>;
}

/**
 * How many more non-critical signals this process's buffer takes now (the reserve left out). The tally hands the intake no more than this
 * per flush and carries the rest to its next one (common.firewall-tally.ts), so a full window never spills into `buffer_full`.
 */
export function securitySignalBufferRoom(): number {
  return Math.max(0, SIGNAL_BUFFER_MAX - SIGNAL_BUFFER_RESERVE - state().buffer.length);
}

/** This process's intake counts since it started. */
export function securitySignalIntakeStats(): SignalIntakeStats {
  const s = state();
  return { accepted: s.accepted, written: s.written, buffered: s.buffer.length, dropped: { ...s.dropped } };
}

/**
 * The intake's series, read at scrape time. Counters are offered as gauge sources whose value only grows (the registries have no
 * pull counter), so `rate()` and `increase()` work as for a counter.
 */
export function securitySignalMetricSources(): MetricSource[] {
  return [
    {
      name: 'ai_firewall_signals_dropped_total',
      help: 'Security signals this process dropped before they reached the fw:signals stream, by reason (never retried; FWA-7).',
      labelNames: ['reason'],
      read: async () => SIGNAL_DROP_REASONS.map((reason) => ({ labels: { reason }, value: state().dropped[reason] })),
    },
    {
      name: 'ai_firewall_signals_written_total',
      help: 'Security signals this process wrote to the fw:signals stream.',
      labelNames: [],
      read: async () => [{ labels: {}, value: state().written }],
    },
    {
      name: 'ai_firewall_signals_buffered',
      help: 'Security signals waiting in this process for their write to the fw:signals stream.',
      labelNames: [],
      read: async () => [{ labels: {}, value: state().buffer.length }],
    },
  ];
}

/** Test seam: replace the stream writer (null = the Redis one). */
export function setSignalStreamWriter(writer: SignalStreamWriter | null): void {
  state().writer = writer;
}

/** Test seam: forget the buffer, the counts and the writer. */
export function resetSignalIntake(): void {
  const s = holder[STATE_KEY];
  if (s?.timer) clearTimeout(s.timer);
  // a flush still running on the old state ends with its current batch
  if (s) s.buffer.length = 0;
  holder[STATE_KEY] = freshState();
  redisImport = null;
}

/* ──────────────────────── 4. Helpers for the contributing modules (01 §1.6) ──────────────────────── */

/** The lanes a person signs in and works on (38 L-4): the only lanes a human rung (step-up, end a session, lock) may list (FWA-6). */
export const FIREWALL_HUMAN_LANES = ['human-web', 'human-native'] as const satisfies readonly Lane[];

/** The lanes on which an address is acted on (`LANE_POLICY.banParticipation === true`): a person's lanes and the anonymous public. */
export const FIREWALL_ADDRESS_LANES = ['human-web', 'human-native', 'public-anon'] as const satisfies readonly Lane[];

/** One attribute of a signal kind, for the declarations below: a type and its personal-data class (and a line for the catalogue). */
export const signalAttr = {
  /** A string the producer chose (a reason code, an id). */
  text: (pd: PersonalDataClass = 'none', description?: string): FirewallSignalAttribute => ({ type: 'string', pd, ...(description ? { description } : {}) }),
  /** A string a request or a person controls, or any string the audit intake copied from an audit row's metadata (it marks them all). */
  untrusted: (pd: PersonalDataClass = 'none', description?: string): FirewallSignalAttribute => ({ type: 'untrusted', pd, ...(description ? { description } : {}) }),
  number: (pd: PersonalDataClass = 'none', description?: string): FirewallSignalAttribute => ({ type: 'number', pd, ...(description ? { description } : {}) }),
  flag: (pd: PersonalDataClass = 'none', description?: string): FirewallSignalAttribute => ({ type: 'boolean', pd, ...(description ? { description } : {}) }),
} as const;

/**
 * The attributes ai_firewall's audit intake (01 §1.4a, `auditRecordToSignal`) puts on every signal it makes of an audit row, with their
 * personal-data classes. A metadata field of the row travels as `m.<field>`, a string always as `untrusted` (the intake cannot tell a
 * value the platform chose from one a request supplied), arrays and objects never.
 */
export const AUDIT_ROW_SIGNAL_ATTRS: Readonly<Record<string, FirewallSignalAttribute>> = {
  actorType: signalAttr.text('none', 'USER, SYSTEM, API_KEY or SERVICE'),
  ip: signalAttr.text('network', 'the client address the row recorded'),
  userAgent: signalAttr.untrusted('device', 'the user agent the row recorded'),
  onBehalfOf: signalAttr.text('identifier', 'the person an impersonation or a delegation acted for'),
  actorTenantId: signalAttr.text('none', 'the tenant the actor belongs to, when it is not the row\'s'),
  sealed: signalAttr.flag('none', 'the row is sealed in the hash chain'),
};

/** The metadata of an aggregated refusal row (phase 55 00.3, `audit_log.refusals.ts`): one row per action, tenant, key and minute. */
export const REFUSAL_ROW_METADATA: Readonly<Record<string, FirewallSignalAttribute>> = {
  aggregated: signalAttr.flag('none', 'always true: the row stands for every refusal of its minute'),
  count: signalAttr.number('none', 'refusals in the minute'),
  windowStart: signalAttr.untrusted('none'),
  windowEnd: signalAttr.untrusted('none'),
  firstAt: signalAttr.untrusted('none'),
  lastAt: signalAttr.untrusted('none'),
  overflow: signalAttr.flag('none', 'the action\'s overflow bucket: more keys than one minute may open'),
  bucketsMax: signalAttr.number('none'),
};

/** What one audit action (a kind the audit intake produces) declares; `auditRowSignal` adds the row's own attributes. */
export interface AuditRowSignalDef {
  kind: string;
  labelKey?: string;
  severity: SignalSeverity;
  defaultWeight: number;
  /** Default `['unknown']`: an audit row names no lane unless its metadata does (`metadata.lane`), or its actor is a key or a node. */
  lanes?: readonly SignalLane[];
  /**
   * Default `['user']`. The intake's actor: the key (API_KEY rows), the person (an actor id), the node, the subject when the kind declares
   * `systemRowActor`, the address, else `anon`.
   */
  actorKinds?: readonly ActorKind[];
  outcomes?: readonly SignalOutcome[];
  /** The row's metadata fields the kind carries, by field name (they travel as `m.<field>`). */
  metadata?: Readonly<Record<string, FirewallSignalAttribute>>;
  /** Opt-in (D443): the record an actorless row is weighed against (`FirewallSignalContribution.systemRowActor`). */
  systemRowActor?: SystemRowActor;
}

/** The `ai_firewall:signal` declaration of a kind the audit intake produces from the rows of one audit action. */
export function auditRowSignal(def: AuditRowSignalDef): FirewallSignalContribution {
  const attrs: Record<string, FirewallSignalAttribute> = { ...AUDIT_ROW_SIGNAL_ATTRS };
  for (const [field, attr] of Object.entries(def.metadata ?? {})) attrs[`m.${field}`] = attr;
  return {
    kind: def.kind,
    ...(def.labelKey ? { labelKey: def.labelKey } : {}),
    lanes: def.lanes ?? ['unknown'],
    actorKinds: def.actorKinds ?? ['user'],
    ...(def.outcomes ? { outcomes: def.outcomes } : {}),
    severity: def.severity,
    defaultWeight: def.defaultWeight,
    attrs,
    ...(def.systemRowActor ? { systemRowActor: def.systemRowActor } : {}),
  };
}

/* ───────────────────────────── Catalogue labels (01 §1.8) ───────────────────────────── */

/** An id as one dictionary key segment: every character outside [A-Za-z0-9_] becomes '_' (`api_key.verify.failed` -> `api_key_verify_failed`). */
export const firewallLabelSlug = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * The dictionary key of a signal kind's name in the catalogue, in the owning module's dictionary (keys are module-prefixed): the
 * contribution's own `labelKey`, else `<moduleId>.firewallSignal.<kind slug>`. The page falls back to the kind itself when the key is
 * missing (a module whose dictionary is not shipped to the tenant).
 */
export const firewallSignalLabelKey = (moduleId: string, kind: string, labelKey?: string): string =>
  labelKey || `${moduleId}.firewallSignal.${firewallLabelSlug(kind)}`;

/** The dictionary keys of an action's name and one-line description in the catalogue: `<moduleId>.firewallAction.<id slug>.label | .description`. */
export const firewallActionLabelKeys = (moduleId: string, actionId: string): { label: string; description: string } => {
  const base = `${moduleId}.firewallAction.${firewallLabelSlug(actionId)}`;
  return { label: `${base}.label`, description: `${base}.description` };
};

/** An action's undo that cannot restore anything (`reversible: false`): it says why, as a stable code, and changes nothing. */
export const notReversible = (reason: string) => async (): Promise<FirewallActionResult> => ({ status: 'noop', reason });

/**
 * What an error of the owning module's own function means for the responder: 404 = nothing to act on (`noop`), 400 / 403 / 409 / 422 =
 * the module will not (`refused`), anything else = it tried and could not (`failed`). The reason is a stable code, never the message.
 */
export function firewallResultOfError(error: unknown): FirewallActionResult {
  const status = typeof (error as { statusCode?: unknown } | null)?.statusCode === 'number' ? (error as { statusCode: number }).statusCode : 0;
  if (status === 404) return { status: 'noop', reason: 'not_found' };
  if (status === 409) return { status: 'refused', reason: 'conflict' };
  if (status === 400 || status === 422) return { status: 'refused', reason: 'invalid' };
  if (status === 403) return { status: 'refused', reason: 'forbidden' };
  if (status === 503) return { status: 'failed', reason: 'unavailable' };
  return { status: 'failed', reason: 'error' };
}

/** Runs an action step and answers the module's refusal as a result instead of a throw (the responder never sees an exception). */
export async function firewallStep(step: () => Promise<FirewallActionResult>): Promise<FirewallActionResult> {
  try {
    return await step();
  } catch (error) {
    return firewallResultOfError(error);
  }
}

/** The refusal of an action asked outside the scope it may act in (an account-wide action for a tenant, a tenant's record for the platform). */
export const outOfScope = (reason: 'platform_only' | 'tenant_only'): FirewallActionResult => ({ status: 'refused', reason });

/** The undo data as a string, or null (the responder hands back what `execute` stored; a missing value is never guessed). */
export const undoText = (data: FirewallUndoData, key: string): string | null => (typeof data[key] === 'string' && data[key] ? (data[key] as string) : null);

/* ───────────────────────────── Honeytokens (02 §2.5) ───────────────────────────── */

/** Most signals one touch key (the decoy's kind, the tenant and the actor) emits per window; further touches are counted, not emitted. */
export const HONEYTOKEN_TOUCHES_PER_WINDOW = 3;
/** The window of both bounds. */
export const HONEYTOKEN_TOUCH_WINDOW_MS = 60_000;
/** Most decoy-touch signals one process emits per window, over every decoy and actor (a scan from many addresses at once). */
export const HONEYTOKEN_PROCESS_TOUCHES_PER_WINDOW = 600;
/** Touch keys one process remembers; past it the memory starts again (a bounded map, never a growing one). */
const HONEYTOKEN_TOUCH_KEYS_MAX = 10_000;

/** One touch of a decoy, as its owning module saw it. */
export interface HoneytokenTouch {
  /** The detector's signal kind (`HoneytokenContribution.detector.signalKind`). */
  kind: string;
  /** The owning module. */
  source: string;
  /** The tenant whose decoy it is; null or the ROOT tenant = the platform's. */
  tenantId: string | null;
  /** Who touched it: the signed-in person or key when known, else the address, else `anon`. */
  actor: ActorRef;
  subject?: SubjectRef | null;
  lane?: SignalLane;
  /** Default `deny`: a decoy never lets anything through. */
  outcome?: SignalOutcome;
  attrs?: Record<string, SignalAttrValue | undefined>;
}

interface TouchState {
  windowStart: number;
  processCount: number;
  perKey: Map<string, number>;
  emitted: number;
  suppressed: number;
}

const TOUCH_STATE_KEY = Symbol.for('kuraykaraaslan-labs.common.firewallHoneytokenTouches');
const touchHolder = globalThis as unknown as Record<symbol, TouchState | undefined>;
const touchState = (): TouchState => (touchHolder[TOUCH_STATE_KEY] ??= { windowStart: 0, processCount: 0, perKey: new Map(), emitted: 0, suppressed: 0 });

/**
 * Reports a decoy touch to the firewall (02 §2.5): a `critical` signal of the detector's kind through `emitSecuritySignal`. Synchronous,
 * never throws, never waits (FWA-7): the caller answers exactly as it would have without the decoy. Bounded in process: at most
 * `HONEYTOKEN_TOUCHES_PER_WINDOW` signals per kind, tenant and actor and `HONEYTOKEN_PROCESS_TOUCHES_PER_WINDOW` in all per window, so a
 * scanner cannot flood `fw:signals` through a decoy; the touches over the bounds are counted (`honeytokenTouchStats`). Answers whether a
 * signal was handed to the intake.
 */
export function emitHoneytokenTouch(touch: HoneytokenTouch, now: number = Date.now()): boolean {
  try {
    const s = touchState();
    if (now - s.windowStart >= HONEYTOKEN_TOUCH_WINDOW_MS || now < s.windowStart) {
      s.windowStart = now;
      s.processCount = 0;
      s.perKey.clear();
    }
    const key = `${touch.kind}\u0000${touch.tenantId ?? ''}\u0000${touch.actor?.kind}\u0000${touch.actor?.id}`;
    const seen = s.perKey.get(key) ?? 0;
    if (seen >= HONEYTOKEN_TOUCHES_PER_WINDOW || s.processCount >= HONEYTOKEN_PROCESS_TOUCHES_PER_WINDOW) {
      s.suppressed += 1;
      return false;
    }
    if (s.perKey.size >= HONEYTOKEN_TOUCH_KEYS_MAX) s.perKey.clear();
    s.perKey.set(key, seen + 1);
    s.processCount += 1;
    const accepted = emitSecuritySignal({
      // the ROOT tenant's decoys are the platform's (visible in ROOT only), as the intake maps ROOT's rows
      tenantId: touch.tenantId === ROOT_TENANT_ID ? null : touch.tenantId,
      lane: touch.lane ?? 'unknown',
      kind: touch.kind,
      actor: touch.actor,
      subject: touch.subject ?? null,
      outcome: touch.outcome ?? 'deny',
      severity: 'critical',
      attrs: touch.attrs,
      source: touch.source,
    });
    if (accepted) s.emitted += 1;
    return accepted;
  } catch {
    return false;
  }
}

/** This process's decoy touches since it started: handed to the intake, and left out by the bounds. */
export function honeytokenTouchStats(): { emitted: number; suppressed: number } {
  const s = touchState();
  return { emitted: s.emitted, suppressed: s.suppressed };
}

/** Test seam: forget the touch windows and counts. */
export function resetHoneytokenTouches(): void {
  touchHolder[TOUCH_STATE_KEY] = undefined;
}
