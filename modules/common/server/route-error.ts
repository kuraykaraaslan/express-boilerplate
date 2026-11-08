import { NextResponse } from 'next/server';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError } from './app-error';

/**
 * Receives an error the boundary turned into a 5xx. `common` is a leaf and cannot import `observability`, so the
 * observability facade registers its `recordError` here at boot (`ObservabilityService.init`); with no sink registered
 * nothing happens. Held on `globalThis` so the instrumentation hook and the route bundles, which can load this file twice,
 * see the same one.
 */
export type UnhandledErrorSink = (error: Error) => void;
const SINK_KEY = Symbol.for('kuraykaraaslan-labs.common.unhandledErrorSink');
const sinkHolder = globalThis as unknown as Record<symbol, UnhandledErrorSink | null | undefined>;

export function setUnhandledErrorSink(sink: UnhandledErrorSink | null): void {
  sinkHolder[SINK_KEY] = sink;
}

/** Hands a 5xx error to the sink. Never throws: reporting must not change the response. */
function reportServerError(error: unknown): void {
  try {
    sinkHolder[SINK_KEY]?.(error instanceof Error ? error : new Error(String(error)));
  } catch {
    // a failing sink never changes the response
  }
}

/**
 * Central route error boundary. Converts a thrown error from a dispatched API
 * handler into a normalized JSON response, so handlers can simply
 * `throw new AppError(...)` (or let a service throw) and stay free of per-route
 * try/catch. Wired into the catch-all dispatcher (`app/tenant/[tenantId]/api/[...slug]/route.ts`).
 *
 * Mapping:
 *   - AppError            → its own `statusCode` + `{ message, code }`, plus any
 *                           `AppError.headers` (e.g. a 429's `Retry-After` / `X-RateLimit-*`).
 *   - ZodError-shaped     → 400 `{ message, issues }` (duck-typed to avoid a zod import).
 *   - SyntaxError         → 400 (malformed JSON body).
 *   - PostgreSQL 25006    → 503 + `Retry-After` (a write to a read-only transaction: the tenant is being moved to another
 *                           node and its write fence is up, docs/phases/02-fleet/05 section 6.2; reads keep working).
 *   - anything else       → 500 (logged; message hidden behind a generic string).
 *
 * Only the 5xx outcomes (the last branch, and an AppError whose statusCode is 500 or above) reach the error sink; a 4xx
 * is the caller's mistake, not an incident.
 */
export function normalizeError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) reportServerError(error);
    return NextResponse.json(
      { message: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) },
      { status: error.statusCode, headers: error.headers },
    );
  }

  // zod ValidationError — duck-typed (`name === 'ZodError'` with an `issues` array)
  if (
    error &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  ) {
    return NextResponse.json(
      { message: 'Validation error', issues: (error as { issues: unknown[] }).issues },
      { status: 400 },
    );
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json({ message: 'Malformed request body' }, { status: 400 });
  }

  // A write inside a read-only transaction: the db layer's write fence of a tenant being moved (db.write-fence.ts). Temporary, not an incident.
  const pg = error as { code?: unknown; driverError?: { code?: unknown } } | null;
  if (pg && typeof pg === 'object' && (pg.code === '25006' || pg.driverError?.code === '25006')) {
    return NextResponse.json(
      { message: 'This workspace is read-only while it is being moved. Please try again later.', code: 'TENANT_READ_ONLY' },
      { status: 503, headers: { 'Retry-After': '300' } },
    );
  }

  Logger.error('[route] Unhandled error:', error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined);
  reportServerError(error);
  return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
}
