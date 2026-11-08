import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { firewallSignalLabelKey, isUntrustedText } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';
import { EVENTS_TABLE, INCIDENTS_TABLE } from './store/ai_firewall.store';
import { INCIDENT_SELECT, defaultIncidentStoreDeps, recordOf } from './incidents/ai_firewall.incident-store';
import { transitionOf, type IncidentChange, type IncidentRecord } from './incidents/ai_firewall.incident-model';
import {
  ACTOR_EVENTS_DAYS, ACTOR_INCIDENTS_MAX, INCIDENT_LIST_MAX, TIMELINE_EVENTS_MAX, TIMELINE_LEAD_MS,
  type ActorView, type IncidentChangeResult, type IncidentDetail, type IncidentLabelResult, type IncidentList, type IncidentRow,
  type TimelineEvent,
} from './ai_firewall.incident.types';
import { incidentLabelOf, type IncidentLabel, type IncidentVerdictInput, type LabelWrite } from './labels/ai_firewall.label-model';
import { readIncidentLabel, upsertIncidentLabel, withdrawFalsePositive } from './labels/ai_firewall.label-store';

/**
 * The incident pages' service (docs/phases/55-ai-firewall/02 §2.4): the list, one incident with its timeline, an actor's view, and a
 * person's acknowledge / resolve / reopen. Every read and write is in the URL tenant's own transaction (RLS: a tenant sees only its own
 * rows). Placement (D55-24, FWO-5 open): a customer tenant's incidents are its own people, sessions, keys and devices; the platform's
 * (addresses, anonymous callers, ROOT actors) are stored under the ROOT tenant and therefore listed in ROOT only. An actor view of an
 * address or an anonymous caller is ROOT's alone (`AI_FIREWALL_PLATFORM_ACTOR` elsewhere).
 *
 * The timeline reads the actor's stored events in the incident's own tenant only; the events an address left in customer tenants are
 * theirs and are not read across tenants here (no RLS bypass behind a page, D55-40). The incident's own score history and explanation
 * say why it was flagged.
 *
 * Feedback (03 §3.2, D55-78): a person's verdict on an incident (true positive with its class, false positive, unsure) is its label of
 * source `admin` in `ai_firewall_labels`, one per incident (a later verdict replaces it), written in the same transaction and audited as
 * `ai_firewall.incident_labelled`. The false alarm close (D55-43) writes the false-positive label with the close; reopening an incident
 * closed as a false alarm withdraws it (D55-79). Who may change an incident may label it (D55-40).
 */
export const AUDIT_INCIDENT_STATUS_CHANGED = 'ai_firewall.incident_status_changed';
export const AUDIT_INCIDENT_LABELLED = 'ai_firewall.incident_labelled';

const PLATFORM_ACTOR_KINDS = new Set(['ip', 'anon']);
const DAY_MS = 24 * 60 * 60 * 1000;

const refuse = (status: number, code: ErrorCode, reason: string, message: string) => new AppError(message, status, code, { details: { reason } });

export interface IncidentServiceDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  /** The label key of each registered kind (null when the registry cannot be read: the page shows the bare kind). */
  labelKeys: () => Promise<ReadonlyMap<string, string> | null>;
  audit: (input: Record<string, unknown>) => Promise<void>;
  now: () => number;
}

async function registeredLabelKeys(): Promise<ReadonlyMap<string, string> | null> {
  try {
    const { firewallRegistry } = await import('./registry/ai_firewall.registry');
    const verdict = await firewallRegistry();
    return new Map([...verdict.catalog.signals.values()].map((s) => [s.kind, firewallSignalLabelKey(s.moduleId, s.kind, s.labelKey)] as const));
  } catch {
    return null;
  }
}

/** The database is imported on first use (the pure row shapers load without a connection). */
const defaultDeps: IncidentServiceDeps = {
  inTenant: defaultIncidentStoreDeps.inTenant,
  accessRel: async (db, table) => (await import('@kuraykaraaslan-labs/db/server/db.time-series.rollup')).accessRel(db, table),
  labelKeys: registeredLabelKeys,
  audit: async (input) => {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log(input as never);
  },
  now: () => Date.now(),
};

