/**
 * OTLP protobuf, dependency-free: a schema-driven wire decoder that produces the SAME object shape as OTLP/JSON (camelCase
 * names, ids as hex, 64-bit integers as decimal strings), so `otlp.codec.ts` has one mapper for both encodings; and a small
 * encoder for metrics (Prometheus's OTLP receiver takes protobuf).
 *
 * Field numbers are from opentelemetry-proto v1 (`trace.proto`, `logs.proto`, `metrics.proto`, `common.proto`,
 * `resource.proto`). The decoder is verified against bytes produced by the OpenTelemetry JS SDK serializer
 * (`tests/fixtures/otlp.protobuf.fixtures.ts`), not only against its own encoder.
 *
 * Safety: every length is checked against the buffer, nesting is capped, unknown fields are skipped, groups (wire types 3
 * and 4) are rejected. Malformed input throws `OtlpDecodeError`.
 */
import { OtlpDecodeError } from './otlp.codec';
import type { MetricPoint, Attributes, AttrValue } from './telemetry.types';

type FieldType = 'msg' | 'string' | 'hex' | 'b64' | 'enum' | 'i64s' | 'fixed64s' | 'sfixed64s' | 'double' | 'bool' | 'pfixed64s' | 'pdouble' | 'present';
interface Field { n: string; t: FieldType; m?: string; rep?: boolean }
const f = (n: string, t: FieldType, extra: Partial<Field> = {}): Field => ({ n, t, ...extra });

const SCHEMA: Record<string, Record<number, Field>> = {
  AnyValue: {
    1: f('stringValue', 'string'), 2: f('boolValue', 'bool'), 3: f('intValue', 'i64s'), 4: f('doubleValue', 'double'),
    5: f('arrayValue', 'msg', { m: 'ArrayValue' }), 6: f('kvlistValue', 'msg', { m: 'KeyValueList' }), 7: f('bytesValue', 'b64'),
  },
  ArrayValue: { 1: f('values', 'msg', { m: 'AnyValue', rep: true }) },
  KeyValueList: { 1: f('values', 'msg', { m: 'KeyValue', rep: true }) },
  KeyValue: { 1: f('key', 'string'), 2: f('value', 'msg', { m: 'AnyValue' }) },
  Resource: { 1: f('attributes', 'msg', { m: 'KeyValue', rep: true }) },
  Scope: { 1: f('name', 'string'), 2: f('version', 'string'), 3: f('attributes', 'msg', { m: 'KeyValue', rep: true }) },

  TracesRequest: { 1: f('resourceSpans', 'msg', { m: 'ResourceSpans', rep: true }) },
  ResourceSpans: { 1: f('resource', 'msg', { m: 'Resource' }), 2: f('scopeSpans', 'msg', { m: 'ScopeSpans', rep: true }) },
  ScopeSpans: { 1: f('scope', 'msg', { m: 'Scope' }), 2: f('spans', 'msg', { m: 'Span', rep: true }) },
  Span: {
    1: f('traceId', 'hex'), 2: f('spanId', 'hex'), 4: f('parentSpanId', 'hex'), 5: f('name', 'string'), 6: f('kind', 'enum'),
    7: f('startTimeUnixNano', 'fixed64s'), 8: f('endTimeUnixNano', 'fixed64s'), 9: f('attributes', 'msg', { m: 'KeyValue', rep: true }),
    11: f('events', 'msg', { m: 'SpanEvent', rep: true }), 15: f('status', 'msg', { m: 'Status' }),
  },
  SpanEvent: { 1: f('timeUnixNano', 'fixed64s'), 2: f('name', 'string'), 3: f('attributes', 'msg', { m: 'KeyValue', rep: true }) },
  Status: { 2: f('message', 'string'), 3: f('code', 'enum') },

  LogsRequest: { 1: f('resourceLogs', 'msg', { m: 'ResourceLogs', rep: true }) },
  ResourceLogs: { 1: f('resource', 'msg', { m: 'Resource' }), 2: f('scopeLogs', 'msg', { m: 'ScopeLogs', rep: true }) },
  ScopeLogs: { 1: f('scope', 'msg', { m: 'Scope' }), 2: f('logRecords', 'msg', { m: 'LogRecord', rep: true }) },
  LogRecord: {
    1: f('timeUnixNano', 'fixed64s'), 2: f('severityNumber', 'enum'), 3: f('severityText', 'string'), 5: f('body', 'msg', { m: 'AnyValue' }),
    6: f('attributes', 'msg', { m: 'KeyValue', rep: true }), 9: f('traceId', 'hex'), 10: f('spanId', 'hex'), 11: f('observedTimeUnixNano', 'fixed64s'),
  },

  MetricsRequest: { 1: f('resourceMetrics', 'msg', { m: 'ResourceMetrics', rep: true }) },
  ResourceMetrics: { 1: f('resource', 'msg', { m: 'Resource' }), 2: f('scopeMetrics', 'msg', { m: 'ScopeMetrics', rep: true }) },
  ScopeMetrics: { 1: f('scope', 'msg', { m: 'Scope' }), 2: f('metrics', 'msg', { m: 'Metric', rep: true }) },
  Metric: {
    1: f('name', 'string'), 2: f('description', 'string'), 3: f('unit', 'string'), 5: f('gauge', 'msg', { m: 'Gauge' }), 7: f('sum', 'msg', { m: 'Sum' }),
    9: f('histogram', 'msg', { m: 'Histogram' }), 10: f('exponentialHistogram', 'present'), 11: f('summary', 'present'),
  },
  Gauge: { 1: f('dataPoints', 'msg', { m: 'NumberDataPoint', rep: true }) },
  Sum: { 1: f('dataPoints', 'msg', { m: 'NumberDataPoint', rep: true }), 2: f('aggregationTemporality', 'enum'), 3: f('isMonotonic', 'bool') },
  Histogram: { 1: f('dataPoints', 'msg', { m: 'HistogramDataPoint', rep: true }), 2: f('aggregationTemporality', 'enum') },
  NumberDataPoint: {
    2: f('startTimeUnixNano', 'fixed64s'), 3: f('timeUnixNano', 'fixed64s'), 4: f('asDouble', 'double'), 5: f('exemplars', 'msg', { m: 'Exemplar', rep: true }),
    6: f('asInt', 'sfixed64s'), 7: f('attributes', 'msg', { m: 'KeyValue', rep: true }),
  },
  // filtered_attributes (7) is deliberately not decoded: it is client text the store has no use for.
  Exemplar: { 2: f('timeUnixNano', 'fixed64s'), 3: f('asDouble', 'double'), 4: f('spanId', 'hex'), 5: f('traceId', 'hex'), 6: f('asInt', 'sfixed64s') },
  HistogramDataPoint: {
    2: f('startTimeUnixNano', 'fixed64s'), 3: f('timeUnixNano', 'fixed64s'), 4: f('count', 'fixed64s'), 5: f('sum', 'double'),
    6: f('bucketCounts', 'pfixed64s'), 7: f('explicitBounds', 'pdouble'), 8: f('exemplars', 'msg', { m: 'Exemplar', rep: true }),
    9: f('attributes', 'msg', { m: 'KeyValue', rep: true }),
  },
};

