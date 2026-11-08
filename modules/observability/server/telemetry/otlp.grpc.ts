/**
 * OTLP/gRPC ingest (unary `Export` of traces, logs and metrics) on `node:http2`, with the gRPC wire framing written out: the 5-byte
 * message prefix (compressed flag + big-endian length), `grpc-encoding: gzip`, `grpc-status` / `grpc-message` trailers, and
 * `grpc-status-details-bin` with a `RetryInfo` when an exporter should back off. No gRPC library: the surface is three unary methods.
 *
 * It is a TRANSPORT. Everything that decides something about a tenant (the ingest key, the module gate, the size and rate limits, the plan,
 * decoding, tenant stamping over any client value, scrubbing, sampling) is `runOtlpPipeline` in `otlp.pipeline.ts`, the same function the
 * HTTP routes call. This file only turns gRPC metadata into `OtlpWireRequest` and the outcome into a gRPC status.
 *
 * Framework-free (no `next/*`): it runs in the `telemetry-gateway` sidecar (`modules/observability/telemetry-gateway`).
 *
 * Hardening beyond the pipeline: the message length in the prefix is checked against the tenant's limit BEFORE any of the message is
 * buffered; nothing is read before the key is verified (flow control, not memory, holds an unauthenticated sender back); exactly one message per
 * call; a bounded number of concurrent streams and a stream idle timeout; every refusal of a key is the same status and message.
 */
import http2, { type Http2Server, type IncomingHttpHeaders, type ServerHttp2Stream } from 'node:http2';
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error';
import Logger from '@kuraykaraaslan-labs/logger';
import { runOtlpPipeline, defaultOtlpDeps, type OtlpRouteDeps } from './otlp.pipeline';
import { encodePartialSuccess, encodeRpcStatus } from './otlp.protobuf';
import { BodyTooLargeError, mapTelemetryError } from './telemetry.http';
import type { Signal } from './telemetry.types';

/** gRPC status codes this transport answers with. */
export const GrpcStatus = {
  OK: 0, CANCELLED: 1, INVALID_ARGUMENT: 3, DEADLINE_EXCEEDED: 4, PERMISSION_DENIED: 7, RESOURCE_EXHAUSTED: 8, UNIMPLEMENTED: 12, INTERNAL: 13,
  UNAVAILABLE: 14, UNAUTHENTICATED: 16,
} as const;

/** Full method name to signal: the service and method names are fixed by the OTLP proto files. */
export const GRPC_METHODS: Record<string, Signal> = {
  '/opentelemetry.proto.collector.trace.v1.TraceService/Export': 'traces',
  '/opentelemetry.proto.collector.logs.v1.LogsService/Export': 'logs',
  '/opentelemetry.proto.collector.metrics.v1.MetricsService/Export': 'metrics',
};

export interface OtlpGrpcOptions {
  deps?: OtlpRouteDeps;
  /** Concurrent streams per connection (HTTP/2 SETTINGS_MAX_CONCURRENT_STREAMS). */
  maxConcurrentStreams?: number;
  /** A stream with no activity for this long is cancelled. */
  streamIdleMs?: number;
  /** Called once per finished call (for the gateway's counters): the signal and the gRPC status it ended with. */
  onCall?: (info: { signal: Signal; status: number }) => void;
  /** TLS material; absent means cleartext HTTP/2 (h2c), the usual shape behind a proxy that terminates TLS. */
  tls?: { key: Buffer | string; cert: Buffer | string };
}

const PREFIX = 5;

class GrpcError extends Error {
  constructor(readonly grpcStatus: number, message: string, readonly retryAfterSeconds?: number) { super(message); this.name = 'GrpcError'; }
}

