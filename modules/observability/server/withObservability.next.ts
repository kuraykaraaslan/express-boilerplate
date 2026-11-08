import { NextRequest, NextResponse } from 'next/server';
import Logger from '@kuraykaraaslan-labs/logger';
import { resolveRequestId } from '@kuraykaraaslan-labs/logger/server/logger.request-context';
import ObservabilityService from '@kuraykaraaslan-labs/observability';

export interface WithObservabilityOptions {
  tenantId?: string;
  /**
   * The route label of the request metrics. Pass the registry route TEMPLATE (`/api/store/products/[productId]`), never a
   * concrete path: ids and slugs in a label multiply the series without bound. A function is read when the request ends,
   * for callers that only learn the template while handling the request; an unset label falls back to the request path.
   */
  route?: string | (() => string);
  /** Defaults to a valid inbound `x-request-id`, else a fresh uuid. */
  requestId?: string;
}

/** Observability must never decide the outcome of a request: a failing hook is dropped. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // intentionally empty
  }
}

/**
 * Wrap a Next.js route handler so that:
 *
 *  1. Every `Logger.info/warn/error` call inside the handler is tagged with
 *     `[tenant=… user=… req=…]` automatically (AsyncLocalStorage).
 *  2. Sentry events captured during the request carry `tenantId` / `requestId` tags.
 *  3. The Prometheus `http_requests_total` counter + `http_request_duration_seconds`
 *     histogram are bumped on every response — success or failure.
 *  4. The response carries `x-request-id` (best effort: a response whose headers are
 *     immutable is returned as it is).
 *  5. A handler that THROWS is captured by Sentry and re-thrown, and counted as status 500.
 *
 * ORDER MATTERS for the status label: the callback must turn an error into its response
 * (`normalizeError`) itself and return it. A callback that lets an AppError(404) escape is
 * counted as 500, because only a returned response has a status to record. The tenant API
 * dispatcher does exactly that, so it never throws through here and an error is reported
 * once (by `normalizeError`'s sink), not twice.
 *
 * The response body is never read, cloned or buffered: a streaming (SSE) response passes
 * through, and its status and duration are those of the moment its headers were returned.
 *
 * @example
 * export async function GET(
 *   request: NextRequest,
 *   { params }: { params: Promise<{ tenantId: string }> },
 * ) {
 *   const { tenantId } = await params;
 *   return withObservability(
 *     request,
 *     async () => { ... },
 *     { tenantId, route: '/api/tenant/[tenantId]/api/health' },
 *   );
 * }
 */
export async function withObservability(
  request: NextRequest,
  handler: () => Promise<NextResponse | Response>,
  opts: WithObservabilityOptions = {},
): Promise<NextResponse | Response> {
  const tenantId = opts.tenantId ?? extractTenantIdFromUrl(request.url);
  const requestId = opts.requestId ?? resolveRequestId(request.headers.get('x-request-id'));
  const method = request.method;
  const routeLabel = (): string => (typeof opts.route === 'function' ? opts.route() : opts.route ?? request.nextUrl.pathname);
  const t0 = Date.now();

  return Logger.runWithContext({ ...(tenantId ? { tenantId } : {}), requestId }, async () => {
    safely(() => ObservabilityService.setTags({ tenantId, requestId }));

    let response: NextResponse | Response | undefined;
    try {
      response = await handler();
      safely(() => response!.headers.set('x-request-id', requestId));
      return response;
    } catch (err) {
      safely(() => ObservabilityService.recordError(err instanceof Error ? err : new Error(String(err)), {
        tenantId,
        extra: { route: routeLabel(), method, requestId },
      }));
      throw err;
    } finally {
      const status = response?.status ?? 500;
      safely(() => ObservabilityService.recordHttpRequest({
        tenantId,
        route: routeLabel(),
        method,
        status,
        latencyMs: Date.now() - t0,
      }));
    }
  });
}

/** Pull `[tenantId]` from `/tenant/<uuid>/...` path segments. */
function extractTenantIdFromUrl(url: string): string | undefined {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/^\/tenant\/([^/]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}
