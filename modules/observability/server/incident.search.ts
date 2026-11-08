/**
 * Incidents in the `search` module (observability phase 20.2, work order 2 item 2): every incident is indexed under entity type `incident` when
 * it opens, when it is edited and when it resolves, so that "similar past incidents" has something to retrieve. Without this nothing ever wrote
 * an `incident` document and the lookup returned nothing.
 *
 *  - Best effort and silent: `search` is optional, and an indexing failure never reaches the code that opened or resolved an incident.
 *  - The document is the incident's own words: title, reason, severity, the monitor's name, the titles and labels of the alerts of its group, and
 *    the root cause of its post-mortem. Control characters and secrets are removed before anything is stored (`cleanText`).
 *  - The metadata carries what a similar-incident hit needs without a second read (status, severity, when it started and resolved).
 *  - `backfillIncidentIndex` walks one tenant's incidents in pages (idempotent: an upsert per incident), for incidents that predate this code.
 *  - `similarityQuery` builds the lookup: the distinctive words of an incident joined with OR, because `websearch_to_tsquery` ANDs plain words
 *    and an incident rarely contains every word of another incident's title.
 */
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { loadSearchPeer } from './peers/peers';
import Logger from '@kuraykaraaslan-labs/logger';
import { Alert } from './entities/alert.entity';
import { Incident } from './entities/incident.entity';
import { IncidentPostmortem } from './entities/incident_postmortem.entity';
import { Monitor } from './entities/monitor.entity';
import { cleanText } from './hygiene';

export const INCIDENT_ENTITY_TYPE = 'incident';
const MAX_BODY = 20_000;
const MAX_ALERTS = 20;
const MAX_LABELS_PER_ALERT = 10;

export interface IncidentIndexContext {
  monitorName?: string | null;
  alerts: Array<{ title: string; labels?: Record<string, string> | null }>;
  rootCause?: string | null;
}

export interface IncidentSearchDocument {
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  url: string;
  metadata: Record<string, unknown>;
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** The text of an incident as one string. Used for the search body and, hashed, to decide whether an embedding is stale. */
export function incidentText(i: Pick<Incident, 'title' | 'reason' | 'severity'>, ctx: IncidentIndexContext): string {
  const parts: string[] = [cleanText(i.title, { max: 300 })];
  if (i.reason) parts.push(cleanText(i.reason, { max: 1000 }));
  parts.push(`severity ${i.severity}`);
  if (ctx.monitorName) parts.push(`monitor ${cleanText(ctx.monitorName, { max: 200 })}`);
  for (const a of ctx.alerts.slice(0, MAX_ALERTS)) {
    parts.push(cleanText(a.title, { max: 300 }));
    const labels = Object.entries(a.labels ?? {}).slice(0, MAX_LABELS_PER_ALERT).map(([k, v]) => `${cleanText(k, { max: 40 })} ${cleanText(v, { max: 80 })}`);
    if (labels.length) parts.push(labels.join(' '));
  }
  if (ctx.rootCause) parts.push(`root cause ${cleanText(ctx.rootCause, { max: 2000 })}`);
  return parts.filter(Boolean).join('\n').slice(0, MAX_BODY);
}

export function buildIncidentDocument(i: Incident, ctx: IncidentIndexContext): IncidentSearchDocument {
  const started = new Date(i.startedAt).getTime();
  return {
    entityType: INCIDENT_ENTITY_TYPE,
    entityId: i.incidentId,
    title: cleanText(i.title, { max: 300 }) || 'Incident',
    body: incidentText(i, ctx),
    url: `/admin/incidents?incident=${i.incidentId}`,
    metadata: {
      status: i.status, severity: i.severity, isAuto: i.isAuto, monitorId: i.monitorId ?? null, alertGroupKey: i.alertGroupKey ?? null,
      startedAt: iso(i.startedAt), resolvedAt: iso(i.resolvedAt),
      durationMinutes: i.resolvedAt ? Math.max(0, Math.round((new Date(i.resolvedAt).getTime() - started) / 60_000)) : null,
    },
  };
}

export async function loadIncidentContext(tenantId: string, i: Incident): Promise<IncidentIndexContext> {
  const [monitor, alerts, postmortem] = await Promise.all([
    i.monitorId ? withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.findOne({ where: { tenantId, monitorId: i.monitorId! } })) : Promise.resolve(null),
    withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({ where: { tenantId, incidentId: i.incidentId }, order: { lastFiredAt: 'DESC' }, take: MAX_ALERTS })),
    withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.findOne({ where: { tenantId, incidentId: i.incidentId } })),
  ]);
  return { monitorName: monitor?.name ?? null, alerts: alerts.map((a) => ({ title: a.title, labels: a.labels })), rootCause: postmortem?.rootCause ?? null };
}

