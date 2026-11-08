import 'reflect-metadata';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { accessRel } from '@kuraykaraaslan-labs/db/server/db.time-series.rollup';
import { rowsOf } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { ExportCollection, ExportCollectionProvider } from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { isUntrustedText } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { AiFirewallIncident } from './entities/ai_firewall_incident.entity';
import { AiFirewallAction } from './entities/ai_firewall_action.entity';
import { AiFirewallBaseline } from './entities/ai_firewall_baseline.entity';
import { AiFirewallLabel } from './entities/ai_firewall_label.entity';
import { EVENTS_TABLE } from './store/ai_firewall.store';
import { PERSON_ACTOR_KINDS, isPersonFreeAttr, isPersonSubjectType, loadAttrClasses, type AttrClasses } from './ai_firewall.personal-data';

/**
 * `tenant_export:collection`: the tenant's AI firewall store (docs/phases/55-ai-firewall/01 §1.7), three collections:
 *
 *   aiFirewallEvents     the newest EXPORT_EVENTS_MAX stored security events (the table holds at most the tenant's retention, default
 *                        90 days; a busier tenant gets the newest ones, like the audit log's cap in the export);
 *   aiFirewallIncidents  every incident (02 §2.4: its score timeline and explanation hold feature names and numbers only, never an id);
 *   aiFirewallActions    every action proposal, its undo data included (non-secret by contract);
 *   aiFirewallBaselines  every actor baseline and role prior of the feature store (02 §2.1): pseudonymous (the keyed hash of the actor's
 *                        id), with the usual hours, countries, ASNs, devices and volumes;
 *   aiFirewallLabels     every label (03 §3.1): the incident or event it is about, the labelled actor, the class, verdict, source,
 *                        confidence and who labelled it.
 *
 * One read snapshot in the tenant's scope (RLS; the events through the time-series access view). The actor's address is written as
 * `ipAddress`, the field name tenant_export's PII redaction knows. With `redactPii` this provider redacts by the personal-data classes
 * the kinds declared in `ai_firewall:signal` (ai_firewall.personal-data.ts), since the generic redaction matches only a few field names:
 * an event keeps only the attributes its kind declared `none` (an unregistered kind, an undeclared attribute or an unloadable registry
 * keeps none), the id of a person or credential actor (user, session, API key) or of an address actor becomes `[redacted]`, so does a
 * person subject's id and the user id of whoever acknowledged or closed an incident or decided or undid an action (`acknowledgedBy`,
 * `closedBy`, `decidedBy`, `undoneBy`, D55-19), and an action proposal loses its undo data (a user id, an address, a key id); a baseline loses its actor key and
 * its countries, ASNs and devices (location, network, device; D55-27); a label loses its actor's id (a person, a credential, an address)
 * and its labeller (`labelledBy`, a decider like the others).
 * For the ROOT tenant the collections are the platform's own rows.
 */
export const EXPORT_EVENTS_MAX = 10_000;
export const EXPORT_ROWS_MAX = 10_000;
export const EXPORT_COLLECTIONS = ['aiFirewallEvents', 'aiFirewallIncidents', 'aiFirewallActions', 'aiFirewallBaselines', 'aiFirewallLabels'] as const;

const REDACTED = '[redacted]';

/** Whether an actor's id is redacted: a person, a person's credential or an address. */
const redactedActor = (kind: string): boolean => kind === 'ip' || PERSON_ACTOR_KINDS.has(kind);

interface EventDbRow {
  at: Date | string;
  signalId: string;
  lane: string;
  kind: string;
  actorKind: string;
  actorId: string;
  subjectType: string | null;
  subjectId: string | null;
  outcome: string;
  severity: string;
  attrs: Record<string, unknown> | null;
  source: string;
}

const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : isUntrustedText(v) ? v.text : null);

/** One stored event as an export row (pure). `classes`: the registry's attribute classes (empty = nothing classified, all dropped). */
export function exportEventRow(r: EventDbRow, redactPii: boolean, classes: AttrClasses = new Map()): Record<string, unknown> {
  const attrs = { ...(r.attrs ?? {}) };
  const address = r.actorKind === 'ip' ? r.actorId : textOf(attrs.ip);
  if (redactPii) for (const key of Object.keys(attrs)) if (!isPersonFreeAttr(classes, r.kind, key)) delete attrs[key];
  return {
    at: new Date(r.at).toISOString(),
    signalId: r.signalId,
    lane: r.lane,
    kind: r.kind,
    actorKind: r.actorKind,
    actorId: redactPii && redactedActor(r.actorKind) ? REDACTED : r.actorId,
    ipAddress: address,
    subjectType: r.subjectType,
    subjectId: redactPii && r.subjectId && isPersonSubjectType(r.subjectType) ? REDACTED : r.subjectId,
    outcome: r.outcome,
    severity: r.severity,
    source: r.source,
    attrs,
  };
}

