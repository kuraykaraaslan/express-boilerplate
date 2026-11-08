/**
 * The firewall's store (docs/phases/55-ai-firewall/01 §1.7): the three tables, how a signal becomes an event row, how the platform is
 * stored, and the life of an action. Pure: no I/O, no imports of the database, so the consumer, the retention job, the export and the
 * tests share one definition.
 *
 *   ai_firewall_events     one row per stored SecuritySignal (append-only; a TimescaleDB hypertable through `db:time_series` where
 *                          TimescaleDB is present, a plain table with the batched-delete retention otherwise). Key
 *                          ("tenantId", "at", "signalId"): the tenant first and the time column in it (the db:time_series key
 *                          contract), the signal id so a redelivered stream entry is stored once.
 *   ai_firewall_incidents  one row per incident (03): an actor's signals grouped into one case, open until closed.
 *   ai_firewall_actions    one row per proposal of a registered action (05): proposed -> executed -> undone / expired, or rejected,
 *                          refused, failed, noop.
 *
 * The platform: a signal's `tenantId` null (the ROOT tenant's own rows and platform events) is stored under the ROOT tenant's id. The
 * hypertable's key cannot hold a NULL tenant, and the tenant policy pair (`"tenantId" = app_current_tenant()`) shows a ROOT-tenant row
 * to the ROOT tenant only, where a NULL row would be visible to every RLS-bypassing system read and to no tenant at all. Readers map
 * the ROOT id back to null (`signalTenantOf`), so the contract's "null = platform" holds on both sides of the store.
 */
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { SecuritySignal, SignalAttrs } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

export const EVENTS_TABLE = 'ai_firewall_events';
export const INCIDENTS_TABLE = 'ai_firewall_incidents';
export const ACTIONS_TABLE = 'ai_firewall_actions';
export const STORE_TABLES = [EVENTS_TABLE, INCIDENTS_TABLE, ACTIONS_TABLE] as const;

/** The hypertable's chunk size and its platform-wide retention backstop (chunk drop): the longest a tenant may keep events. */
export const EVENTS_CHUNK_INTERVAL = '1 day';
export const EVENTS_MAX_RETENTION_DAYS = 365;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** The tenant a signal is stored under: its own, or the ROOT tenant for the platform. null when its tenant id is not a uuid. */
export function storeTenantOf(signalTenantId: string | null): string | null {
  if (signalTenantId === null) return ROOT_TENANT_ID;
  return isUuid(signalTenantId) ? signalTenantId.toLowerCase() : null;
}

/** The contract's tenant of a stored row: null (platform) for the ROOT tenant. */
export function signalTenantOf(storedTenantId: string): string | null {
  return storedTenantId.toLowerCase() === ROOT_TENANT_ID ? null : storedTenantId;
}

/** One `ai_firewall_events` row, as the consumer writes it (column order = EVENT_COLUMNS). */
export interface EventRow {
  tenantId: string;
  at: string;
  signalId: string;
  lane: string;
  kind: string;
  actorKind: string;
  actorId: string;
  subjectType: string | null;
  subjectId: string | null;
  outcome: string;
  severity: string;
  attrs: SignalAttrs;
  source: string;
}

export const EVENT_COLUMNS = [
  'tenantId', 'at', 'signalId', 'lane', 'kind', 'actorKind', 'actorId', 'subjectType', 'subjectId', 'outcome', 'severity', 'attrs', 'source',
] as const satisfies readonly (keyof EventRow)[];

/** A checked signal as its row; null when its tenant cannot be stored (not a uuid). */
export function signalToEventRow(signal: SecuritySignal): EventRow | null {
  const tenantId = storeTenantOf(signal.tenantId);
  if (!tenantId) return null;
  return {
    tenantId,
    at: signal.at,
    signalId: signal.id,
    lane: signal.lane,
    kind: signal.kind,
    actorKind: signal.actor.kind,
    actorId: signal.actor.id,
    subjectType: signal.subject?.type ?? null,
    subjectId: signal.subject?.id ?? null,
    outcome: signal.outcome,
    severity: signal.severity,
    attrs: signal.attrs,
    source: signal.source,
  };
}

/* ───────────────────────────── Incidents and actions ───────────────────────────── */

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * The life of one action proposal (05). `proposed` waits for a person (Suggest) or for the responder (Auto); `executed` holds until
 * its TTL ends (`expired`) or someone undoes it (`undone`). `rejected` (a person said no), `refused` (the owning module would not),
 * `failed` (it tried and could not) and `noop` (nothing to do) end a proposal without a change.
 */
export const ACTION_STATUSES = ['proposed', 'executed', 'undone', 'expired', 'rejected', 'refused', 'failed', 'noop'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

const TRANSITIONS: Readonly<Record<ActionStatus, readonly ActionStatus[]>> = {
  proposed: ['executed', 'rejected', 'refused', 'failed', 'noop', 'expired'],
  executed: ['undone', 'expired'],
  undone: [],
  expired: [],
  rejected: [],
  refused: [],
  failed: [],
  noop: [],
};

/** Whether an action may move from `from` to `to` (an ended action never moves again; undo is only of an executed one). */
export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** The statuses an action ends in: only these are ever deleted by the retention, and only once `endedAt` is past the cutoff. */
export const TERMINAL_ACTION_STATUSES: readonly ActionStatus[] = ACTION_STATUSES.filter((s) => TRANSITIONS[s].length === 0);
export const isTerminalAction = (s: string): boolean => (TERMINAL_ACTION_STATUSES as readonly string[]).includes(s);
