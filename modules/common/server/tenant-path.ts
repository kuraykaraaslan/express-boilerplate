/**
 * Tenant-aware URL construction — the single place that knows how a tenant is
 * addressed in a URL.
 *
 * Every tenant page and API route is *served* from the internal
 * `/tenant/{tenantId}/…` route tree (app/tenant/[tenantId]/**). How a browser
 * *addresses* it depends on TENANCY_MODE:
 *
 *   domain / subdomain →  the host selects the tenant, so URLs carry no prefix
 *                         at all: `/admin/users`, `/api/auth/session`.
 *                         proxy.ts rewrites them under /tenant/{id} internally.
 *   path               →  `/{TENANT_PATH_PREFIX}/{tenantId}/admin/users`.
 *
 * `subdomain` is an ALIAS of `domain`: proxy.ts resolves every host — apex,
 * wildcard subdomain and custom domain — through tenant_domain, so there has
 * never been a separate subdomain code path. It stays in the zod enum
 * (env.schema.core.ts) for config compatibility only.
 *
 * This module has NO imports on purpose: it is loaded by proxy.ts, by server
 * components, by route handlers and by the client bundle alike.
 */

export type TenancyMode = 'domain' | 'path';

export type TenancyRuntime = {
  mode: TenancyMode;
  /** Path-mode prefix segment, slashes stripped (e.g. "t"). */
  prefix: string;
};

/**
 * The internal route segment. Always resolvable in every mode (proxy.ts passes
 * `/tenant/{id}/…` straight through), which is what makes it the cross-tenant
 * addressing scheme — see crossTenantPath().
 */
export const TENANT_ROUTE_SEGMENT = 'tenant';

const DEFAULT_PREFIX = 't';

/** Only [A-Za-z0-9_-] survives: the value lands in a URL *and* in an inline <script>. */
function sanitizePrefix(raw: string | undefined | null): string {
  return (raw ?? '').replace(/[^A-Za-z0-9_-]/g, '') || DEFAULT_PREFIX;
}

function normalizeMode(raw: string | undefined | null): TenancyMode {
  return raw === 'path' ? 'path' : 'domain';
}

declare global {
  interface Window {
    __TENANCY__?: { mode?: string; prefix?: string };
  }
}

let cached: TenancyRuntime | null = null;

/**
 * Resolved tenancy config for the current execution context.
 *
 * Server: process.env, which is live at container start — NOT baked at build
 * time. That matters: `output: "standalone"` images are built once and
 * configured per deployment, and the Dockerfile passes no NEXT_PUBLIC_* build
 * args, so a build-time inline would always be undefined there.
 *
 * Client: the value the server published via <TenancyScript/> before hydration,
 * so tenantPath() returns the identical string on both sides of the render.
 */
export function tenancyRuntime(): TenancyRuntime {
  if (cached) return cached;

  if (typeof window !== 'undefined') {
    const injected = window.__TENANCY__;
    const runtime: TenancyRuntime = {
      mode: normalizeMode(injected?.mode ?? process.env.NEXT_PUBLIC_TENANCY_MODE),
      prefix: sanitizePrefix(injected?.prefix ?? process.env.NEXT_PUBLIC_TENANT_PATH_PREFIX),
    };
    // Only memoize a real injected value — never a pre-script fallback guess.
    if (injected) cached = runtime;
    return runtime;
  }

  cached = {
    mode: normalizeMode(process.env.TENANCY_MODE ?? process.env.NEXT_PUBLIC_TENANCY_MODE),
    prefix: sanitizePrefix(process.env.TENANT_PATH_PREFIX ?? process.env.NEXT_PUBLIC_TENANT_PATH_PREFIX),
  };
  return cached;
}

/** Test-only: drop the memoized runtime after mutating process.env / window. */
export function __resetTenancyRuntime(): void {
  cached = null;
}

export function tenancyMode(): TenancyMode {
  return tenancyRuntime().mode;
}

/** '' | '/' | '/a/b' — never a bare 'a/b'. */
function normalizeAppPath(appPath: string): string {
  if (!appPath) return '';
  return appPath.startsWith('/') ? appPath : `/${appPath}`;
}

/**
 * Prefix that addresses `tenantId` on the CURRENT host.
 *   domain → ''                (the host already identifies the tenant)
 *   path   → '/t/{tenantId}'
 *
 * Built for direct concatenation: `${tenantBasePath(id)}/api/auth/session`.
 * Use this — not tenantPath(id, '') — wherever the result is a *base* a caller
 * appends to, because '' is the correct base in domain mode.
 */
export function tenantBasePath(tenantId: string): string {
  const { mode, prefix } = tenancyRuntime();
  return mode === 'path' ? `/${prefix}/${tenantId}` : '';
}