/** The list row of an incident record (pure). */
export function incidentRowOf(r: IncidentRecord): IncidentRow {
  const detectors = Object.entries(r.detections ?? {})
    .sort(([, a], [, b]) => (b?.maxStrength ?? 0) - (a?.maxStrength ?? 0))
    .map(([id]) => id);
  return {
    incidentId: r.incidentId,
    status: r.status,
    severity: r.severity,
    actorKind: r.actorKind,
    actorId: r.actorId,
    lane: r.lane,
    score: r.score,
    peakScore: r.peakScore,
    reason: r.reason,
    detectors,
    openedAt: r.openedAt,
    lastSignalAt: r.lastSignalAt,
    closedAt: r.closedAt,
    closeReason: r.closeReason,
    acknowledgedAt: r.acknowledgedAt,
    platform: r.platform,
    alertsOnly: r.alertsOnly,
    scorings: r.scorings,
    models: {
      behaviour: r.models?.behaviour?.peak.score ?? null,
      attack: r.models?.attack?.peak.score ?? null,
      attackClass: r.models?.attack?.peak.attackClass ?? null,
    },
  };
}

interface EventDbRow {
  at: Date | string;
  signalId: string;
  kind: string;
  outcome: string;
  severity: string;
  lane: string;
  source: string;
  actorKind: string;
  subjectType: string | null;
  ip: unknown;
}

const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : isUntrustedText(v) ? v.text : null);

/**
 * A stored event as a timeline entry (pure): no attribute but the address it carried, the kind's label key from the registry. The address
 * only with `withAddress` (the actor view, read with `ai_firewall.events.read`); an incident's timeline is read with
 * `ai_firewall.incidents.read`, which does not open the people's addresses (D55-40).
 */
export function timelineEventOf(r: EventDbRow, labelKeys: ReadonlyMap<string, string> | null, withAddress = false): TimelineEvent {
  return {
    signalId: r.signalId,
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    labelKey: labelKeys?.get(r.kind) ?? r.kind,
    outcome: r.outcome,
    severity: r.severity,
    lane: r.lane,
    source: r.source,
    subjectType: r.subjectType,
    ip: withAddress && r.actorKind !== 'ip' ? textOf(r.ip) : null,
  };
}

export const countKinds = (events: readonly TimelineEvent[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of events) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
};

const EVENTS_OF_ACTOR = (rel: string) => `SELECT "at", "signalId", "kind", "outcome", "severity", "lane", "source", "actorKind", "subjectType",
    "attrs" -> 'ip' AS "ip"
  FROM ${rel} WHERE "tenantId" = $1 AND "actorKind" = $2 AND "actorId" = $3 AND "at" >= $4::timestamptz AND "at" <= $5::timestamptz
  ORDER BY "at" DESC LIMIT $6`;

async function eventsOf(
  db: SqlRunner, deps: IncidentServiceDeps, tenantId: string, actorKind: string, actorId: string, from: Date, to: Date,
): Promise<{ events: EventDbRow[]; truncated: boolean }> {
  const rel = await deps.accessRel(db, EVENTS_TABLE);
  const rows = rowsOf<EventDbRow>(await db.query(EVENTS_OF_ACTOR(rel), [tenantId, actorKind, actorId, from.toISOString(), to.toISOString(), TIMELINE_EVENTS_MAX + 1]));
  return { events: rows.slice(0, TIMELINE_EVENTS_MAX), truncated: rows.length > TIMELINE_EVENTS_MAX };
}

const notFound = () => refuse(404, ErrorCode.NOT_FOUND, 'AI_FIREWALL_INCIDENT_NOT_FOUND', 'No such incident in this workspace.');

/** A label as the drawer shows it, from what was written. */
const viewOf = (w: LabelWrite): IncidentLabel => ({
  verdict: w.verdict!, labelClass: w.labelClass, confidence: w.confidence, labelledBy: w.labelledBy, labelledAt: w.labelledAt,
});

