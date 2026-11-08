/**
 * OTLP <-> the port's records. Pure functions, no I/O.
 *
 * Decode: an OTLP/JSON document (the protobuf decoder in `otlp.protobuf.ts` produces the same shape) becomes `LogRecord[]`,
 * `SpanRecord[]` or `MetricPoint[]`, under hard caps. Anything malformed is dropped and counted, never thrown: one bad span
 * must not lose the batch. A document that is not an object at all throws `OtlpDecodeError`.
 *
 * Encode: the port's records as OTLP/JSON (for the Tempo adapter and the logger export), and metrics as OTLP protobuf
 * (for Prometheus's OTLP receiver, see `otlp.protobuf.ts`).
 */
import {
  MAX_EXEMPLARS_PER_POINT, type Attributes, type AttrValue, type LogRecord, type MetricPoint, type SpanEvent, type SpanKind, type SpanRecord, type SpanStatus,
} from './telemetry.types';
import { msToNs, nsToMs, normalizeId, severityFromNumber, severityToNumber } from './telemetry.util';

export class OtlpDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpDecodeError';
  }
}

export interface DecodeLimits {
  /** Records (spans, log records, metric points) kept per request; the rest are counted as rejected. */
  maxItems: number;
  /** Attributes kept per record (and per resource). */
  maxAttributes: number;
  /** Attribute keys and string values are cut to this many characters. */
  maxStringLength: number;
}

export const DEFAULT_DECODE_LIMITS: DecodeLimits = { maxItems: 10_000, maxAttributes: 128, maxStringLength: 4096 };

export interface Decoded<T> {
  items: T[];
  rejected: number;
  /** One short, safe sentence per distinct problem (for the OTLP `partialSuccess.errorMessage`). */
  warnings: string[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

class Warn {
  private readonly set = new Set<string>();
  add(msg: string): void { this.set.add(msg); }
  list(): string[] { return [...this.set].slice(0, 5); }
}

// ── Values ─────────────────────────────────────────────────────────────────────

function cut(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** A JSON AnyValue as a flat attribute value. Arrays, maps and bytes become a JSON string (bounded). */
function anyValue(v: unknown, lim: DecodeLimits, depth = 0): AttrValue | undefined {
  if (!isObj(v)) return undefined;
  if (typeof v.stringValue === 'string') return cut(v.stringValue, lim.maxStringLength);
  if (typeof v.boolValue === 'boolean') return v.boolValue;
  if ('intValue' in v) {
    const n = typeof v.intValue === 'string' ? Number(v.intValue) : v.intValue;
    if (typeof n === 'number' && Number.isFinite(n)) return Number.isSafeInteger(n) ? n : String(v.intValue);
    return undefined;
  }
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (typeof v.bytesValue === 'string') return cut(v.bytesValue, lim.maxStringLength);
  if (depth < 3 && (isObj(v.arrayValue) || isObj(v.kvlistValue))) {
    const plain = plainValue(v, lim, depth);
    return cut(JSON.stringify(plain), lim.maxStringLength);
  }
  return undefined;
}

function plainValue(v: unknown, lim: DecodeLimits, depth: number): unknown {
  if (!isObj(v)) return null;
  if (isObj(v.arrayValue)) return arr(v.arrayValue.values).slice(0, 64).map((x) => plainValue(x, lim, depth + 1));
  if (isObj(v.kvlistValue)) {
    return Object.fromEntries(arr(v.kvlistValue.values).slice(0, 64).filter(isObj).map((kv) => [String(kv.key ?? ''), plainValue(kv.value, lim, depth + 1)]));
  }
  return anyValue(v, lim, depth + 1) ?? null;
}

export function attributesFrom(list: unknown, lim: DecodeLimits): Attributes {
  const out: Attributes = {};
  let n = 0;
  for (const kv of arr(list)) {
    if (!isObj(kv) || typeof kv.key !== 'string' || !kv.key) continue;
    if (++n > lim.maxAttributes) break;
    const val = anyValue(kv.value, lim);
    if (val !== undefined) out[cut(kv.key, lim.maxStringLength)] = val;
  }
  return out;
}

/** OTLP/JSON nanosecond fields arrive as a decimal string (spec) or, from sloppy exporters, a number. */
function nanos(v: unknown): string | undefined {
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return v.replace(/^0+(?=\d)/, '');
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return BigInt(Math.trunc(v)).toString();
  return undefined;
}

/** An id as lowercase hex. The spec says hex; Tempo and some older exporters emit base64 for the same bytes. */
export function idToHex(v: unknown, hexLen: 16 | 32): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const hex = normalizeId(v, hexLen);
  if (hex) return hex;
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) {
    try {
      const bytes = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      if (bytes.length === hexLen / 2) return normalizeId(bytes.toString('hex'), hexLen);
    } catch { /* not base64 */ }
  }
  return undefined;
}

function intOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return undefined;
}

