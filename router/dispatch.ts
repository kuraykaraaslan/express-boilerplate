// The one place every core module API is served from: the Express twin of next-boilerplate's
// app/tenant/[tenantId]/api/[...slug]/route.ts. A path resolves through the module registry to a verbatim handler of the generated
// `apiHandlers` map; before it runs, the tenant is known, the CSRF gate has passed, the module is on for the tenant, and the log,
// tenant and settle contexts are open. Handlers are the NB route files, unchanged, running on the `next/server` shim.
import type { Request as ExpressRequest, RequestHandler, Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { requestContext } from '../shims/next/request-context';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { apiHandlers } from '@kuraykaraaslan-labs/common/server/generated/api-handlers';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { watchAnswer } from '@kuraykaraaslan-labs/common/server/route-answers';
import { observeRequest } from '@kuraykaraaslan-labs/common/server/request-observer';
import { openRequestSettle, settleRequest } from '@kuraykaraaslan-labs/common/server/request-settle';
import { assertCsrf, followSessionWithCsrfCookie } from '@kuraykaraaslan-labs/common/server/csrf';
import { runWithTenant } from '@kuraykaraaslan-labs/db/server/db.context';
import { PROBE_ACCEPTED_HEADER, probeStampOf } from '@kuraykaraaslan-labs/common/server/common.firewall-probe-gate';
import { runWithProbeRun } from '@kuraykaraaslan-labs/common/server/common.firewall-probe-run';
import { withObservability } from '@kuraykaraaslan-labs/observability/server/withObservability.next';
import { isRootSurfaceHost, hostWithoutPort } from '@kuraykaraaslan-labs/common/server/tenant-host';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import TenantDomainService from '@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service';
import { isServingDomain } from '@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.serving';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANCY_MODE = (process.env.TENANCY_MODE || 'domain') as 'domain' | 'path';
const TENANT_PATH_PREFIX = process.env.TENANT_PATH_PREFIX || 't';

const rootSurfaceEnv = () => ({
  wildcard: process.env.NEXT_PUBLIC_TENANT_WILDCARD_DOMAIN || process.env.TENANT_WILDCARD_DOMAIN || 'example.com',
  rootSubdomain: process.env.TENANT_DEFAULT_SUBDOMAIN || 'system',
  production: process.env.NODE_ENV === 'production',
  allowLocalhostRoot: process.env.ALLOW_LOCALHOST_ROOT === 'true',
});

const notFound = () => NextResponse.json({ message: 'Not found', code: 'NOT_FOUND' }, { status: 404 });

type Target = { tenantId: string; apiPath: string };

/**
 * Which tenant and which module path a request addresses. Explicit forms (`/tenant/{id}/api/..`, and `/{prefix}/{id}/api/..` in path
 * tenancy) name the tenant; a bare `/api/..` is the host's tenant in domain mode and the root tenant in path mode. In domain mode an
 * explicit tenant may only be the host's own (the root surface is the one cross-tenant gateway), as the NB proxy decides.
 */
async function resolveTarget(pathname: string, host: string): Promise<Target | null> {
  const explicit = pathname.match(/^\/(?:tenant|api\/tenant)\/([^/]+)(\/api(?:\/.*)?)?$/) ?? (TENANCY_MODE === 'path' ? pathname.match(new RegExp(`^/${TENANT_PATH_PREFIX}/([^/]+)(/api(?:/.*)?)$`)) : null);
  let hostTenant: string | null | undefined;
  const fromHost = async (): Promise<string | null> => {
    if (hostTenant !== undefined) return hostTenant;
    if (isRootSurfaceHost(host, rootSurfaceEnv())) return (hostTenant = ROOT_TENANT_ID);
    try {
      const info = await TenantDomainService.getByDomain(host);
      if (!info) return (hostTenant = null);
      // The platform's managed base domains (the table's list); the environment's wildcard when it cannot be read.
      const bases = await TenantDomainService.managedBases().catch(() => process.env.TENANT_WILDCARD_DOMAIN || process.env.NEXT_PUBLIC_TENANT_WILDCARD_DOMAIN || null);
      return (hostTenant = isServingDomain(info, bases) ? info.tenantId : null);
    } catch { return (hostTenant = null); }
  };
  if (explicit) {
    const tenantId = explicit[1];
    if (!TENANT_ID_RE.test(tenantId)) return null;
    if (TENANCY_MODE === 'domain') {
      const own = await fromHost();
      if (!own || (own !== tenantId.toLowerCase() && own !== ROOT_TENANT_ID)) return null;
    }
    return { tenantId: tenantId.toLowerCase(), apiPath: explicit[2] ?? '/api/' };
  }
  if (!pathname.startsWith('/api/') && pathname !== '/api') return null;
  const tenantId = TENANCY_MODE === 'domain' ? await fromHost() : ROOT_TENANT_ID;
  return tenantId ? { tenantId, apiPath: pathname } : null;
}

type Seen = { tenantId: string | null; route: string | null };
const contentLengthOf = (response: Response): number | null => {
  const n = Number(response.headers.get('content-length') ?? NaN);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

async function answer(method: string, request: NextRequest, target: Target, seen: Seen): Promise<Response> {
  const { tenantId, apiPath } = target;
  seen.tenantId = tenantId;
  let routeLabel = 'unmatched';
  return withObservability(request, async () => {
    try {
      if (!SAFE_METHODS.has(method)) assertCsrf(request, apiPath, { addressedTenantId: tenantId });
      const match = moduleRegistry.findApiRoute(apiPath, { tenantId });
      if (!match) return NextResponse.json({ message: 'Not found' }, { status: 404 });
      const enabled = await getEnabledModuleIds(tenantId);
      if (!enabled.has(match.route.moduleId)) return NextResponse.json({ message: `Module "${match.route.moduleId}" is disabled` }, { status: 404 });
      const loader = apiHandlers[match.route.handlerId];
      if (!loader) return NextResponse.json({ message: 'Handler not found' }, { status: 404 });
      const mod = await loader();
      const handler = mod[method];
      if (typeof handler !== 'function') return NextResponse.json({ message: 'Method not allowed' }, { status: 405 });
      routeLabel = match.route.path;
      seen.route = routeLabel;
      openRequestSettle(request);
      try {
        return await runWithTenant(tenantId, () => handler(request, { params: Promise.resolve({ tenantId, ...match.params }) }));
      } finally {
        settleRequest(request);
      }
    } catch (error) {
      return normalizeError(error);
    }
  }, { tenantId, route: () => routeLabel });
}

async function dispatch(method: string, request: NextRequest, target: Target): Promise<Response> {
  const seen: Seen = { tenantId: null, route: null };
  const probe = probeStampOf(request);
  const response = followSessionWithCsrfCookie(request, await runWithProbeRun(probe?.stamp ?? null, async () => {
    const answered = await answer(method, request, target, seen);
    void watchAnswer(request, target.apiPath, answered.status);
    return answered;
  }));
  if (probe?.stamp) {
    try { response.headers.set(PROBE_ACCEPTED_HEADER, probe.stamp.runId); } catch { /* an immutable answer goes as it is */ }
  }
  observeRequest({
    phase: 'api', request, tenantId: seen.tenantId, path: target.apiPath, route: seen.route, status: response.status,
    responseBytes: contentLengthOf(response),
  });
  return response;
}

/** Express request -> web request. Next fills x-forwarded-* when no proxy did; the same is done here. */
function toNextRequest(req: ExpressRequest): NextRequest {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x); else headers.set(k, v);
  }
  const host = req.headers.host ?? 'localhost';
  if (!headers.has('x-forwarded-for') && req.socket.remoteAddress) headers.set('x-forwarded-for', req.socket.remoteAddress);
  if (!headers.has('x-forwarded-host')) headers.set('x-forwarded-host', host);
  if (!headers.has('x-forwarded-proto')) headers.set('x-forwarded-proto', req.protocol);
  const hasBody = !SAFE_METHODS.has(req.method);
  return new NextRequest(`${req.protocol}://${host}${req.originalUrl}`, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    duplex: 'half',
  });
}

async function send(res: ExpressResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (!response.body) { res.end(); return; }
  Readable.fromWeb(response.body as never).pipe(res);
}

/** Mount before any body parser: handlers read the request body themselves. */
export const moduleApi: RequestHandler = async (req, res, next) => {
  try {
    const target = await resolveTarget(req.path, hostWithoutPort(req.headers.host ?? ''));
    if (!target) {
      if (req.path.startsWith('/api/') || /^\/(?:tenant|api\/tenant)\//.test(req.path)) { await send(res, notFound()); return; }
      next();
      return;
    }
    const request = toNextRequest(req);
    const response = await requestContext.run(request, () => dispatch(req.method, request, target));
    await send(res, response);
  } catch (error) {
    next(error);
  }
};