/** Postgres `unique_violation` (23505), as the driver or TypeORM's QueryFailedError carries it. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; driverError?: { code?: unknown } } | null;
  return !!e && (e.code === '23505' || e.driverError?.code === '23505');
}

export function createIncidentService(deps: IncidentServiceDeps = defaultDeps) {
  return {
    /** The tenant's incidents, the newest activity first, at most INCIDENT_LIST_MAX. */
    async list(tenantId: string): Promise<IncidentList> {
      const rows = await deps.inTenant(tenantId, async (db) => rowsOf<Record<string, unknown>>(await db.query(
        `SELECT ${INCIDENT_SELECT} FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1 ORDER BY "lastSignalAt" DESC LIMIT $2`,
        [tenantId, INCIDENT_LIST_MAX + 1],
      )));
      const incidents = rows.slice(0, INCIDENT_LIST_MAX).map((r) => incidentRowOf(recordOf(r)!));
      return { platform: isRootTenant(tenantId), incidents, truncated: rows.length > INCIDENT_LIST_MAX };
    },

    /** One incident with its timeline: its score history and explanation, and the actor's stored events around it. 404 elsewhere. */
    async detail(tenantId: string, incidentId: string): Promise<IncidentDetail> {
      const labelKeys = await deps.labelKeys();
      return deps.inTenant(tenantId, async (db) => {
        const r = recordOf(rowsOf<Record<string, unknown>>(await db.query(
          `SELECT ${INCIDENT_SELECT} FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1 AND "incidentId" = $2`, [tenantId, incidentId],
        ))[0]);
        if (!r) throw notFound();
        const from = new Date(Date.parse(r.openedAt) - TIMELINE_LEAD_MS);
        const to = new Date(Math.max(Date.parse(r.closedAt ?? r.lastSignalAt), Date.parse(r.lastSignalAt)) + 60_000);
        const { events, truncated } = await eventsOf(db, deps, tenantId, r.actorKind, r.actorId, from, to);
        const timeline = events.map((e) => timelineEventOf(e, labelKeys, false));
        const label = await readIncidentLabel(db, tenantId, incidentId);
        return {
          incident: {
            ...incidentRowOf(r),
            closedBy: r.closedBy,
            acknowledgedBy: r.acknowledgedBy,
            coldStart: r.coldStart,
            detections: r.detections,
            explanation: r.explanation,
            history: r.history,
            modelTracks: r.models ?? null,
          },
          events: timeline,
          eventsTruncated: truncated,
          kinds: countKinds(timeline),
          label,
        };
      });
    },

    /** An actor's incidents and recent events in the tenant. An address or anonymous caller only in ROOT (D55-24). */
    async actor(tenantId: string, kind: string, id: string): Promise<ActorView> {
      if (PLATFORM_ACTOR_KINDS.has(kind) && !isRootTenant(tenantId)) {
        throw refuse(404, ErrorCode.NOT_FOUND, 'AI_FIREWALL_PLATFORM_ACTOR', 'Addresses and anonymous callers are the platform\'s; they are shown on the root tenant.');
      }
      const labelKeys = await deps.labelKeys();
      const now = deps.now();
      return deps.inTenant(tenantId, async (db) => {
        const rows = rowsOf<Record<string, unknown>>(await db.query(
          `SELECT ${INCIDENT_SELECT} FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1 AND "actorKind" = $2 AND "actorId" = $3
            ORDER BY "lastSignalAt" DESC LIMIT $4`,
          [tenantId, kind, id, ACTOR_INCIDENTS_MAX],
        ));
        const { events, truncated } = await eventsOf(db, deps, tenantId, kind, id, new Date(now - ACTOR_EVENTS_DAYS * DAY_MS), new Date(now + 60_000));
        const timeline = events.map((e) => timelineEventOf(e, labelKeys, true));
        return {
          actor: { kind, id },
          incidents: rows.map((r) => incidentRowOf(recordOf(r)!)),
          events: timeline,
          eventsTruncated: truncated,
          kinds: countKinds(timeline),
        };
      });
    },

    /**
     * A person's acknowledge, resolve (resolved or a false alarm) or reopen. 404 an incident of another tenant or none; 409 a closed
     * incident acknowledged or resolved, an active one reopened, or a reopen while the actor has another active incident (the grouping
     * opened a new one meanwhile). Acknowledging an acknowledged incident changes and audits nothing. A change writes the audit row
     * `ai_firewall.incident_status_changed` (best effort, after the write; also a signal kind of this module). A false alarm also writes the
     * incident's false-positive label in the same transaction (03 §3.2); a reopen of an incident closed as a false alarm withdraws it.
     */
    async change(tenantId: string, incidentId: string, change: IncidentChange, actorId: string | null): Promise<IncidentChangeResult> {
      const now = new Date(deps.now()).toISOString();
      const result = await deps.inTenant(tenantId, async (db) => {
        const r = recordOf(rowsOf<Record<string, unknown>>(await db.query(
          `SELECT ${INCIDENT_SELECT} FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1 AND "incidentId" = $2 FOR UPDATE`, [tenantId, incidentId],
        ))[0]);
        if (!r) throw notFound();
        const t = transitionOf(r.status, change);
        if (!t.ok) {
          throw refuse(409, ErrorCode.CONFLICT, t.reason, t.reason === 'AI_FIREWALL_INCIDENT_CLOSED'
            ? 'This incident is closed; reopen it first.'
            : 'This incident is not closed.');
        }
        if (!t.changed) return { from: r.status, next: r, changed: false, label: undefined };
        let next: IncidentRecord;
        let label: IncidentLabel | null | undefined;
        if (change.action === 'acknowledge') {
          await db.query(
            `UPDATE "${INCIDENTS_TABLE}" SET "status" = 'acknowledged', "acknowledgedAt" = $3::timestamptz, "acknowledgedBy" = $4, "updatedAt" = now()
              WHERE "tenantId" = $1 AND "incidentId" = $2`,
            [tenantId, incidentId, now, actorId],
          );
          next = { ...r, status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: actorId };
        } else if (change.action === 'resolve') {
          await db.query(
            `UPDATE "${INCIDENTS_TABLE}" SET "status" = 'closed', "closedAt" = $3::timestamptz, "closedBy" = $4, "closeReason" = $5, "updatedAt" = now()
              WHERE "tenantId" = $1 AND "incidentId" = $2`,
            [tenantId, incidentId, now, actorId, change.closeReason],
          );
          next = { ...r, status: 'closed', closedAt: now, closedBy: actorId, closeReason: change.closeReason };
          if (change.closeReason === 'false_positive') {
            const write = incidentLabelOf(r, { verdict: 'false_positive' }, actorId, now);
            await upsertIncidentLabel(db, write);
            label = viewOf(write);
          }
        } else {
          const other = rowsOf(await db.query(
            `SELECT 1 FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1 AND "actorKind" = $2 AND "actorId" = $3 AND "status" IN ('open', 'acknowledged') LIMIT 1`,
            [tenantId, r.actorKind, r.actorId],
          ));
          const activeExists = () =>
            refuse(409, ErrorCode.CONFLICT, 'AI_FIREWALL_INCIDENT_ACTIVE_EXISTS', 'This actor has a newer open incident; work on that one.');
          if (other.length > 0) throw activeExists();
          // A reopen counts as activity: the quiet window starts again, or the nightly run would close it as expired at once.
          const last = Date.parse(now) > Date.parse(r.lastSignalAt) ? now : r.lastSignalAt;
          try {
            await db.query(
              `UPDATE "${INCIDENTS_TABLE}" SET "status" = 'open', "closedAt" = NULL, "closedBy" = NULL, "closeReason" = NULL,
                "lastSignalAt" = $3::timestamptz, "updatedAt" = now() WHERE "tenantId" = $1 AND "incidentId" = $2`,
              [tenantId, incidentId, last],
            );
          } catch (error) {
            // A worker's recorder opened an active incident for the actor between the check and this write: the one-active index
            // (`uq_ai_firewall_incidents_active`) refuses the reopen, which is the same answer as the check's (the transaction rolls back).
            if (isUniqueViolation(error)) throw activeExists();
            throw error;
          }
          next = { ...r, status: 'open', closedAt: null, closedBy: null, closeReason: null, lastSignalAt: last };
          // The false alarm's label went with the close; the case is open again, so the verdict is withdrawn (D55-79).
          if (r.closeReason === 'false_positive' && (await withdrawFalsePositive(db, tenantId, incidentId))) label = null;
        }
        return { from: r.status, next, changed: true, label };
      });
      if (result.changed) {
        try {
          await deps.audit({
            tenantId,
            actorId,
            actorType: actorId ? 'USER' : 'SYSTEM',
            action: AUDIT_INCIDENT_STATUS_CHANGED,
            severity: change.action === 'resolve' && change.closeReason === 'false_positive' ? 'medium' : 'low',
            resourceType: 'ai_firewall_incident',
            resourceId: incidentId,
            metadata: {
              from: result.from,
              to: result.next.status,
              ...(change.action === 'resolve' ? { closeReason: change.closeReason } : {}),
              actorKind: result.next.actorKind,
            },
          });
        } catch (error) {
          Logger.warn(`[ai_firewall] incident change audit failed tenant=${tenantId} incident=${incidentId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return {
        incident: incidentRowOf(result.next),
        changed: result.changed,
        ...(result.label !== undefined ? { label: result.label } : {}),
      };
    },

    /**
     * A person's verdict on an incident (03 §3.2, D55-78): true positive with its class, false positive or unsure, as the incident's label
     * of source admin (a later verdict replaces the earlier one; the incident's status does not change). 404 an incident of another
     * tenant or none. The same verdict and class again writes and audits nothing. A change writes the audit row
     * `ai_firewall.incident_labelled` (best effort, after the write; also a signal kind of this module: calling real attacks false
     * alarms is what an attacker with an admin account would do, so a false positive is audited at medium severity).
     */
    async label(tenantId: string, incidentId: string, input: IncidentVerdictInput, actorId: string | null): Promise<IncidentLabelResult> {
      const now = new Date(deps.now()).toISOString();
      const result = await deps.inTenant(tenantId, async (db) => {
        const r = recordOf(rowsOf<Record<string, unknown>>(await db.query(
          `SELECT ${INCIDENT_SELECT} FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1 AND "incidentId" = $2 FOR UPDATE`, [tenantId, incidentId],
        ))[0]);
        if (!r) throw notFound();
        const previous = await readIncidentLabel(db, tenantId, incidentId);
        const write = incidentLabelOf(r, input, actorId, now);
        if (previous && previous.verdict === write.verdict && previous.labelClass === write.labelClass) {
          return { record: r, previous, label: previous, changed: false };
        }
        await upsertIncidentLabel(db, write);
        return { record: r, previous, label: viewOf(write), changed: true };
      });
      if (result.changed) {
        try {
          await deps.audit({
            tenantId,
            actorId,
            actorType: actorId ? 'USER' : 'SYSTEM',
            action: AUDIT_INCIDENT_LABELLED,
            severity: input.verdict === 'false_positive' ? 'medium' : 'low',
            resourceType: 'ai_firewall_incident',
            resourceId: incidentId,
            metadata: {
              verdict: result.label.verdict,
              labelClass: result.label.labelClass,
              ...(result.previous ? { previousVerdict: result.previous.verdict } : {}),
              actorKind: result.record.actorKind,
            },
          });
        } catch (error) {
          Logger.warn(`[ai_firewall] incident label audit failed tenant=${tenantId} incident=${incidentId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { label: result.label, changed: result.changed };
    },
  };
}

const AiFirewallIncidentService = createIncidentService();
export default AiFirewallIncidentService;
