/**
 * W3C trace context and request-id plumbing (phase 17.3). Small, pure where possible, no I/O.
 *
 *  - `parseTraceparent` / `formatTraceparent`: the `traceparent` header (W3C Trace Context level 1).
 *  - `injectTrace` / `extractTrace`: carry the context inside a BullMQ job payload (`data.__trace`), so a worker's spans and logs
 *    join the trace of the request that enqueued the job.
 *  - `traceIdFromRequestId` / `requestIdFromTraceId`: `x-request-id` and the trace id are the same 128 bits. NB request ids are
 *    uuids, and a uuid without dashes IS a valid trace id, so for NB-minted ids the mapping is a bijection. A foreign request id
 *    (any other shape) maps to a stable hash, one way: the trace id is findable from the request id, not the reverse.
 *  - `activeTraceContext`: the trace and span id of the active OpenTelemetry (or Sentry) span, or `null`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { getOtelApi } from '../otel.init';
import { getSentry } from '../sentry.init';

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO32 = /^0{32}$/;
const ZERO16 = /^0{16}$/;

/** Returns the context, or `null` for anything the W3C spec calls invalid (wrong shape, version ff, all-zero ids, trailing data on version 00). */
export function parseTraceparent(value: unknown): TraceContext | null {
  if (typeof value !== 'string') return null;
  const m = TRACEPARENT.exec(value.trim());
  if (!m) return null;
  const [, version, traceId, spanId, flags, rest] = m;
  if (version === 'ff') return null;
  if (version === '00' && rest) return null;
  if (ZERO32.test(traceId!) || ZERO16.test(spanId!)) return null;
  return { traceId: traceId!, spanId: spanId!, sampled: (parseInt(flags!, 16) & 1) === 1 };
}

export function formatTraceparent(c: TraceContext): string {
  return `00-${c.traceId}-${c.spanId}-${c.sampled ? '01' : '00'}`;
}

export function newSpanId(): string {
  let id = randomBytes(8).toString('hex');
  while (ZERO16.test(id)) id = randomBytes(8).toString('hex');
  return id;
}

export function newTraceId(): string {
  let id = randomBytes(16).toString('hex');
  while (ZERO32.test(id)) id = randomBytes(16).toString('hex');
  return id;
}

// ── request id <-> trace id ────────────────────────────────────────────────────

const UUID_RE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;

export function traceIdFromRequestId(requestId: string): string {
  const uuid = UUID_RE.exec(requestId);
  const direct = uuid ? uuid.slice(1).join('').toLowerCase() : HEX32_RE.test(requestId) ? requestId.toLowerCase() : null;
  if (direct && !ZERO32.test(direct)) return direct;
  const hashed = createHash('sha256').update(requestId).digest('hex').slice(0, 32);
  return ZERO32.test(hashed) ? 'f'.repeat(32) : hashed;
}