/**
 * A link / fetch target for the CURRENT tenant.
 *   domain → '/admin/users'
 *   path   → '/t/{id}/admin/users'
 *
 * `tenantId` is IGNORED in domain mode — the host decides. Passing a *foreign*
 * tenant id here is therefore a silent bug that resolves to the current tenant:
 * use crossTenantPath() for that.
 *
 * Always returns a usable href: tenantPath(id) is '/' in domain mode, not ''.
 */
export function tenantPath(tenantId: string, appPath: string = ''): string {
  return `${tenantBasePath(tenantId)}${normalizeAppPath(appPath)}` || '/';
}

/**
 * Address a DIFFERENT tenant from the current host — always the explicit
 * `/tenant/{id}` form, which proxy.ts passes through unchanged in every mode.
 *
 * This is the only way to reach another tenant without leaving the origin.
 * Session cookies are host-only (no `domain=` attribute is set anywhere in
 * modules/user_session/server), so navigating to the other tenant's own domain
 * would drop the session.
 */
export function crossTenantPath(tenantId: string, appPath: string = ''): string {
  return `/${TENANT_ROUTE_SEGMENT}/${tenantId}${normalizeAppPath(appPath)}`;
}

/**
 * Address ANOTHER tenant on this host so that its session cookie applies: the tenant switcher's exchange call, the page
 * it lands on, a redirect to the root tenant's picker. Path mode: `/t/{id}/…`, the path its cookie is scoped to
 * (user_session.cookie.next sessionCookiePath), so `/tenant/{id}/…` there would arrive without it. Domain mode: the
 * explicit `/tenant/{id}/…` (crossTenantPath), because tenantPath() ignores the id and would address the host's tenant.
 */
export function switchTenantPath(tenantId: string, appPath: string = ''): string {
  return tenancyMode() === 'path' ? tenantPath(tenantId, appPath) : crossTenantPath(tenantId, appPath);
}

/**
 * Absolute URL for `appPath` of `tenantId` on the PLATFORM host (`appHost`, e.g. APPLICATION_HOST), for a link that leaves
 * the app (a mail, a push) when the tenant has no host of its own to link to. Path mode: `/t/{id}/…`; domain mode: the
 * explicit `/tenant/{id}/…` form, which proxy.ts serves on any host, because a clean path on the platform host is the
 * ROOT tenant. tenant_domain's `absoluteTenantUrl` prefers the tenant's own ACTIVE domain and falls back to this.
 */
export function platformTenantUrl(appHost: string, tenantId: string, appPath: string): string {
  return `${appHost}${tenancyMode() === 'path' ? tenantPath(tenantId, appPath) : crossTenantPath(tenantId, appPath)}`;
}

const TENANT_ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inverse of tenantPath(): strip whatever tenant prefix a pathname carries.
 *
 * Recognizes BOTH `/tenant/{uuid}` (internal rewrite target, cross-tenant
 * links, stale bookmarks) and the configured `/{prefix}/{uuid}` path-mode
 * shape, in EVERY mode. That tolerance is the point: a value read from
 * usePathname() must compare correctly regardless of which shape produced it,
 * so comparison sites stop caring about the mode entirely.
 *
 * The second segment must be a UUID (Tenant.tenantId is
 * @PrimaryGeneratedColumn('uuid')), so a public CMS page at `/tenant/about` or
 * `/t/pricing` is never mistaken for a tenant prefix.
 *
 * `base` is the exact matched prefix ('' when none) — use it to rebuild a URL
 * in the same shape the caller arrived with.
 */
export function splitTenantBase(pathname: string): {
  tenantId: string | null;
  base: string;
  appPath: string;
} {
  const segs = pathname.split('/'); // ['', 'tenant', '<uuid>', ...]
  const head = segs[1];
  const candidate = segs[2];
  if (
    candidate &&
    TENANT_ID_SEGMENT.test(candidate) &&
    (head === TENANT_ROUTE_SEGMENT || head === tenancyRuntime().prefix)
  ) {
    const rest = segs.slice(3).join('/');
    return { tenantId: candidate, base: `/${head}/${candidate}`, appPath: rest ? `/${rest}` : '/' };
  }
  return { tenantId: null, base: '', appPath: pathname || '/' };
}

/**
 * The exact JS emitted into the document by <TenancyScript/>.
 * `mode` is a closed enum and `prefix` is sanitized to [A-Za-z0-9_-], so
 * neither can contain a quote, a backslash or the string "</script".
 */
export function tenancyBootScript(): string {
  const { mode, prefix } = tenancyRuntime();
  return `window.__TENANCY__={mode:"${mode}",prefix:"${prefix}"};`;
}
