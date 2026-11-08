import { env } from '@kuraykaraaslan-labs/env';
import { ext, tenantCtx } from './extensions/ext';
import { commonTenantOriginLoaders } from './generated/extensions/common.tenant_origin';
import { platformTenantUrl, tenantPath } from './tenant-path';

/**
 * Absolute URLs for links that LEAVE the app: mails, push payloads, webhook bodies, anything the recipient opens in a
 * fresh browser with no current host to be relative to.
 *
 * `APPLICATION_HOST` is the *platform* host. In domain mode a clean path there resolves to the ROOT tenant, so the link
 * goes on the tenant's own origin when it has one that serves, and otherwise on the platform host in the explicit
 * `/tenant/{id}/…` form (`platformTenantUrl`), which proxy.ts serves on any host and which still lands on the right
 * tenant.
 *
 * The tenant's own origin comes from the `common:tenant_origin` point (pattern `first`): tenant_domain contributes the
 * tenant's live domain (its ACTIVE primary custom domain while the plan includes custom domains, otherwise its free
 * `<slug>.<wildcard>` subdomain). Common hosts the point so every module that mails a link can build it without
 * importing tenant_domain, which sits above most of them (tenant_domain requires tenant, which requires api_key;
 * docs/phases/37-extensions/10, 2026-10-17 second pass). The gate is `platform` (it was `behaviour` until the 2026-10-17
 * domains pass): every tenant keeps a free subdomain, which is the platform's routing of the tenant rather than a
 * feature it switches on, so the contribution answers for every tenant unless the platform banned or retired the
 * module or the build does not ship it. Taking a custom domain away (a plan that no longer includes it) is
 * tenant_domain's decision, made per domain, and its answer then is the free subdomain.
 *
 * NOT for machine-to-machine URLs registered with a third party (SAML EntityID/ACS, OAuth redirect_uri, national-id
 * ACS base). Those are stable identifiers the customer pasted into their IdP; rebasing them onto a domain that can
 * later change breaks the integration. They stay on APPLICATION_HOST deliberately.
 */

/** Extension point id, declared in common/module.json `extensionPoints`. */
export const TENANT_ORIGIN_POINT = 'common:tenant_origin';

/** What a `common:tenant_origin` contribution default-exports. */
export interface TenantOriginSource {
  /**
   * The tenant's own origin (`https://acme.example.com`, no trailing slash), or null when it has none a link should
   * point at: path mode, or no live domain at all (no wildcard domain configured and no ACTIVE custom domain).
   */
  origin(tenantId: string): Promise<string | null> | string | null;
}

/** The platform host links fall back to. */
export function platformHost(): string {
  return env.APPLICATION_HOST ?? 'http://localhost:3000';
}

/**
 * The tenant's own origin, or null. Best-effort: a contributor that throws or times out is skipped by the runtime,
 * and a failure to resolve the contributors at all is a null too, because a link must never be the reason a
 * notification is not sent.
 */
export async function tenantOrigin(tenantId: string): Promise<string | null> {
  try {
    const hit = await ext.first<TenantOriginSource, string>(
      TENANT_ORIGIN_POINT, tenantCtx(tenantId), commonTenantOriginLoaders,
      (source) => source.origin(tenantId),
      { validate: (value) => typeof value === 'string' && /^https?:\/\/[^/\s]+$/.test(value) },
    );
    return hit?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Absolute URL for `appPath` (tenant-relative, e.g. `/admin/api-keys/{id}`) pointing at `tenantId`.
 *
 *   the tenant has an origin that serves → https://acme.example.com/admin/api-keys/x
 *   otherwise                            → {APP_HOST}/tenant/{id}/admin/api-keys/x
 *                                          (path mode: {APP_HOST}/t/{id}/…)
 */
export async function absoluteTenantUrl(tenantId: string, appPath: string): Promise<string> {
  const origin = await tenantOrigin(tenantId);
  if (origin) return `${origin}${tenantPath(tenantId, appPath)}`;
  return platformTenantUrl(platformHost(), tenantId, appPath);
}
