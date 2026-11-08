/** The one HTTP helper the Prometheus, Loki and Tempo adapters share: timeout, tenant header, bounded response, no backend bodies in errors. */
import { TelemetryBackendError } from '../telemetry.backend';

export interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }) => Promise<FetchResponseLike>;

export interface HttpTarget {
  baseUrl: string;
  /** Extra headers on every request (an auth token for the backend, never anything from a tenant). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
}

export const MAX_RESPONSE_CHARS = 16 * 1024 * 1024;

export interface RequestOptions {
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Statuses that are an answer, not a failure (for example 404 on a trace lookup). */
  okStatuses?: number[];
}

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
  }
  const s = qs.toString();
  return `${base}${path}${s ? `?${s}` : ''}`;
}

export async function httpRequest(target: HttpTarget, adapterId: string, method: 'GET' | 'POST' | 'PUT', path: string, opts: RequestOptions = {}): Promise<{ status: number; text: string }> {
  const doFetch: FetchLike = target.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), target.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(buildUrl(target.baseUrl, path, opts.query), {
      method, headers: { ...(target.headers ?? {}), ...(opts.headers ?? {}) }, body: opts.body, signal: ctrl.signal,
    });
    const ok = res.status >= 200 && res.status < 300 || (opts.okStatuses ?? []).includes(res.status);
    if (!ok) throw new TelemetryBackendError(`${adapterId} answered HTTP ${res.status}`, res.status);
    const text = await res.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new TelemetryBackendError(`${adapterId} response is too large`);
    return { status: res.status, text };
  } catch (e) {
    if (e instanceof TelemetryBackendError) throw e;
    throw new TelemetryBackendError(`${adapterId} is unreachable${ctrl.signal.aborted ? ' (timeout)' : ''}`);
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(adapterId: string, text: string): unknown {
  try { return text ? JSON.parse(text) : {}; } catch { throw new TelemetryBackendError(`${adapterId} returned malformed JSON`); }
}