/** The status an error maps to. An `AppError` carries the HTTP status the shared pipeline chose; anything else is INTERNAL and says nothing. */
export function toGrpcError(e: unknown): GrpcError {
  if (e instanceof GrpcError) return e;
  const mapped = mapTelemetryError(e);
  if (mapped instanceof AppError) {
    const s = mapped.statusCode;
    const retryAfter = Number(mapped.headers?.['Retry-After']);
    if (s === 401) return new GrpcError(GrpcStatus.UNAUTHENTICATED, mapped.message);
    if (s === 403) return new GrpcError(GrpcStatus.PERMISSION_DENIED, mapped.message);
    if (s === 429) return new GrpcError(GrpcStatus.RESOURCE_EXHAUSTED, mapped.message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1);
    if (s === 402 || s === 413) return new GrpcError(GrpcStatus.RESOURCE_EXHAUSTED, mapped.message);
    if (s === 501) return new GrpcError(GrpcStatus.UNIMPLEMENTED, mapped.message);
    if (s === 502 || s === 503 || s === 504) return new GrpcError(GrpcStatus.UNAVAILABLE, mapped.message);
    if (s >= 400 && s < 500) return new GrpcError(GrpcStatus.INVALID_ARGUMENT, mapped.message);
    return new GrpcError(GrpcStatus.INTERNAL, 'Internal error');
  }
  return new GrpcError(GrpcStatus.INTERNAL, 'Internal error');
}

const headerOf = (h: IncomingHttpHeaders) => ({
  get(name: string): string | null {
    const v = h[name.toLowerCase()];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  },
});