const SPAN_KINDS: SpanKind[] = ['INTERNAL', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];
function spanKind(v: unknown): SpanKind {
  if (typeof v === 'string') {
    const n = v.replace('SPAN_KIND_', '');
    if ((['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'] as string[]).includes(n)) return n as SpanKind;
    return 'INTERNAL';
  }
  const i = intOf(v);
  return i !== undefined && i >= 0 && i < SPAN_KINDS.length ? SPAN_KINDS[i]! : 'INTERNAL';
}

function spanStatus(v: unknown): { status: SpanStatus; message?: string } {
  if (!isObj(v)) return { status: 'UNSET' };
  const code = typeof v.code === 'string' ? v.code.replace('STATUS_CODE_', '') : intOf(v.code);
  const status: SpanStatus = code === 2 || code === 'ERROR' ? 'ERROR' : code === 1 || code === 'OK' ? 'OK' : 'UNSET';
  return { status, ...(typeof v.message === 'string' && v.message ? { message: v.message.slice(0, 1024) } : {}) };
}

function* resourceScopes(root: unknown, resKey: string, scopeKey: string, itemKey: string, lim: DecodeLimits): Generator<{ resource: Attributes; item: unknown }> {
  if (!isObj(root)) throw new OtlpDecodeError('request body is not an OTLP object');
  for (const rs of arr(root[resKey])) {
    if (!isObj(rs)) continue;
    const resource = attributesFrom(isObj(rs.resource) ? rs.resource.attributes : undefined, lim);
    // Older exporters use `instrumentationLibrary*` for what became `scope*`.
    const scopes = arr(rs[scopeKey] ?? rs[scopeKey.replace('scope', 'instrumentationLibrary')]);
    for (const sc of scopes) {
      if (!isObj(sc)) continue;
      for (const item of arr(sc[itemKey])) yield { resource, item };
    }
  }
}

// ── Decode ─────────────────────────────────────────────────────────────────────

export function decodeTraces(root: unknown, lim: DecodeLimits = DEFAULT_DECODE_LIMITS): Decoded<SpanRecord> {
  const items: SpanRecord[] = [];
  const w = new Warn();
  let rejected = 0;
  for (const { resource, item } of resourceScopes(root, 'resourceSpans', 'scopeSpans', 'spans', lim)) {
    if (items.length >= lim.maxItems) { rejected++; w.add(`more than ${lim.maxItems} spans in one request`); continue; }
    if (!isObj(item)) { rejected++; continue; }
    const traceId = idToHex(item.traceId, 32);
    const spanId = idToHex(item.spanId, 16);
    const startNs = nanos(item.startTimeUnixNano);
    const endNs = nanos(item.endTimeUnixNano) ?? startNs;
    if (!traceId || !spanId || !startNs || !endNs || typeof item.name !== 'string') { rejected++; w.add('span without valid trace id, span id, name or times'); continue; }
    const { status, message } = spanStatus(item.status);
    const events: SpanEvent[] = arr(item.events).slice(0, 64).filter(isObj).map((e) => ({
      timeNs: nanos(e.timeUnixNano) ?? startNs, name: typeof e.name === 'string' ? cut(e.name, lim.maxStringLength) : '', attributes: attributesFrom(e.attributes, lim),
    }));
    const parent = idToHex(item.parentSpanId, 16);
    items.push({
      traceId, spanId, ...(parent ? { parentSpanId: parent } : {}), name: cut(item.name, lim.maxStringLength), kind: spanKind(item.kind), startNs, endNs,
      status, ...(message ? { statusMessage: message } : {}), attributes: attributesFrom(item.attributes, lim), resource, events,
    });
  }
  return { items, rejected, warnings: w.list() };
}

