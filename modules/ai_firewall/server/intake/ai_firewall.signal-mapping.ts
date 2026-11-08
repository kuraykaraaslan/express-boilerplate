/**
 * What the two hearing intakes turn into a `SecuritySignal` (docs/phases/55-ai-firewall/01 §1.4a, §1.4b). Pure functions: no I/O,
 * no imports of the modules heard (the record and event shapes are structural copies), so the edition rule holds (ADR-0008 §2).
 *
 * Kinds: an audit row keeps its action as the kind (`auth.login_failed`); a domain event becomes `event.<name>`, so the two never
 * register the same kind (1.5). The kinds are registered in `ai_firewall:signal` by the first contributions (1.6); until then the
 * fw:signals consumer (01 §1.7) stores every well-formed signal it hears; counting the unregistered kinds comes with the registry (1.5).
 *
 * The actor: the row's key, person or node; for the system's own rows, the record its kind declares (`systemRowActor`, D443); else the
 * address, else `anon`.
 *
 * Request-controlled strings (a user agent, a metadata value somebody typed, a payload field) are wrapped as `UntrustedText`.
 * The ROOT tenant's rows and events are platform signals (`tenantId` null, visible in ROOT only).
 */
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { LANES, type Lane } from '@kuraykaraaslan-labs/common/server/lane.policy';
import {
  untrusted,
  type ActorRef,
  type SecuritySignalInput,
  type SignalAttrValue,
  type SignalLane,
  type SignalOutcome,
  type SignalSeverity,
  type SystemRowActor,
  type SubjectRef,
  SIGNAL_ID_MAX,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

/** The audit row as audit_log's `record_sink` hands it (structurally the same as its `WrittenAuditRecord`). */
export interface HeardAuditRecord {
  tenantId: string;
  action: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  actorType: string;
  actorId: string | null;
  onBehalfOfActorId: string | null;
  actorTenantId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  nodeId: string | null;
  occurredAt: Date;
  sealed: boolean;
}

/** Metadata or payload fields copied into one signal at most. */
export const HEARD_FIELDS_MAX = 16;

/** Field names never copied, whatever their value (a careless caller's secret must not travel a second time). */
const SECRET_KEY_RE = /pass|secret|token|authorization|cookie|api[-_]?key|otp|private|signature|credential/i;

/** Domain-event payload fields copied: identifiers and codes only. A payload can carry a setting's value or a form, so it is an allow list. */
const EVENT_FIELD_RE = /^(id|[a-z][A-Za-z0-9]*Id|status|state|reason|type|kind|key|action|code|count|role)$/;

const DENY_TOKENS = new Set(['denied', 'refused', 'blocked', 'rejected', 'banned', 'locked', 'invalid', 'violation', 'throttled', 'forbidden', 'unauthorized']);
const FAIL_TOKENS = new Set(['fail', 'failed', 'failure', 'error']);

/** The outcome an action or event name implies: `fail` for a failure, `deny` for a refusal, `info` for everything else. */
export function outcomeOfName(name: string): SignalOutcome {
  const tokens = name.toLowerCase().split(/[._:-]/);
  if (tokens.some((t) => FAIL_TOKENS.has(t))) return 'fail';
  if (tokens.some((t) => DENY_TOKENS.has(t))) return 'deny';
  return 'info';
}

const platformOr = (tenantId: string): string | null => (tenantId === ROOT_TENANT_ID ? null : tenantId);
const fits = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= SIGNAL_ID_MAX;
const isLane = (v: unknown): v is Lane => typeof v === 'string' && (LANES as readonly string[]).includes(v);

/** Primitive fields of a bag, strings as untrusted, secrets and nested values left out, at most HEARD_FIELDS_MAX. */
function copyFields(
  bag: Readonly<Record<string, unknown>> | null | undefined, prefix: string, allow: (key: string) => boolean,
): Record<string, SignalAttrValue> {
  const out: Record<string, SignalAttrValue> = {};
  if (!bag || typeof bag !== 'object') return out;
  let n = 0;
  for (const [key, value] of Object.entries(bag)) {
    if (n >= HEARD_FIELDS_MAX) break;
    if (SECRET_KEY_RE.test(key) || !allow(key)) continue;
    let attr: SignalAttrValue | undefined;
    if (typeof value === 'string') attr = untrusted(value) ?? undefined;
    else if (typeof value === 'number' && Number.isFinite(value)) attr = value;
    else if (typeof value === 'boolean' || value === null) attr = value;
    if (attr === undefined) continue;
    out[`${prefix}${key}`] = attr;
    n += 1;
  }
  return out;
}

/** The kinds that declare `systemRowActor` (D443), by kind: built once from the signal catalogue (`systemRowActorsOf`). */
export type SystemRowActorMap = ReadonlyMap<string, SystemRowActor>;

/** The `systemRowActor` declarations of a signal catalogue, by kind. */
export function systemRowActorsOf(signals: Iterable<{ kind: string; systemRowActor?: SystemRowActor }>): SystemRowActorMap {
  const out = new Map<string, SystemRowActor>();
  for (const s of signals) if (s.systemRowActor) out.set(s.kind, s.systemRowActor);
  return out;
}

/** A row nobody acted in (no actor id, no node: the system's own): the only row a `systemRowActor` can apply to. */
export const isActorlessRow = (r: HeardAuditRecord): boolean => !fits(r.actorId) && !fits(r.nodeId);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id a `systemRowActor` names on an actorless row, or null (another subject type, a missing or malformed metadata value). */
function systemRowActorId(r: HeardAuditRecord, d: SystemRowActor): string | null {
  if (d.from === 'subject') return r.resourceType === d.subjectType && fits(r.resourceId) ? r.resourceId : null;
  const v = r.metadata?.[d.field];
  return typeof v === 'string' && UUID.test(v) ? v : null;
}

function auditActor(r: HeardAuditRecord, systemRowActors: SystemRowActorMap | null): ActorRef {
  if (r.actorType === 'API_KEY' && fits(r.actorId)) return { kind: 'apiKey', id: r.actorId };
  if (fits(r.actorId)) return { kind: 'user', id: r.actorId };
  if (fits(r.nodeId)) return { kind: 'node', id: r.nodeId };
  // D443: the kind names the record an actorless row is weighed against (a gateway's created or refused children fold on the gateway)
  const declared = systemRowActors?.get(r.action);
  const id = declared ? systemRowActorId(r, declared) : null;
  if (declared && id) return { kind: declared.kind, id };
  if (fits(r.ipAddress)) return { kind: 'ip', id: r.ipAddress };
  return { kind: 'anon', id: r.actorType === 'SYSTEM' ? 'system' : 'anonymous' };
}

function auditLane(r: HeardAuditRecord): SignalLane {
  const declared = r.metadata?.lane;
  if (isLane(declared)) return declared;
  if (r.actorType === 'API_KEY') return 'machine-apikey';
  if (!r.actorId && r.nodeId) return 'machine-agent';
  return 'unknown';
}

/**
 * An audit row as a signal. `systemRowActors`: the catalogue's `systemRowActor` declarations (D443); absent or null (the registry not
 * read yet or unreadable), an actorless row's actor is the address or `anon`, as before.
 */
export function auditRecordToSignal(r: HeardAuditRecord, systemRowActors: SystemRowActorMap | null = null): SecuritySignalInput {
  const subject: SubjectRef | null = fits(r.resourceType) && fits(r.resourceId) ? { type: r.resourceType, id: r.resourceId } : null;
  return {
    at: r.occurredAt,
    tenantId: platformOr(r.tenantId),
    lane: auditLane(r),
    kind: r.action,
    actor: auditActor(r, systemRowActors),
    subject,
    outcome: outcomeOfName(r.action),
    severity: r.severity as SignalSeverity,
    source: 'audit_log',
    attrs: {
      actorType: r.actorType,
      ip: r.ipAddress,
      userAgent: untrusted(r.userAgent),
      onBehalfOf: r.onBehalfOfActorId,
      actorTenantId: r.actorTenantId,
      sealed: r.sealed,
      ...copyFields(r.metadata, 'm.', (key) => key !== 'lane'),
    },
  };
}

const EVENT_ACTOR_KINDS: Record<string, ActorRef['kind']> = {
  user: 'user', api_key: 'apiKey', apikey: 'apiKey', session: 'session', device: 'device', node: 'node', ip: 'ip',
};

/** A dispatched domain event as a signal; null for the events the audit intake already hears (`audit.*`). */
export function domainEventToSignal(
  tenantId: string, event: string, payload: Readonly<Record<string, unknown>> | null | undefined,
  meta?: { actor?: { type: string; id: string } },
): SecuritySignalInput | null {
  if (event.startsWith('audit.')) return null;
  const a = meta?.actor;
  const kind = a ? EVENT_ACTOR_KINDS[String(a.type).toLowerCase()] : undefined;
  const actor: ActorRef = a && kind && fits(a.id) ? { kind, id: a.id } : { kind: 'anon', id: 'system' };
  const id = payload?.id;
  const entity = event.split('.')[0] ?? event;
  const subject: SubjectRef | null = fits(id) && fits(entity) ? { type: entity, id } : null;
  return {
    tenantId: platformOr(tenantId),
    lane: 'unknown',
    kind: `event.${event}`,
    actor,
    subject,
    outcome: outcomeOfName(event),
    severity: 'info',
    source: 'webhook',
    attrs: copyFields(payload, 'p.', (key) => EVENT_FIELD_RE.test(key)),
  };
}
