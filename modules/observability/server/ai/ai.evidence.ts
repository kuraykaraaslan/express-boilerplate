/**
 * The EVIDENCE BUNDLE of the investigator (phase 20.2): everything the model is allowed to reason from, as a numbered list. Every claim the
 * model makes must cite the id of an item in it (`ai.schema.ts` enforces that), and every item says what it is and where a person can open
 * it. The model sees nothing that is not in the bundle.
 *
 * Content: the incident itself, the alerts of its group, what changed in the hour before it started (phase 14), related telemetry through the
 * STRUCTURED query API of phase 18 (errors in logs, failed traces, a few metric series), SLO state, and similar past incidents (same alert
 * group or monitor; plus `search` when it is installed). Every text field is attacker-writable, so it goes through `hygiene.ts` here, before it
 * is ever put in a prompt: control and bidi characters out, secrets, e-mails and uuids replaced, length cut.
 *
 * Ids are `E1..En` in a fixed order, so the same sources always give the same bundle (the evaluation set depends on that).
 */
import { freeText } from '../hygiene';
import type { ChangeEvent } from '../incident.changes.service';
import type { LogRecord, MetricSeries, TraceSummary } from '../telemetry/telemetry.types';

export type EvidenceKind = 'incident' | 'alert' | 'change' | 'log' | 'trace' | 'metric' | 'slo' | 'similar_incident';

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  title: string;
  detail: string;
  at?: string;
  /** What the person opens to see the original: an incident, an alert, a trace id, a monitor. */
  ref?: { type: string; id: string };
}

export interface EvidenceBundle {
  incidentId: string;
  builtAt: string;
  items: EvidenceItem[];
  /** Source families that could not be read (telemetry not configured, module off, backend down). Part of the evidence: absence is a fact. */
  unavailable: string[];
}

export interface IncidentFacts { incidentId: string; title: string; severity: string; status: string; startedAt: Date | string; resolvedAt?: Date | string | null; reason?: string | null; monitorId?: string | null; alertGroupKey?: string | null }
export interface AlertFacts { alertId: string; title: string; severity: string; status: string; count: number; startsAt: Date | string; labels: Record<string, string>; annotations: Record<string, string> }
export interface SloFacts { sloId: string; name: string; state: string; currentBurn: number | null; remainingFraction: number | null }
export interface SimilarFacts { incidentId: string; title: string; severity: string; startedAt?: Date | string | null; durationMinutes: number | null; reason?: string | null; via: 'same_group' | 'same_monitor' | 'search' | 'embedding'; /** Text rank or cosine similarity, for the two similarity paths. */ score?: number }

export interface TelemetryFacts { logs: LogRecord[]; traces: TraceSummary[]; metrics: MetricSeries[] }

/** Where the bundle's facts come from. A source that cannot answer returns `null` (reported as unavailable), never throws. */
export interface EvidenceSources {
  incident(tenantId: string, incidentId: string): Promise<IncidentFacts | null>;
  alerts(tenantId: string, incidentId: string): Promise<AlertFacts[] | null>;
  changes(tenantId: string, from: Date, to: Date): Promise<ChangeEvent[] | null>;
  telemetry(tenantId: string, incident: IncidentFacts): Promise<TelemetryFacts | null>;
  slos(tenantId: string): Promise<SloFacts[] | null>;
  similar(tenantId: string, incident: IncidentFacts): Promise<SimilarFacts[] | null>;
}

export const MAX_EVIDENCE_ITEMS = 40;
const LIMITS = { alerts: 8, changes: 10, logs: 8, traces: 5, metrics: 3, slos: 3, similar: 4 } as const;
export const CHANGE_LOOKBACK_MS = 60 * 60_000;

const iso = (d: Date | string): string => new Date(d).toISOString();
const t = (s: unknown, n = 200) => freeText(s, n);
const labelsText = (l: Record<string, string> | undefined, max = 6) =>
  Object.entries(l ?? {}).slice(0, max).map(([k, v]) => `${t(k, 40)}=${t(v, 80)}`).join(', ');