/** The uuid spelling of a trace id: what `x-request-id` carries for a request NB minted. */
export function requestIdFromTraceId(traceId: string): string {
  const h = traceId.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function requestIdMatchesTrace(requestId: string, traceId: string): boolean {
  return traceIdFromRequestId(requestId) === traceId.toLowerCase();
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export interface ResolvedContext {
  trace: TraceContext;
  requestId: string;
  /** Which input decided the trace id. */
  source: 'traceparent' | 'x-request-id' | 'generated';
}

/**
 * The trace context of an inbound request. A valid `traceparent` wins (its span is the remote parent); otherwise a well-formed
 * `x-request-id` fixes the trace id; otherwise both are minted. The returned request id is the inbound one when it is well
 * formed, else the uuid spelling of the trace id.
 */
export function resolveIncoming(headers: { get(name: string): string | null }): ResolvedContext {
  const parent = parseTraceparent(headers.get('traceparent'));
  const inbound = headers.get('x-request-id');
  const rid = typeof inbound === 'string' && REQUEST_ID_PATTERN.test(inbound) ? inbound : null;
  if (parent) return { trace: parent, requestId: rid ?? requestIdFromTraceId(parent.traceId), source: 'traceparent' };
  if (rid) return { trace: { traceId: traceIdFromRequestId(rid), spanId: newSpanId(), sampled: true }, requestId: rid, source: 'x-request-id' };
  const traceId = newTraceId();
  return { trace: { traceId, spanId: newSpanId(), sampled: true }, requestId: requestIdFromTraceId(traceId), source: 'generated' };
}

// ── the active span ────────────────────────────────────────────────────────────

interface SpanContextLike { traceId?: string; spanId?: string; traceFlags?: number }

function fromSpanContext(sc: SpanContextLike | undefined | null): TraceContext | null {
  if (!sc || typeof sc.traceId !== 'string' || typeof sc.spanId !== 'string') return null;
  if (!/^[0-9a-f]{32}$/.test(sc.traceId) || !/^[0-9a-f]{16}$/.test(sc.spanId) || ZERO32.test(sc.traceId) || ZERO16.test(sc.spanId)) return null;
  return { traceId: sc.traceId, spanId: sc.spanId, sampled: ((sc.traceFlags ?? 1) & 1) === 1 };
}

/** The active span of OpenTelemetry (when the SDK started), else Sentry's (OTel-based since SDK 8); `null` outside any span. Never throws. */
export function activeTraceContext(): TraceContext | null {
  try {
    const otel = getOtelApi();
    const fromOtel = fromSpanContext(otel?.trace?.getActiveSpan?.()?.spanContext?.());
    if (fromOtel) return fromOtel;
    return fromSpanContext(getSentry()?.getActiveSpan?.()?.spanContext?.());
  } catch {
    return null;
  }
}

// ── BullMQ job payloads ────────────────────────────────────────────────────────

export const JOB_TRACE_KEY = '__trace';

export interface JobTrace {
  traceparent: string;
  requestId?: string;
}

export interface InjectOptions {
  trace?: TraceContext | null;
  requestId?: string;
  /** Overridable for tests; defaults to the active span. */
  active?: () => TraceContext | null;
}

/**
 * A copy of `payload` carrying the current trace context under `__trace` (call it where the job is enqueued). With no active span and
 * no request id the payload is returned unchanged. The caller's object is never mutated and an existing `__trace` is replaced.
 */
export function injectTrace<T extends object>(payload: T, opts: InjectOptions = {}): T & { [JOB_TRACE_KEY]?: JobTrace } {
  const trace = opts.trace !== undefined ? opts.trace : (opts.active ?? activeTraceContext)();
  const requestId = opts.requestId;
  const base: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  delete base[JOB_TRACE_KEY];
  if (!trace && !requestId) return base as T;
  const ctx = trace ?? { traceId: traceIdFromRequestId(requestId!), spanId: newSpanId(), sampled: true };
  base[JOB_TRACE_KEY] = { traceparent: formatTraceparent(ctx), ...(requestId ? { requestId } : {}) } satisfies JobTrace;
  return base as T & { [JOB_TRACE_KEY]?: JobTrace };
}

export interface ExtractedTrace<T> {
  /** The payload without the carrier key, ready for the job handler. */
  payload: T;
  trace: TraceContext | null;
  requestId?: string;
}

/** Reads the context a producer injected. A missing or malformed carrier yields `trace: null`; the payload is always returned. */
export function extractTrace<T>(data: T): ExtractedTrace<T> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { payload: data, trace: null };
  const { [JOB_TRACE_KEY]: carrier, ...rest } = data as Record<string, unknown>;
  const c = typeof carrier === 'object' && carrier !== null ? (carrier as Record<string, unknown>) : null;
  const trace = parseTraceparent(c?.traceparent);
  const requestId = typeof c?.requestId === 'string' && REQUEST_ID_PATTERN.test(c.requestId) ? c.requestId : undefined;
  return { payload: rest as T, trace, ...(requestId ? { requestId } : {}) };
}

/**
 * Runs `fn` as the continuation of the trace a job came from: the OpenTelemetry context (when the API is loaded) gets the producer's
 * span as the remote parent, so spans the worker starts join the trace. Returns `fn`'s result; with no OTel the call is plain.
 */
export function runInTrace<T>(trace: TraceContext | null, fn: () => T): T {
  const otel = getOtelApi();
  if (!trace || !otel?.trace?.setSpanContext || !otel?.context?.with) return fn();
  try {
    const ctx = otel.trace.setSpanContext(otel.context.active(), { traceId: trace.traceId, spanId: trace.spanId, traceFlags: trace.sampled ? 1 : 0, isRemote: true });
    return otel.context.with(ctx, fn) as T;
  } catch {
    return fn();
  }
}