const MAX_DEPTH = 12;
// BigInt literals need an ES2020 target; this project's tsconfig targets lower.
const ZERO = BigInt(0);
const SEVEN = BigInt(7);
const LOW7 = BigInt(0x7f);

class Reader {
  readonly view: DataView;
  constructor(readonly buf: Uint8Array, public pos = 0, readonly end = buf.length) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  more(): boolean { return this.pos < this.end; }

  varint(): bigint {
    let result = ZERO;
    let shift = ZERO;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new OtlpDecodeError('truncated varint');
      const b = this.buf[this.pos++]!;
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += SEVEN;
    }
    throw new OtlpDecodeError('varint too long');
  }

  need(n: number): void {
    if (n < 0 || this.pos + n > this.end) throw new OtlpDecodeError('field runs past the end of the message');
  }

  fixed64(): bigint { this.need(8); const v = this.view.getBigUint64(this.pos, true); this.pos += 8; return v; }
  sfixed64(): bigint { this.need(8); const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return v; }
  double(): number { this.need(8); const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  fixed32(): number { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }

  bytes(): Uint8Array {
    const len = Number(this.varint());
    this.need(len);
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: false });
const hex = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('hex');

function decodeMessage(r: Reader, name: string, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH) throw new OtlpDecodeError('message nested too deeply');
  const schema = SCHEMA[name];
  if (!schema) throw new OtlpDecodeError(`unknown message ${name}`);
  const out: Record<string, unknown> = {};
  const put = (fld: Field, value: unknown) => {
    if (!fld.rep) { out[fld.n] = value; return; }
    const list = out[fld.n] as unknown[] | undefined;
    if (list) list.push(value); else out[fld.n] = [value];
  };
  while (r.more()) {
    const tag = Number(r.varint());
    const fieldNo = tag >>> 3;
    const wire = tag & 7;
    const fld = schema[fieldNo];
    switch (wire) {
      case 0: {
        const v = r.varint();
        if (!fld) break;
        if (fld.t === 'bool') put(fld, v !== ZERO);
        else if (fld.t === 'enum') put(fld, Number(v));
        else if (fld.t === 'i64s') put(fld, BigInt.asIntN(64, v).toString());
        break;
      }
      case 1: {
        if (!fld) { r.need(8); r.pos += 8; break; }
        if (fld.t === 'fixed64s') put(fld, r.fixed64().toString());
        else if (fld.t === 'sfixed64s') put(fld, r.sfixed64().toString());
        else if (fld.t === 'double') put(fld, r.double());
        else if (fld.t === 'pfixed64s') put(fld, r.fixed64().toString());
        else if (fld.t === 'pdouble') put(fld, r.double());
        else { r.need(8); r.pos += 8; }
        break;
      }
      case 2: {
        const chunk = r.bytes();
        if (!fld) break;
        switch (fld.t) {
          case 'string': put(fld, utf8.decode(chunk)); break;
          case 'hex': put(fld, hex(chunk)); break;
          case 'b64': put(fld, Buffer.from(chunk).toString('base64')); break;
          case 'msg': put(fld, decodeMessage(new Reader(chunk), fld.m!, depth + 1)); break;
          case 'present': put(fld, {}); break;
          case 'pfixed64s': case 'pdouble': {
            if (chunk.byteLength % 8 !== 0) throw new OtlpDecodeError('packed field length is not a multiple of 8');
            const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            const list: unknown[] = [];
            for (let o = 0; o < chunk.byteLength; o += 8) list.push(fld.t === 'pdouble' ? dv.getFloat64(o, true) : dv.getBigUint64(o, true).toString());
            out[fld.n] = [...((out[fld.n] as unknown[] | undefined) ?? []), ...list];
            break;
          }
          default: break;
        }
        break;
      }
      case 5: r.fixed32(); break;
      default: throw new OtlpDecodeError('unsupported protobuf wire type');
    }
  }
  return out;
}