/** `grpc-message` is percent-encoded (spec): printable ASCII except `%` stays, everything else is escaped. */
export const encodeGrpcMessage = (m: string): string =>
  Array.from(Buffer.from(m, 'utf8')).map((b) => (b >= 0x20 && b <= 0x7e && b !== 0x25 ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');

/** The framed message: flag 0 (uncompressed) + length + bytes. */
export function frame(message: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(PREFIX + message.byteLength);
  out[0] = 0;
  out.writeUInt32BE(message.byteLength, 1);
  Buffer.from(message.buffer, message.byteOffset, message.byteLength).copy(out, PREFIX);
  return out;
}

/**
 * Reads exactly one length-prefixed message from the request stream. The declared length is checked against `max` as soon as the 5 prefix
 * bytes are in, so an oversized message is refused without buffering it.
 */
function readOneMessage(stream: ServerHttp2Stream, max: number, encoding: string): Promise<{ bytes: Uint8Array; gzip: boolean }> {
  return new Promise((resolve, reject) => {
    let buf: Buffer = Buffer.alloc(0);
    let need = -1;
    let gzip = false;
    const done = (fn: () => void): void => {
      stream.off('data', onData); stream.off('end', onEnd); stream.off('error', onError); stream.off('aborted', onAbort);
      // Stop reading, but keep the stream open: the refusal still has to be sent on it.
      stream.pause();
      fn();
    };
    const onData = (chunk: Buffer): void => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      if (need < 0 && buf.length >= PREFIX) {
        const flag = buf[0]!;
        if (flag > 1) return done(() => reject(new GrpcError(GrpcStatus.INVALID_ARGUMENT, 'Invalid message prefix')));
        gzip = flag === 1;
        if (gzip && encoding !== 'gzip') return done(() => reject(new GrpcError(GrpcStatus.INVALID_ARGUMENT, 'Compressed message without grpc-encoding')));
        const len = buf.readUInt32BE(1);
        if (len > max) return done(() => reject(new BodyTooLargeError()));
        need = PREFIX + len;
      }
      if (need >= 0 && buf.length > need) done(() => reject(new GrpcError(GrpcStatus.INVALID_ARGUMENT, 'Exactly one message per call')));
    };
    const onEnd = (): void => {
      if (need < 0 || buf.length < need) done(() => reject(new GrpcError(GrpcStatus.INVALID_ARGUMENT, 'Truncated or missing message')));
      else done(() => { stream.setTimeout(0); resolve({ bytes: buf.subarray(PREFIX, need), gzip }); }); // the sender did its part: the idle timer is for slow senders
    };
    const onError = (e: Error): void => done(() => reject(e));
    const onAbort = (): void => done(() => reject(new GrpcError(GrpcStatus.CANCELLED, 'Cancelled')));
    stream.on('data', onData); stream.on('end', onEnd); stream.on('error', onError); stream.on('aborted', onAbort);
  });
}

function sendError(stream: ServerHttp2Stream, e: GrpcError): void {
  if (stream.closed || stream.destroyed || stream.headersSent) { stream.close(http2.constants.NGHTTP2_CANCEL); return; }
  const headers: Record<string, string | number> = {
    ':status': 200, 'content-type': 'application/grpc', 'grpc-status': String(e.grpcStatus), 'grpc-message': encodeGrpcMessage(e.message),
  };
  if (e.grpcStatus === GrpcStatus.RESOURCE_EXHAUSTED && e.retryAfterSeconds) {
    headers['grpc-status-details-bin'] = Buffer.from(encodeRpcStatus(e.grpcStatus, e.message, e.retryAfterSeconds)).toString('base64').replace(/=+$/, '');
  }
  stream.respond(headers, { endStream: true });
  // The sender may still be pushing a message nobody will read (an oversized one): RST_STREAM(NO_ERROR) after the status is the gRPC way to say
  // "stop sending"; without it the call stays half-open until the sender gives up.
  stream.close(http2.constants.NGHTTP2_NO_ERROR);
}

function sendOk(stream: ServerHttp2Stream, message: Uint8Array): void {
  stream.respond({ ':status': 200, 'content-type': 'application/grpc', 'grpc-encoding': 'identity', 'grpc-accept-encoding': 'identity,gzip' }, { waitForTrailers: true });
  stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
  stream.end(frame(message));
}

async function handle(stream: ServerHttp2Stream, headers: IncomingHttpHeaders, deps: OtlpRouteDeps, idleMs: number, onCall?: OtlpGrpcOptions['onCall']): Promise<void> {
  const ct = String(headers['content-type'] ?? '').toLowerCase();
  if (headers[':method'] !== 'POST' || !(ct === 'application/grpc' || ct.startsWith('application/grpc+') || ct.startsWith('application/grpc;'))) {
    stream.respond({ ':status': 415 }, { endStream: true });
    return;
  }
  stream.setTimeout(idleMs, () => { stream.close(http2.constants.NGHTTP2_CANCEL); });
  const signal = GRPC_METHODS[String(headers[':path'] ?? '')];
  if (!signal) { sendError(stream, new GrpcError(GrpcStatus.UNIMPLEMENTED, 'Unknown method')); return; }
  const encoding = String(headers['grpc-encoding'] ?? 'identity').toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') {
    // The spec's answer to an encoding the server does not support: UNIMPLEMENTED, plus what it does support.
    sendError(stream, new GrpcError(GrpcStatus.UNIMPLEMENTED, 'grpc-encoding must be gzip or identity'));
    return;
  }
  try {
    const { result } = await runOtlpPipeline({
      signal, headers: headerOf(headers), encoding: 'protobuf', contentEncoding: 'identity',
      readBody: (max) => readOneMessage(stream, max, encoding),
    }, deps, { allowBrowserKeys: false });
    sendOk(stream, encodePartialSuccess(result.rejected, result.warnings.join('; ')));
    onCall?.({ signal, status: GrpcStatus.OK });
  } catch (e) {
    const g = toGrpcError(e);
    onCall?.({ signal, status: g.grpcStatus });
    if (g.grpcStatus === GrpcStatus.INTERNAL) Logger.error(`[telemetry-gateway] ${signal} export failed: ${e instanceof Error ? e.message : String(e)}`);
    sendError(stream, g);
  }
}

export function createOtlpGrpcServer(opts: OtlpGrpcOptions = {}): Http2Server {
  const deps = opts.deps ?? defaultOtlpDeps;
  const settings = { maxConcurrentStreams: opts.maxConcurrentStreams ?? 64, maxHeaderListSize: 16 * 1024, initialWindowSize: 1024 * 1024 };
  const base = { settings, maxSessionMemory: 64, maxSessionInvalidFrames: 100, maxSessionRejectedStreams: 100 };
  const server: Http2Server = opts.tls
    ? (http2.createSecureServer({ ...base, key: opts.tls.key, cert: opts.tls.cert, allowHTTP1: false }) as unknown as Http2Server)
    : http2.createServer(base);
  server.on('stream', (stream, headers) => {
    handle(stream, headers, deps, opts.streamIdleMs ?? 30_000, opts.onCall).catch((e) => {
      Logger.error(`[telemetry-gateway] stream failed: ${e instanceof Error ? e.message : String(e)}`);
      try { stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR); } catch { /* already closed */ }
    });
  });
  // A broken peer must never take the process down.
  server.on('sessionError', () => undefined);
  return server;
}

