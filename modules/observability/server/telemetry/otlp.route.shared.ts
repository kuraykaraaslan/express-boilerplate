/**
 * The one handler behind `/api/telemetry/otlp/v1/{traces,logs,metrics}`. Each route file is a three-line adapter; the security path
 * (authentication, limits, decode, tenant stamping, scrubbing, sampling) lives in `otlp.pipeline.ts`, which the gRPC gateway uses too.
 * This file adds only what is HTTP: content type, Content-Length, the Response.
 */
import { NextResponse } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import type { OtlpEncoding } from './otlp.ingest';
import { encodePartialSuccess } from './otlp.protobuf';
import { defaultOtlpDeps, runOtlpPipeline, type OtlpRouteDeps } from './otlp.pipeline';
import { normalizeOrigin } from './telemetry.browser-keys';
import { mapTelemetryError, readBounded } from './telemetry.http';
import type { Signal } from './telemetry.types';

export { defaultOtlpDeps, type OtlpRouteDeps };

const CORS_HEADERS = 'authorization, content-type, content-encoding';

/**
 * The CORS preflight of the OTLP routes, for the browser snippet. It is unauthenticated by nature (a preflight carries no key), so it decides
 * nothing: it echoes a well-formed origin and names the headers. The decision is made on the real request, from the key and its allow-list.
 */
export function handlePreflight(request: { headers: { get(n: string): string | null } }): Response {
  const origin = normalizeOrigin(request.headers.get('origin') ?? '');
  return new Response(null, { status: 204, headers: {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': '86400', Vary: 'Origin',
  } });
}

function encodingOf(contentType: string | null): OtlpEncoding {
  const ct = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct === 'application/json') return 'json';
  if (ct === 'application/x-protobuf' || ct === 'application/protobuf') return 'protobuf';
  throw new AppError('Content-Type must be application/json or application/x-protobuf', 415, ErrorCode.VALIDATION_ERROR);
}

const REJECTED_FIELD: Record<Signal, string> = { traces: 'rejectedSpans', logs: 'rejectedLogRecords', metrics: 'rejectedDataPoints' };

export async function handleOtlp(signal: Signal, request: Request & { body: ReadableStream<Uint8Array> | null }, deps: OtlpRouteDeps = defaultOtlpDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new AppError('Method not allowed', 405, ErrorCode.VALIDATION_ERROR);
    const encoding = encodingOf(request.headers.get('content-type'));
    const contentEncoding = (request.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
    if (contentEncoding !== 'identity' && contentEncoding !== 'gzip') throw new AppError('Content-Encoding must be gzip or identity', 415, ErrorCode.VALIDATION_ERROR);

    const declared = Number(request.headers.get('content-length'));
    const { result, browserOrigin } = await runOtlpPipeline({
      signal, headers: request.headers, encoding, contentEncoding,
      ...(Number.isFinite(declared) && request.headers.get('content-length') !== null ? { declaredBytes: declared } : {}),
      readBody: (max) => readBounded(request, max),
    }, deps);

    const message = result.warnings.join('; ');
    // The origin was verified in the pipeline, so it may read the answer; nobody else gets the header (and a refusal never does).
    const cors: Record<string, string> = browserOrigin ? { 'Access-Control-Allow-Origin': browserOrigin, Vary: 'Origin' } : {};
    if (encoding === 'protobuf') {
      const bytes = encodePartialSuccess(result.rejected, message);
      return new NextResponse(bytes as unknown as BodyInit, { status: 200, headers: { 'Content-Type': 'application/x-protobuf', ...cors } });
    }
    return NextResponse.json(result.rejected > 0 ? { partialSuccess: { [REJECTED_FIELD[signal]]: String(result.rejected), errorMessage: message } } : {}, { status: 200, headers: cors });
  } catch (e) {
    return normalizeError(mapTelemetryError(e));
  }
}