export function decodeLogs(root: unknown, lim: DecodeLimits = DEFAULT_DECODE_LIMITS): Decoded<LogRecord> {
  const items: LogRecord[] = [];
  const w = new Warn();
  let rejected = 0;
  for (const { resource, item } of resourceScopes(root, 'resourceLogs', 'scopeLogs', 'logRecords', lim)) {
    if (items.length >= lim.maxItems) { rejected++; w.add(`more than ${lim.maxItems} log records in one request`); continue; }
    if (!isObj(item)) { rejected++; continue; }
    const timeNs = nanos(item.timeUnixNano) ?? nanos(item.observedTimeUnixNano) ?? msToNs(Date.now());
    const bodyAttr = anyValue(item.body, lim);
    const body = bodyAttr === undefined ? '' : String(bodyAttr);
    const traceId = idToHex(item.traceId, 32);
    const spanId = idToHex(item.spanId, 16);
    items.push({
      timeNs, severity: severityFromNumber(intOf(item.severityNumber), typeof item.severityText === 'string' ? item.severityText : undefined), body,
      attributes: attributesFrom(item.attributes, lim), resource, ...(traceId ? { traceId } : {}), ...(traceId && spanId ? { spanId } : {}),
    });
  }
  return { items, rejected, warnings: w.list() };
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Exemplars of one data point: only those that name a valid trace, at most `MAX_EXEMPLARS_PER_POINT`, never the client's `filteredAttributes`. */
function exemplarsOf(list: unknown): MetricPoint['exemplars'] {
  const out: NonNullable<MetricPoint['exemplars']> = [];
  for (const e of arr(list)) {
    if (out.length >= MAX_EXEMPLARS_PER_POINT) break;
    if (!isObj(e)) continue;
    const traceId = idToHex(e.traceId, 32);
    const value = e.asDouble !== undefined ? num(e.asDouble) : num(e.asInt);
    const ns = nanos(e.timeUnixNano);
    if (!traceId || value === undefined || !ns) continue;
    const spanId = idToHex(e.spanId, 16);
    out.push({ traceId, value, timeMs: Math.floor(nsToMs(ns)), ...(spanId ? { spanId } : {}) });
  }
  return out.length ? out : undefined;
}

export function decodeMetrics(root: unknown, lim: DecodeLimits = DEFAULT_DECODE_LIMITS): Decoded<MetricPoint> {
  const items: MetricPoint[] = [];
  const w = new Warn();
  let rejected = 0;
  for (const { resource, item } of resourceScopes(root, 'resourceMetrics', 'scopeMetrics', 'metrics', lim)) {
    if (!isObj(item) || typeof item.name !== 'string' || !/^[A-Za-z_:][A-Za-z0-9_:.\-/]{0,255}$/.test(item.name)) { rejected++; w.add('metric without a valid name'); continue; }
    const name = item.name;
    const unit = typeof item.unit === 'string' && item.unit ? item.unit.slice(0, 32) : undefined;
    const take = (kind: MetricPoint['kind'], points: unknown, monotonic?: boolean) => {
      for (const dp of arr(points)) {
        if (!isObj(dp)) { rejected++; continue; }
        if (items.length >= lim.maxItems) { rejected++; w.add(`more than ${lim.maxItems} data points in one request`); continue; }
        const ns = nanos(dp.timeUnixNano);
        if (!ns) { rejected++; w.add('data point without a time'); continue; }
        const exemplars = exemplarsOf(dp.exemplars);
        const base = { name, kind, ...(unit ? { unit } : {}), timeMs: Math.floor(nsToMs(ns)), attributes: attributesFrom(dp.attributes, lim), resource, ...(monotonic !== undefined ? { monotonic } : {}), ...(exemplars ? { exemplars } : {}) };
        if (kind === 'histogram') {
          const counts = arr(dp.bucketCounts).map((c) => num(c) ?? 0);
          const bounds = arr(dp.explicitBounds).map((c) => num(c)).filter((c): c is number => c !== undefined);
          if (counts.length !== bounds.length + 1 || counts.length > 512) { rejected++; w.add('histogram with inconsistent buckets'); continue; }
          items.push({ ...base, histogram: { count: num(dp.count) ?? counts.reduce((a, b) => a + b, 0), sum: num(dp.sum) ?? 0, bounds, counts } });
        } else {
          const value = dp.asDouble !== undefined ? num(dp.asDouble) : num(dp.asInt);
          if (value === undefined) { rejected++; w.add('data point without a value'); continue; }
          items.push({ ...base, value });
        }
      }
    };
    if (isObj(item.gauge)) take('gauge', item.gauge.dataPoints);
    else if (isObj(item.sum)) take('sum', item.sum.dataPoints, item.sum.isMonotonic === true);
    else if (isObj(item.histogram)) take('histogram', item.histogram.dataPoints);
    else { rejected++; w.add('only gauge, sum and histogram metrics are accepted'); }
  }
  return { items, rejected, warnings: w.list() };
}

// ── Encode (OTLP/JSON) ─────────────────────────────────────────────────────────

function jsonValue(v: AttrValue): Json {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
}

export function jsonAttributes(a: Attributes): Json[] {
  return Object.entries(a).map(([key, value]) => ({ key, value: jsonValue(value) }));
}

const KIND_NUM: Record<SpanKind, number> = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 };
const STATUS_NUM: Record<SpanStatus, number> = { UNSET: 0, OK: 1, ERROR: 2 };

