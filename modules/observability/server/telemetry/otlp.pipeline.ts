/**
 * The ONE security path of OTLP ingest, shared by the HTTP routes (`otlp.route.shared.ts`) and the gRPC gateway (`otlp.grpc.ts`).
 * Framework-free (no `next/*`): a sidecar may import it.
 *
 * Order, and why:
 *   1. declared size against the hard ceiling  (before any work for an unauthenticated caller)
 *   2. authenticate: the tenant comes from the ingest key and from nothing else
 *   3. the key's tenant must have the module on
 *   4. tenant limits: body size, then rate and the plan
 *   5. bounded read, bounded gunzip, ingest (decode, stamp the tenant over any client value, scrub, sample, write)
 *
 * A transport only translates its wire format into `OtlpWireRequest` and the outcome back; it never decides anything about tenants or limits.
 */
import { gunzipSync } from 'node:zlib';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import Logger from '@kuraykaraaslan-labs/logger';
import { ingestOtlp, type IngestResult, type OtlpEncoding } from './otlp.ingest';
import { apiKeyVerifier, moduleEnabledGate, type TelemetryKeyVerifier, type TenantGate } from './telemetry.auth';
import { BodyTooLargeError, requireBackend } from './telemetry.http';
import { acquireTenantSlot } from '../observability.concurrency';
import { getTelemetryLimits, HARD_MAX_BODY_BYTES, type TelemetryLimits } from './telemetry.limits';
import { MemoryDecisionStore, type TraceDecisionStore } from './telemetry.sampling';
import { BROWSER_LIMITS, checkBrowserOrigin, getBrowserKeyConfig, type BrowserKeyConfig } from './telemetry.browser-keys';
import type { Signal } from './telemetry.types';

export interface OtlpRouteDeps {
  verifier: TelemetryKeyVerifier;
  gate: TenantGate;
  limits: () => TelemetryLimits;
  store: TraceDecisionStore;
  /** Browser keys: their configuration (Origin allow-list, rate) and the per-key rate limiter. Replaceable in tests. */
  browser?: {
    config(tenantId: string, apiKeyId: string): Promise<BrowserKeyConfig | null>;
    rate(apiKeyId: string, limit: number, tenantId: string): Promise<void>;
  };
}

/** A fixed-window counter per browser key through the shared limiter (fail-open on a Redis outage, like every limiter use). */
async function defaultBrowserRate(apiKeyId: string, limit: number, tenantId: string): Promise<void> {
  const { check } = await import('@kuraykaraaslan-labs/limiter/server/limiter.service');
  const res = await check(`telemetry:browser:${apiKeyId}`, 'api', { limit, tenantId });
  if (!res.success) throw new AppError('Telemetry rate limit exceeded', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { retryable: true, headers: { 'Retry-After': String(res.retryAfter) } });
}

export const defaultBrowser: NonNullable<OtlpRouteDeps['browser']> = { config: getBrowserKeyConfig, rate: defaultBrowserRate };

const sharedStore = new MemoryDecisionStore();

export const defaultOtlpDeps: OtlpRouteDeps = { verifier: apiKeyVerifier, gate: moduleEnabledGate, limits: getTelemetryLimits, store: sharedStore, browser: defaultBrowser };

/** Decompressed size may be this many times the wire size, never more than the hard ceiling times two. */
export const GUNZIP_RATIO = 8;

export interface OtlpWireRequest {
  signal: Signal;
  /** Where credentials are read from (`authorization`, `x-api-key`): HTTP headers, or gRPC metadata. */
  headers: { get(name: string): string | null };
  encoding: OtlpEncoding;
  contentEncoding: 'identity' | 'gzip';
  /** Size announced by the transport (Content-Length, the gRPC message prefix), when it announced one. */
  declaredBytes?: number;
  /**
   * Reads the (possibly compressed) message, aborting with `BodyTooLargeError` as soon as it exceeds `maxBytes`. A transport whose
   * compression is per message (gRPC) answers `{ bytes, gzip }`; the pipeline then inflates it under the same bounds as an HTTP body.
   */
  readBody(maxBytes: number): Promise<Uint8Array | { bytes: Uint8Array; gzip: boolean }>;
}

export interface OtlpWireOutcome {
  result: IngestResult;
  tenantId: string;
  /** Set for a browser key whose Origin was verified: the only origin that may read the answer (CORS). HTTP only. */
  browserOrigin?: string;
}

export interface OtlpPipelineOptions {
  /**
   * A browser key is public by nature and its restrictions rest on the browser's `Origin` header, which only an HTTP request has. A transport without
   * one (gRPC) sets false: a browser key is then refused outright rather than allowed through without its origin check.
   */
  allowBrowserKeys?: boolean;
}

async function maxInFlight(deps: OtlpRouteDeps, tenantId: string): Promise<number | undefined> {
  const limits = deps.limits();
  return limits.maxInFlight ? await limits.maxInFlight(tenantId) : undefined;
}