/** Pure and deterministic: the facts in, the numbered bundle out. */
export function assembleBundle(input: {
  incident: IncidentFacts; alerts: AlertFacts[]; changes: ChangeEvent[]; telemetry: TelemetryFacts | null; slos: SloFacts[]; similar: SimilarFacts[]; unavailable: string[]; builtAt: Date;
}): EvidenceBundle {
  const items: Omit<EvidenceItem, 'id'>[] = [];
  const i = input.incident;
  items.push({
    kind: 'incident', title: `Incident: ${t(i.title)}`, at: iso(i.startedAt), ref: { type: 'incident', id: i.incidentId },
    detail: [`severity ${i.severity}`, `status ${i.status}`, `started ${iso(i.startedAt)}`, i.resolvedAt ? `resolved ${iso(i.resolvedAt)}` : null, i.reason ? `reason: ${t(i.reason, 200)}` : null].filter(Boolean).join('; '),
  });
  for (const a of input.alerts.slice(0, LIMITS.alerts)) {
    items.push({
      kind: 'alert', title: `Alert: ${t(a.title)}`, at: iso(a.startsAt), ref: { type: 'alert', id: a.alertId },
      detail: [`severity ${a.severity}`, `${a.status}`, `fired ${a.count}x`, labelsText(a.labels) && `labels ${labelsText(a.labels)}`, a.annotations?.summary ? `summary: ${t(a.annotations.summary, 160)}` : null].filter(Boolean).join('; '),
    });
  }
  for (const c of input.changes.slice(0, LIMITS.changes)) {
    items.push({ kind: 'change', title: `Change (${c.kind}): ${t(c.title)}`, at: c.at, detail: `${c.kind} by ${c.actor ? t(c.actor, 60) : 'unknown'} at ${c.at} (source ${t(c.source, 40)}${c.ref ? `, ref ${t(c.ref, 80)}` : ''})` });
  }
  const tel = input.telemetry;
  for (const l of (tel?.logs ?? []).slice(0, LIMITS.logs)) {
    const service = typeof l.resource?.['service.name'] === 'string' ? l.resource['service.name'] : 'unknown';
    items.push({ kind: 'log', title: `Log ${l.severity} from ${t(service, 60)}`, detail: t(l.body, 300), at: new Date(Number(l.timeNs.slice(0, -6) || 0)).toISOString(), ...(l.traceId ? { ref: { type: 'trace', id: l.traceId } } : {}) });
  }
  for (const tr of (tel?.traces ?? []).slice(0, LIMITS.traces)) {
    items.push({ kind: 'trace', title: `Failed trace: ${t(tr.rootName, 100)}`, at: new Date(tr.startMs).toISOString(), ref: { type: 'trace', id: tr.traceId }, detail: `${t(tr.rootService, 60)} ${t(tr.rootName, 100)} took ${tr.durationMs} ms${tr.errorCount ? `, ${tr.errorCount} error spans` : ''}` });
  }
  for (const m of (tel?.metrics ?? []).slice(0, LIMITS.metrics)) {
    const v = m.points.map((p) => p[1]).filter(Number.isFinite);
    if (!v.length) continue;
    items.push({ kind: 'metric', title: `Metric ${t(m.metric, 80)}`, detail: `${labelsText(m.labels, 4)} min ${Math.min(...v)} max ${Math.max(...v)} last ${v[v.length - 1]} over ${v.length} points` });
  }
  for (const s of input.slos.slice(0, LIMITS.slos)) {
    items.push({ kind: 'slo', title: `SLO ${t(s.name, 100)}`, ref: { type: 'slo', id: s.sloId }, detail: `budget ${s.state}${s.remainingFraction !== null ? `, ${Math.round(s.remainingFraction * 100)}% left` : ''}${s.currentBurn !== null ? `, burn ${s.currentBurn}` : ''}` });
  }
  for (const s of input.similar.slice(0, LIMITS.similar)) {
    items.push({
      kind: 'similar_incident', title: `Similar past incident: ${t(s.title)}`, ...(s.startedAt ? { at: iso(s.startedAt) } : {}), ref: { type: 'incident', id: s.incidentId },
      detail: [`matched by ${s.via.replace('_', ' ')}${s.score !== undefined ? ` (score ${Math.round(s.score * 100) / 100})` : ''}`, `severity ${s.severity}`, s.durationMinutes !== null ? `lasted ${s.durationMinutes} min` : null, s.reason ? `reason: ${t(s.reason, 200)}` : null].filter(Boolean).join('; '),
    });
  }
  return {
    incidentId: i.incidentId, builtAt: input.builtAt.toISOString(), unavailable: [...new Set(input.unavailable)].sort(),
    items: items.slice(0, MAX_EVIDENCE_ITEMS).map((it, n) => ({ id: `E${n + 1}`, ...it })),
  };
}

/** Read every source (in parallel, each failure contained) and assemble the bundle. `null` when the incident does not exist for this tenant. */
export async function buildEvidenceBundle(sources: EvidenceSources, tenantId: string, incidentId: string, now: Date = new Date()): Promise<EvidenceBundle | null> {
  const incident = await sources.incident(tenantId, incidentId);
  if (!incident) return null;
  const started = new Date(incident.startedAt);
  const to = incident.resolvedAt ? new Date(incident.resolvedAt) : now;
  const unavailable: string[] = [];
  const safe = async <T>(name: string, fn: () => Promise<T | null>): Promise<T | null> => {
    try { const v = await fn(); if (v === null) unavailable.push(name); return v; } catch { unavailable.push(name); return null; }
  };
  const [alerts, changes, telemetry, slos, similar] = await Promise.all([
    safe('alerts', () => sources.alerts(tenantId, incidentId)),
    safe('changes', () => sources.changes(tenantId, new Date(started.getTime() - CHANGE_LOOKBACK_MS), to)),
    safe('telemetry', () => sources.telemetry(tenantId, incident)),
    safe('slos', () => sources.slos(tenantId)),
    safe('similar_incidents', () => sources.similar(tenantId, incident)),
  ]);
  return assembleBundle({ incident, alerts: alerts ?? [], changes: changes ?? [], telemetry, slos: slos ?? [], similar: similar ?? [], unavailable, builtAt: now });
}