function decode(bytes: Uint8Array, root: string): Record<string, unknown> {
  return decodeMessage(new Reader(bytes), root, 0);
}

export const decodeTracesProto = (bytes: Uint8Array) => decode(bytes, 'TracesRequest');
export const decodeLogsProto = (bytes: Uint8Array) => decode(bytes, 'LogsRequest');
export const decodeMetricsProto = (bytes: Uint8Array) => decode(bytes, 'MetricsRequest');

// ── Encoder (metrics) ──────────────────────────────────────────────────────────

class Writer {
  private parts: number[] = [];
  private chunks: Uint8Array[] = [];

  private flush(): void {
    if (this.parts.length) { this.chunks.push(Uint8Array.from(this.parts)); this.parts = []; }
  }

  varint(v: number | bigint): this {
    let n = BigInt.asUintN(64, BigInt(v));
    while (n > LOW7) { this.parts.push(Number(n & LOW7) | 0x80); n >>= SEVEN; }
    this.parts.push(Number(n));
    return this;
  }

  tag(field: number, wire: number): this { return this.varint((field << 3) | wire); }
  str(field: number, s: string): this { return this.bytes(field, new TextEncoder().encode(s)); }
  bytes(field: number, b: Uint8Array): this { this.tag(field, 2).varint(b.length); this.flush(); this.chunks.push(b); return this; }
  msg(field: number, w: Writer): this { return this.bytes(field, w.finish()); }
  bool(field: number, v: boolean): this { return this.tag(field, 0).varint(v ? 1 : 0); }
  enumVal(field: number, v: number): this { return this.tag(field, 0).varint(v); }
  fixed64(field: number, v: bigint): this { this.tag(field, 1); const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, v), true); this.flush(); this.chunks.push(b); return this; }
  double(field: number, v: number): this { this.tag(field, 1); const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.flush(); this.chunks.push(b); return this; }

  finish(): Uint8Array {
    this.flush();
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

function anyValueMsg(v: AttrValue): Writer {
  const w = new Writer();
  if (typeof v === 'string') w.str(1, v);
  else if (typeof v === 'boolean') w.bool(2, v);
  else if (Number.isInteger(v)) w.tag(3, 0).varint(BigInt(v));
  else w.double(4, v);
  return w;
}

function kvMsgs(w: Writer, field: number, attrs: Attributes): void {
  for (const [k, v] of Object.entries(attrs)) w.msg(field, new Writer().str(1, k).msg(2, anyValueMsg(v)));
}

const msToNsBig = (ms: number): bigint => BigInt(Math.round(ms * 1e6));

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

/** The exemplars of one point (`Exemplar` messages), so a backend with an exemplar store (Prometheus) keeps the link to the trace. */
function exemplarMsgs(dp: Writer, field: number, p: MetricPoint): void {
  for (const e of p.exemplars ?? []) {
    const m = new Writer().fixed64(2, msToNsBig(e.timeMs)).double(3, e.value);
    if (e.spanId) m.bytes(4, hexBytes(e.spanId));
    m.bytes(5, hexBytes(e.traceId));
    dp.msg(field, m);
  }
}

/** `MetricPoint[]` as an `ExportMetricsServiceRequest`. Points of one metric name, kind and resource share a `Metric`. */
export function encodeMetricsProto(points: MetricPoint[]): Uint8Array {
  const byRes = new Map<string, { resource: Attributes; metrics: Map<string, MetricPoint[]> }>();
  for (const p of points) {
    const rk = JSON.stringify(p.resource);
    let r = byRes.get(rk);
    if (!r) { r = { resource: p.resource, metrics: new Map() }; byRes.set(rk, r); }
    const mk = `${p.kind}\u0000${p.name}\u0000${p.unit ?? ''}\u0000${p.monotonic ?? ''}`;
    const list = r.metrics.get(mk);
    if (list) list.push(p); else r.metrics.set(mk, [p]);
  }
  const req = new Writer();
  for (const r of byRes.values()) {
    const resource = new Writer();
    kvMsgs(resource, 1, r.resource);
    const scope = new Writer().msg(1, new Writer().str(1, 'nb.telemetry'));
    for (const list of r.metrics.values()) {
      const first = list[0]!;
      const metric = new Writer().str(1, first.name);
      if (first.unit) metric.str(3, first.unit);
      if (first.kind === 'histogram') {
        const h = new Writer();
        for (const p of list) {
          if (!p.histogram) continue;
          const dp = new Writer().fixed64(3, msToNsBig(p.timeMs)).fixed64(4, BigInt(Math.round(p.histogram.count))).double(5, p.histogram.sum);
          const packedCounts = new Uint8Array(p.histogram.counts.length * 8);
          const pc = new DataView(packedCounts.buffer);
          p.histogram.counts.forEach((c, i) => pc.setBigUint64(i * 8, BigInt(Math.round(c)), true));
          dp.bytes(6, packedCounts);
          const packedBounds = new Uint8Array(p.histogram.bounds.length * 8);
          const pb = new DataView(packedBounds.buffer);
          p.histogram.bounds.forEach((b, i) => pb.setFloat64(i * 8, b, true));
          dp.bytes(7, packedBounds);
          exemplarMsgs(dp, 8, p);
          kvMsgs(dp, 9, p.attributes);
          h.msg(1, dp);
        }
        h.enumVal(2, 2); // CUMULATIVE
        metric.msg(9, h);
      } else {
        const g = new Writer();
        for (const p of list) {
          const dp = new Writer().fixed64(3, msToNsBig(p.timeMs));
          dp.double(4, p.value ?? 0);
          exemplarMsgs(dp, 5, p);
          kvMsgs(dp, 7, p.attributes);
          g.msg(1, dp);
        }
        if (first.kind === 'sum') { g.enumVal(2, 2); g.bool(3, first.monotonic === true); metric.msg(7, g); } else metric.msg(5, g);
      }
      scope.msg(2, metric);
    }
    req.msg(1, new Writer().msg(1, resource).msg(2, scope));
  }
  return req.finish();
}

/** `Export{Trace,Logs,Metrics}ServiceResponse` with a `partial_success` (field 1: rejected count = 1, error message = 2). Empty when nothing was rejected. */
export function encodePartialSuccess(rejected: number, message: string): Uint8Array {
  if (rejected <= 0) return new Uint8Array();
  const ps = new Writer().tag(1, 0).varint(rejected);
  if (message) ps.str(2, message);
  return new Writer().msg(1, ps).finish();
}

/**
 * `google.rpc.Status` for the `grpc-status-details-bin` trailer. With `retryAfterSeconds` it carries a `google.rpc.RetryInfo`: the OTLP
 * spec lets an exporter retry `RESOURCE_EXHAUSTED` only when the server says when (otherwise the data is dropped).
 */
export function encodeRpcStatus(code: number, message: string, retryAfterSeconds?: number): Uint8Array {
  const status = new Writer().enumVal(1, code);
  if (message) status.str(2, message);
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    const duration = new Writer().tag(1, 0).varint(Math.ceil(retryAfterSeconds));
    const retryInfo = new Writer().msg(1, duration);
    const any = new Writer().str(1, 'type.googleapis.com/google.rpc.RetryInfo').bytes(2, retryInfo.finish());
    status.msg(3, any);
  }
  return status.finish();
}
