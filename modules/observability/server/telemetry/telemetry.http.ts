/** Shared HTTP plumbing of the telemetry routes: error mapping, bounded body reading, the backend guard. */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { TelemetryBackendError, TelemetryUnsupportedError, type TelemetryBackend } from './telemetry.backend';
import { getTelemetryBackend } from './telemetry.config';

/** Turns the port's errors into `AppError`s the route boundary understands. Anything else is passed through untouched. */
export function mapTelemetryError(e: unknown): unknown {
  if (e instanceof TelemetryUnsupportedError) {
    return new AppError('This operation is not supported by the configured telemetry backend', 501, ErrorCode.FEATURE_NOT_AVAILABLE, { details: { operation: e.operation } });
  }
  if (e instanceof TelemetryBackendError) {
    // A retryable status for OTLP exporters (502/503/504 are retried, 4xx is not). The backend's own message and body stay in the log.
    return new AppError('The telemetry backend is unavailable', e.status && e.status >= 400 && e.status < 500 ? 502 : 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
  }
  return e;
}

export function requireBackend(): TelemetryBackend {
  const b = getTelemetryBackend();
  if (!b) throw new AppError('Telemetry storage is not configured', 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
  return b;
}

export class BodyTooLargeError extends Error {
  constructor() { super('payload too large'); this.name = 'BodyTooLargeError'; }
}

/** Reads a request body, aborting as soon as it exceeds `max` bytes (a missing or lying Content-Length changes nothing). */
export async function readBounded(request: { body: ReadableStream<Uint8Array> | null; headers: { get(n: string): string | null } }, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); throw new BodyTooLargeError(); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** The JSON body of a query request, bounded (query objects are small) and refused with a 400 when it is not JSON. */
export async function readJsonBody(request: { body: ReadableStream<Uint8Array> | null; headers: { get(n: string): string | null } }, max = 64 * 1024): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(request, max);
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw new AppError('Request body too large', 413, ErrorCode.VALIDATION_ERROR);
    throw e;
  }
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AppError('Malformed request body', 400, ErrorCode.VALIDATION_ERROR);
  }
}
