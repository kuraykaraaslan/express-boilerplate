/**
 * Which host is the ROOT tenant's own surface (the platform's), as ONE rule for the edge proxy (`proxy/tenancy.ts`, which routes a
 * request's host) and the server (`auth/server/auth.tenant-switch.ts`, which decides whether entering a tenant needs a hop to another
 * host). Before this file the two disagreed on a wildcard that carries a port (`localhost:3000`, every development machine): the
 * proxy compared the port-less request host with `system.localhost:3000` and never matched, so the tenant picker's handoff landed on
 * "Page not found" (docs/audits/2026-10-27-scene-bindings.md, E2E-1.1). Pure and import-free: the proxy runs on the edge runtime.
 */

/** `host:port` → `host`, lower-cased and trimmed; an IPv6 literal keeps its brackets (`[::1]:3000` → `[::1]`). */
export function hostWithoutPort(host: string): string {
  const h = host.trim().toLowerCase();
  const m = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/.exec(h);
  return m ? m[1] : h;
}

/** Two hosts are the same host when they differ by the port alone (a cookie is host-only and knows no port). */
export function sameHost(a: string, b: string): boolean {
  const x = hostWithoutPort(a);
  return x !== '' && x === hostWithoutPort(b);
}

export interface RootSurfaceEnv {
  /** The platform's wildcard domain (`TENANT_WILDCARD_DOMAIN`, or its `NEXT_PUBLIC_` twin), with or without a port; none: no platform subdomains. */
  wildcard?: string | null;
  /** The root tenant's reserved subdomain (`TENANT_DEFAULT_SUBDOMAIN`, default `system`). */
  rootSubdomain?: string | null;
  /** `NODE_ENV === 'production'`. */
  production: boolean;
  /** `ALLOW_LOCALHOST_ROOT=true`: a local production smoke run keeps `localhost` as the root surface (risk register common.22). */
  allowLocalhostRoot?: boolean;
}

/**
 * `localhost` / `127.0.0.1` (any port) is the root tenant's surface on a development machine. In production it is not (anyone reaching
 * the origin directly would pick the platform tenant with one header), unless the deployment opts in with `ALLOW_LOCALHOST_ROOT=true`.
 */
export function isLocalhostHost(host: string, env: Pick<RootSurfaceEnv, 'production' | 'allowLocalhostRoot'>): boolean {
  const h = hostWithoutPort(host);
  const local = h === 'localhost' || h === '127.0.0.1';
  if (local && env.production && !env.allowLocalhostRoot) return false;
  return local;
}

/**
 * The root tenant is served on localhost (development), on the bare apex of the wildcard and on `<root subdomain>.<apex>`. Ports are
 * ignored on both sides: a wildcard of `localhost:3000` makes `system.localhost` (what a browser sends after the port is cut) the root
 * surface, as `system.localhost:3000` is.
 */
export function isRootSurfaceHost(host: string, env: RootSurfaceEnv): boolean {
  if (isLocalhostHost(host, env)) return true;
  const apex = env.wildcard ? hostWithoutPort(env.wildcard) : '';
  if (!apex) return false;
  const h = hostWithoutPort(host);
  const root = (env.rootSubdomain || 'system').trim().toLowerCase();
  return h === apex || h === `${root}.${apex}`;
}

/**
 * Set by the proxy (phase 56, D345) on a request for a host under one of the platform's managed base domains that names no organization
 * (a typo, a tenant that left): the root 404 page reads it and says so, with the host. Stripped from every inbound request first, so a
 * client never sets it; its only effect is the wording of a 404.
 */
export const UNKNOWN_HOST_HEADER = 'x-nb-unknown-host';

/** The internal path the proxy rewrites such a request to: no route serves it, so Next answers with the root 404 page and a 404 status. */
export const UNKNOWN_HOST_PATH = '/__nb/no-organization';