/** Index (upsert) one incident. Returns whether a document was written. Never throws. */
export async function indexIncident(tenantId: string, incidentId: string): Promise<boolean> {
  try {
    const incident = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }));
    if (!incident) return false;
    const svc = await loadSearchPeer(tenantId);
    if (!svc) return false;
    await svc.index(tenantId, buildIncidentDocument(incident, await loadIncidentContext(tenantId, incident)) as never);
    return true;
  } catch (e) {
    Logger.warn(`[incident.search] index failed for ${incidentId}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function removeIncidentFromIndex(tenantId: string, incidentId: string): Promise<void> {
  try {
    const svc = await loadSearchPeer(tenantId);
    if (svc) await svc.remove(tenantId, INCIDENT_ENTITY_TYPE, incidentId);
  } catch (e) {
    Logger.warn(`[incident.search] remove failed for ${incidentId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface BackfillResult { indexed: number; skipped: number; failed: number; done: boolean; nextCursor: string | null }
export const BACKFILL_PAGE = 100;

/**
 * Index one page of a tenant's incidents, oldest first. `cursor` is the `startedAt` ISO time of the last incident of the previous page ("" or
 * null starts at the beginning); the result carries the next cursor and `done`. Idempotent: re-running a page rewrites the same documents.
 */
export async function backfillIncidentIndex(tenantId: string, opts: { cursor?: string | null; limit?: number } = {}): Promise<BackfillResult> {
  const limit = Math.min(Math.max(opts.limit ?? BACKFILL_PAGE, 1), 500);
  const svc = await loadSearchPeer(tenantId);
  if (!svc) return { indexed: 0, skipped: 0, failed: 0, done: true, nextCursor: null };
  const { MoreThan } = await import('typeorm');
  const after = opts.cursor ? new Date(opts.cursor) : null;
  const rows = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.find({
    where: { tenantId, ...(after && !Number.isNaN(after.getTime()) ? { startedAt: MoreThan(after) } : {}) }, order: { startedAt: 'ASC' }, take: limit,
  }));
  let indexed = 0; let failed = 0;
  for (const i of rows) {
    try {
      await svc.index(tenantId, buildIncidentDocument(i, await loadIncidentContext(tenantId, i)) as never);
      indexed += 1;
    } catch (e) {
      failed += 1;
      Logger.warn(`[incident.search] backfill failed for ${i.incidentId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const last = rows[rows.length - 1];
  return { indexed, skipped: 0, failed, done: rows.length < limit, nextCursor: last ? new Date(last.startedAt).toISOString() : opts.cursor ?? null };
}

// ── lookup ────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'its', 'into', 'than', 'then', 'out', 'all', 'any', 'can', 'will', 'incident', 'alert', 'severity', 'monitor', 'major', 'minor', 'critical', 'warning', 'down', 'high', 'error', 'failed', 'failure']);
export const MAX_QUERY_TERMS = 12;

/**
 * An OR query of the distinctive words of an incident (letters and digits only, so no operator, quote or `-` of the source text reaches
 * `websearch_to_tsquery`). `null` when nothing distinctive is left. Words are lower-cased, unique, at least three characters, in first-seen
 * order, so the same incident always gives the same query.
 */
export function similarityQuery(text: string): string | null {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of cleanText(text, { max: 4000 }).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || raw.length > 40 || STOPWORDS.has(raw) || raw === 'or' || /^\d+$/.test(raw) || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
    if (terms.length >= MAX_QUERY_TERMS) break;
  }
  return terms.length ? terms.join(' or ') : null;
}
