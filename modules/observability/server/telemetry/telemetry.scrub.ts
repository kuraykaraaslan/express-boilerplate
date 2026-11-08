/**
 * PII scrubbing of ingested telemetry (phase 17.2), reusing the Sentry rules (`sentry.scrub.ts`): JWTs, emails, uuids in free text, tenant
 * path segments, and URL templating. Pure; never throws; never mutates its input.
 *
 * What is removed outright: user and client identifiers, request and response headers and bodies, URL query strings, and the text of
 * database statements. What is rewritten: URLs become route templates (`scrubUrl`), free text loses JWTs, emails, uuids and
 * `/tenant/<x>` segments (`scrubText`). What is kept: every other attribute value, with JWTs and emails still redacted, but with
 * uuids kept, because a request id or an order id in a structured attribute is exactly what correlation needs.
 */
import { scrubText, scrubTransactionName, scrubUrl } from '../sentry.scrub';
import type { Attributes, LogRecord, MetricPoint, SpanRecord } from './telemetry.types';

const DROP_KEYS = new Set([
  'user.id', 'user.email', 'user.name', 'user.full_name', 'user.hash', 'user.roles', 'enduser.id', 'enduser.role', 'enduser.scope', 'userId', 'user_id',
  'client.address', 'client.port', 'http.client_ip', 'net.peer.ip', 'net.sock.peer.addr', 'network.peer.address', 'source.address',
  'url.query', 'http.query', 'url.fragment',
]);
const DROP_PREFIXES = ['http.request.header.', 'http.response.header.', 'http.request.body', 'http.response.body', 'http.request.cookie', 'rpc.request.metadata.', 'messaging.message.body'];
const STATEMENT_KEYS = new Set(['db.statement', 'db.query.text', 'db.sql.table_text']);
const URL_KEYS = new Set(['http.url', 'url.full', 'http.target', 'url.path', 'http.route', 'url.original', 'http.request.target']);
const TEXT_KEYS = new Set(['exception.message', 'exception.stacktrace', 'message', 'error.message', 'log.message']);

const UUID_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** JWTs, emails and tenant paths are redacted; uuids are kept (they are swapped out while `scrubText` runs). */
function scrubSecrets(text: string): string {
  const kept: string[] = [];
  const guarded = text.replace(UUID_TOKEN, (m) => { kept.push(m); return `\u0001${kept.length - 1}\u0001`; });
  return scrubText(guarded).replace(/\u0001(\d+)\u0001/g, (_m, i: string) => kept[Number(i)] ?? '[uuid]');
}

function dropped(key: string): boolean {
  return DROP_KEYS.has(key) || DROP_PREFIXES.some((p) => key.startsWith(p));
}

export function scrubAttributes(attrs: Attributes): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (dropped(k)) continue;
    if (typeof v !== 'string') { out[k] = v; continue; }
    if (STATEMENT_KEYS.has(k)) out[k] = '[statement]';
    else if (URL_KEYS.has(k)) out[k] = scrubUrl(v);
    else if (TEXT_KEYS.has(k)) out[k] = scrubText(v);
    else out[k] = scrubSecrets(v);
  }
  return out;
}

export function scrubSpan(s: SpanRecord): SpanRecord {
  return {
    ...s,
    name: scrubTransactionName(scrubSecrets(s.name)),
    ...(s.statusMessage ? { statusMessage: scrubText(s.statusMessage) } : {}),
    attributes: scrubAttributes(s.attributes),
    resource: scrubAttributes(s.resource),
    events: s.events.map((e) => ({ ...e, name: scrubSecrets(e.name), attributes: scrubAttributes(e.attributes) })),
  };
}

export function scrubLog(r: LogRecord): LogRecord {
  return { ...r, body: scrubText(r.body), attributes: scrubAttributes(r.attributes), resource: scrubAttributes(r.resource) };
}

export function scrubMetric(p: MetricPoint): MetricPoint {
  return { ...p, attributes: scrubAttributes(p.attributes), resource: scrubAttributes(p.resource) };
}