/** Records grouped by identical resource, as `resourceX[]` entries. */
function byResource<T extends { resource: Attributes }>(items: T[]): Array<{ resource: Attributes; items: T[] }> {
  const groups = new Map<string, { resource: Attributes; items: T[] }>();
  for (const it of items) {
    const k = JSON.stringify(it.resource);
    const g = groups.get(k);
    if (g) g.items.push(it); else groups.set(k, { resource: it.resource, items: [it] });
  }
  return [...groups.values()];
}

export function encodeTracesJson(spans: SpanRecord[]): Json {
  return {
    resourceSpans: byResource(spans).map((g) => ({
      resource: { attributes: jsonAttributes(g.resource) },
      scopeSpans: [{
        scope: { name: 'nb.telemetry' },
        spans: g.items.map((s) => ({
          traceId: s.traceId, spanId: s.spanId, ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, kind: KIND_NUM[s.kind],
          startTimeUnixNano: s.startNs, endTimeUnixNano: s.endNs, attributes: jsonAttributes(s.attributes),
          events: s.events.map((e) => ({ timeUnixNano: e.timeNs, name: e.name, attributes: jsonAttributes(e.attributes) })),
          status: { code: STATUS_NUM[s.status], ...(s.statusMessage ? { message: s.statusMessage } : {}) },
        })),
      }],
    })),
  };
}

export function encodeLogsJson(records: LogRecord[]): Json {
  return {
    resourceLogs: byResource(records).map((g) => ({
      resource: { attributes: jsonAttributes(g.resource) },
      scopeLogs: [{
        scope: { name: 'nb.telemetry' },
        logRecords: g.items.map((r) => ({
          timeUnixNano: r.timeNs, severityNumber: severityToNumber(r.severity), severityText: r.severity, body: { stringValue: r.body },
          attributes: jsonAttributes(r.attributes), ...(r.traceId ? { traceId: r.traceId } : {}), ...(r.spanId ? { spanId: r.spanId } : {}),
        })),
      }],
    })),
  };
}
