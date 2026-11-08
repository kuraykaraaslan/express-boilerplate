// What the request proxy (proxy.ts, the system front controller) and the CMS (`dynamic_page`) agree on, as plain values: the names of
// two Redis flags, the marker that says they were built, and one request header. The proxy must not import `dynamic_page` (a Pro module), and the module must not learn how the proxy
// reads them, so the agreement is here. Pure: no imports, so the proxy and the server components share one definition without either
// importing the other's code. `dynamic_page` re-exports these from its old files.

/**
 * The site part of a page flag (D276, multi-site): the site id the proxy put in `SITE_HEADER` for the request's domain, or this token when there
 * is none (path mode, a domain bound to no site): the tenant's DEFAULT site. A default-site page is flagged under both this token and the default
 * site's own id (a domain may be bound to the default site by id); a page of another site under that site's id.
 */
export const DEFAULT_SITE_FLAG_TOKEN = '_'

/**
 * Middleware flag (D276): `EXISTS dp:site:exp:{tenantId}:{site}:{slug}` tells the proxy, without a database round trip, that a page of that site
 * has a RUNNING A/B experiment and must therefore not be served with a shared-cache header (a CDN would cache one visitor's variant and hand it to
 * everyone). Written when an experiment is bound, unbound, renamed or deleted, and RE-ASSERTED on every experimented render so a lost key
 * self-heals. Per SITE: two sites of a tenant may each have an `/about`, and saving one must never clear the other's flag.
 */
export const siteExperimentFlagKey = (tenantId: string, site: string, slug: string): string => `dp:site:exp:${tenantId}:${site}:${slug}`

/**
 * Middleware flag (D276): `EXISTS dp:site:vis:{tenantId}:{site}:{slug}` says a page of that site is personalised (block visibility rules, page
 * audience targeting, rules in its chrome or symbols) and must not carry the public `s-maxage` header, for the same reason as the experiment
 * flag: caching one visitor's personalised page turns a targeting rule into a data leak.
 */
export const siteVisibilityFlagKey = (tenantId: string, site: string, slug: string): string => `dp:site:vis:${tenantId}:${site}:${slug}`

/**
 * Middleware flag (D276): `EXISTS dp:site:visp:{tenantId}:{site}:{prefix}` says every path BELOW `prefix` is personalised: the route prefix of a
 * collection binding whose template page varies by visitor. It covers every item of the binding, also the items of an external source (a live
 * catalog whose items appear without any CMS save) and items beyond any listing bound, which per-item flags could not. The proxy probes the
 * proper ancestors of the request path (at most `PREFIX_FLAG_DEPTH`).
 */
export const sitePrefixFlagKey = (tenantId: string, site: string, prefix: string): string => `dp:site:visp:${tenantId}:${site}:${prefix}`
/** How many ancestor segments of a request path the proxy probes for a prefix flag (`de/shop/products/x` → `de`, `de/shop`, `de/shop/products`). */
export const PREFIX_FLAG_DEPTH = 3

/**
 * The site tokens whose flags the CMS keeps for a tenant (D276): `DEFAULT_SITE_FLAG_TOKEN` and the id of every site. A request whose site token is
 * not a member (a domain still bound to a deleted site, a site created while Redis was away) proves nothing and is served `private, no-store`.
 */
export const pageFlagSitesKey = (tenantId: string): string => `dp:flags:sites:${tenantId}`

/**
 * LEGACY (before D276): the per-tenant-and-slug flags `dp:exp:{tenantId}:{slug}` / `dp:vis:{tenantId}:{slug}`. Nothing writes them any more; a
 * proxy that finds one serves the path `private, no-store` (a process of the previous release may still be running during a deploy and write
 * them), the rebuild deletes them once (`dp:flags:legacy-cleared`), and a save deletes its slug's.
 */
export const experimentFlagKey = (tenantId: string, slug: string): string => `dp:exp:${tenantId}:${slug}`
export const visibilityFlagKey = (tenantId: string, slug: string): string => `dp:vis:${tenantId}:${slug}`

/**
 * The "flags built" marker (docs/audits/2026-11-03-redis-outage.md §6.8, D251). The two flags above live in Redis only, and a missing flag reads
 * as "not personalised": after Redis loses its data, the first visitor of a personalised page would get the public `s-maxage` header and the CDN
 * could hand that render to everyone for an hour. So a missing flag counts only while this marker is there: it is set by the CMS after it has
 * written every flag back from the database (`dynamic_page.flags.rebuild.ts`), and a Redis that lost its data lost the marker with the flags.
 * Without it the proxy serves every CMS page `private, no-store`.
 */
// D276: a new name for the per-site flags, so a marker of the per-slug release proves nothing: until the first per-site pass every CMS page is
// served `private, no-store`.
export const PAGE_FLAGS_BUILT_KEY = 'dp:flags:built:site'

/**
 * The module that keeps the flags and sets the marker. A build without it has no CMS page to personalise (its catch-all is app_shell's
 * sign-in stand-in), so the proxy does not wait there for a marker nobody would set. A module id, not an import: the proxy reads it from
 * the build's module registry.
 */
export const PAGE_FLAGS_OWNER_MODULE = 'dynamic_page'

/**
 * Set for one tenant whose flags the last rebuild could not read (its database did not answer): that tenant's pages stay `private, no-store`
 * while every other tenant's are cacheable again. Removed when a later pass rebuilds the tenant.
 */
export const pageFlagsUnbuiltKey = (tenantId: string): string => `dp:flags:unbuilt:${tenantId}`

/**
 * The request header the proxy sets to say WHICH site of the tenant a public request is for. Set only for a request on a domain assigned to a
 * site; the proxy strips any value a client sends, so the header is trustworthy exactly when it is present.
 */
export const SITE_HEADER = 'x-dp-site-id'