export async function runOtlpPipeline(req: OtlpWireRequest, deps: OtlpRouteDeps = defaultOtlpDeps, opts: OtlpPipelineOptions = {}): Promise<OtlpWireOutcome> {
  const { signal } = req;
  if (req.declaredBytes !== undefined && Number.isFinite(req.declaredBytes) && req.declaredBytes > HARD_MAX_BODY_BYTES) {
    throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR);
  }

  const principal = await deps.verifier.verify({ headers: req.headers });
  const { tenantId } = principal;
  if (!(await deps.gate(tenantId))) throw new AppError('Telemetry is not enabled for this workspace', 403, ErrorCode.FEATURE_NOT_AVAILABLE);

  // A tenant's requests in progress are bounded before any body is read (observability.concurrency.ts): a flood from one tenant cannot queue in front of the others.
  const release = acquireTenantSlot(tenantId, 'telemetry_ingest', await maxInFlight(deps, tenantId));
  try {
    // A browser key (public by nature) gets the narrow lane: metrics and logs, from an allow-listed Origin, at a low rate, in a small body.
    let browserOrigin: string | undefined;
    if (principal.browser) {
      if (opts.allowBrowserKeys === false) throw new AppError('This key may not be used on this endpoint', 403, ErrorCode.FORBIDDEN);
      const bd = deps.browser ?? defaultBrowser;
      if (signal === 'traces') throw new AppError('This key may not write traces', 403, ErrorCode.FORBIDDEN);
      const config = await bd.config(tenantId, principal.apiKeyId);
      const verdict = checkBrowserOrigin(config, req.headers.get('origin'));
      if (!verdict.ok) throw new AppError('This key may not be used from this origin', 403, ErrorCode.FORBIDDEN);
      browserOrigin = verdict.origin;
      await bd.rate(principal.apiKeyId, config!.ratePerMinute, tenantId);
    }

    const backend = requireBackend();
    const limits = deps.limits();
    const maxBody = Math.min(await limits.maxBodyBytes(tenantId, signal), HARD_MAX_BODY_BYTES, ...(principal.browser ? [BROWSER_LIMITS.maxBodyBytes] : []));
    if (req.declaredBytes !== undefined && Number.isFinite(req.declaredBytes) && req.declaredBytes > maxBody) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR);

    let raw: Uint8Array;
    let gzip = req.contentEncoding === 'gzip';
    try {
      const read = await req.readBody(maxBody);
      if (read instanceof Uint8Array) raw = read;
      else { raw = read.bytes; gzip = read.gzip; }
    } catch (e) {
      if (e instanceof BodyTooLargeError) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR);
      throw e;
    }
    await limits.admitIngest(tenantId, signal, { bytes: raw.byteLength });

    let body = raw;
    if (gzip) {
      try {
        body = gunzipSync(raw, { maxOutputLength: Math.min(maxBody * GUNZIP_RATIO, HARD_MAX_BODY_BYTES * 2, ...(principal.browser ? [BROWSER_LIMITS.maxBodyBytes] : [])) });
      } catch (e) {
        const tooBig = (e as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError;
        throw new AppError(tooBig ? 'Payload too large once decompressed' : 'Malformed gzip body', tooBig ? 413 : 400, ErrorCode.VALIDATION_ERROR);
      }
    }

    const decodeLimits = await limits.decode(tenantId, signal);
    const result = await ingestOtlp(backend, deps.store, {
      signal, tenantId, body, encoding: req.encoding,
      decode: principal.browser ? { ...decodeLimits, maxItems: Math.min(decodeLimits.maxItems, BROWSER_LIMITS.maxItems) } : decodeLimits,
      sampling: await limits.sampling(tenantId), ...(principal.browser ? { browser: true } : {}),
    });
    if (result.rejected > 0) Logger.warn(`[telemetry] ingest ${signal}: ${result.rejected} rejected (${result.warnings.join('; ')})`);
    return { result, tenantId, ...(browserOrigin ? { browserOrigin } : {}) };
  } finally { release(); }
}

/**
 * Loads what the first ingest call would otherwise load lazily (the key store, the plan and metering code, Redis). Measured: a cold first call
 * takes ten seconds in a fresh process, which an exporter's timeout would turn into a failed export; a sidecar calls this before it listens.
 */
export async function warmIngestDependencies(): Promise<void> {
  await Promise.allSettled([
    import('@kuraykaraaslan-labs/api_key/server/api_key.service'),
    import('@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next'),
    import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.headroom'),
    import('@kuraykaraaslan-labs/common/server/common.usage-meter').then((m) => m.warmUsageMeterSink()),
    import('@kuraykaraaslan-labs/limiter/server/limiter.service'),
    import('@kuraykaraaslan-labs/redis'),
  ]);
}