/**
 * The user ids of the people who decided on a record: an incident's `closedBy` and `acknowledgedBy` (02 §2.4), an action's `decidedBy` and
 * `undoneBy` (D55-19), a label's `labelledBy` (03 §3.1).
 */
export const DECIDER_COLUMNS = ['closedBy', 'acknowledgedBy', 'decidedBy', 'undoneBy', 'labelledBy'] as const;

/**
 * An incident or action row under `redactPii` (pure): the actor's id, a person subject's id, the deciders' user ids (closed, decided,
 * undone by) and an action's undo data. A decider that is empty stays empty.
 */
export function redactStoreRow<T extends { actorKind: string; actorId: string; subjectType?: string | null; subjectId?: string | null; undoData?: unknown }>(
  row: T, redactPii: boolean,
): T {
  if (!redactPii) return row;
  const out: Record<string, unknown> = { ...row };
  if (redactedActor(row.actorKind)) out.actorId = REDACTED;
  if (row.subjectId && isPersonSubjectType(row.subjectType)) out.subjectId = REDACTED;
  for (const column of DECIDER_COLUMNS) if (out[column] != null && out[column] !== '') out[column] = REDACTED;
  if (row.undoData != null) out.undoData = null;
  return out as T;
}

/**
 * A baseline row under `redactPii` (pure): an actor's key (a keyed hash, still a link to the person inside the installation) and its
 * countries, ASNs and devices go; a role prior keeps its role name. Without `redactPii` nothing is taken out.
 */
export function redactBaselineRow<T extends { actorKind: string; actorKey: string; data?: unknown }>(row: T, redactPii: boolean): T {
  if (!redactPii) return row;
  const out: Record<string, unknown> = { ...row };
  if (row.actorKind !== 'role') out.actorKey = REDACTED;
  if (row.data && typeof row.data === 'object') {
    const { countries: _c, asns: _a, devices: _d, ...rest } = row.data as Record<string, unknown>;
    out.data = rest;
  }
  return out as T;
}

const provider: ExportCollectionProvider = async (tenantId: string, options: { redactPii: boolean }): Promise<ExportCollection[]> => {
  const redactPii = options?.redactPii === true;
  const classes: AttrClasses = redactPii ? await loadAttrClasses() : new Map();
  return withTenantTransactionFor(tenantId, async (qr) => {
    const rel = await accessRel(qr, EVENTS_TABLE);
    const events = rowsOf<EventDbRow>(await qr.query(
      `SELECT "at", "signalId", "lane", "kind", "actorKind", "actorId", "subjectType", "subjectId", "outcome", "severity", "attrs", "source"
         FROM ${rel} WHERE "tenantId" = $1 ORDER BY "at" DESC LIMIT $2`,
      [tenantId, EXPORT_EVENTS_MAX],
    ));
    const incidents = await qr.manager.getRepository(AiFirewallIncident).find({ where: { tenantId }, order: { openedAt: 'DESC' }, take: EXPORT_ROWS_MAX });
    const actions = await qr.manager.getRepository(AiFirewallAction).find({ where: { tenantId }, order: { proposedAt: 'DESC' }, take: EXPORT_ROWS_MAX });
    const baselines = await qr.manager.getRepository(AiFirewallBaseline).find({ where: { tenantId }, order: { updatedAt: 'DESC' }, take: EXPORT_ROWS_MAX });
    const labels = await qr.manager.getRepository(AiFirewallLabel).find({ where: { tenantId }, order: { labelledAt: 'DESC' }, take: EXPORT_ROWS_MAX });
    return [
      { key: 'aiFirewallEvents', label: 'AI firewall: security events', rows: events.map((r) => exportEventRow(r, redactPii, classes)) },
      { key: 'aiFirewallIncidents', label: 'AI firewall: incidents', rows: incidents.map((r) => redactStoreRow(r, redactPii)) },
      { key: 'aiFirewallActions', label: 'AI firewall: actions', rows: actions.map((r) => redactStoreRow(r, redactPii)) },
      { key: 'aiFirewallBaselines', label: 'AI firewall: baselines', rows: baselines.map((r) => redactBaselineRow(r, redactPii)) },
      { key: 'aiFirewallLabels', label: 'AI firewall: labels', rows: labels.map((r) => redactStoreRow(r, redactPii)) },
    ];
  });
};

export default provider;
