import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import redis from '@kuraykaraaslan-labs/redis';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Tenant as TenantEntity } from './entities/tenant.entity';

/**
 * Region-aware routing on a fleet node (docs/phases/02-fleet/05 section 5.1): after the proxy derived the tenant id and before any page or API
 * gate, the node checks that the tenant actually lives HERE.
 *
 *  - home is this node (or the tenant was never assigned by a directory) -> served as before;
 *  - RELOCATED (the tombstone a migration's cutover leaves on the source) -> 307 to `relocatedToBaseUrl` + the same path, once: the answer
 *    carries `X-Fleet-Hop: 1` and a request that already carries it gets 503, so two misconfigured nodes cannot bounce a client forever. The
 *    target must be https and its host must end in one of this node's `FLEET_ALLOWED_REDIRECT_SUFFIXES` (bootstrap-local, 02 section 3.5), or the
 *    node answers 503 instead of sending users to an address a tampered row chose. After `tombstoneUntil` the tombstone answers 404;
 *  - IMPORTING (the target half of a migration, not verified yet) -> 503, nothing is served before the import is verified;
 *  - FENCED (`fencedAt` set: this node is an old home the directory's `tenantStatusDelta` fenced after a failover it missed, `fenceAfterDirectoryMove`,
 *    decision F1) -> 409 FENCED, logged at debug level only: it is the expected answer to clients that still reach the old home, and every one of
 *    them retries. The tenant's reads are the new home's to serve (this node's copy is stale); its writes are refused below HTTP by the write fence;
 *  - homed on ANOTHER node, not relocated and not fenced -> 409 "misplaced", logged as an error: it must never happen (the compliance check looks for it).
 *
 * There is no lookup table and no public lookup: a node only ever redirects to the address of a contract it verified. Unknown tenants keep the
 * existing behaviour (the caller answers them). Fail-open on a lookup failure: routing is not an authorization step, and a node whose database is
 * down cannot serve the request anyway.
 */
export const FLEET_HOP_HEADER = 'x-fleet-hop';

/** The columns of the tenant row routing reads, as cached (dates as ISO strings). */
export interface FleetRouteRow {
  tenantStatus: string;
  homeNodeId: string | null;
  relocatedToBaseUrl: string | null;
  tombstoneUntil: string | null;
  /** `fencedAt` is set (decision F1). Optional: a row cached before the column existed reads as not fenced until the cache entry expires. */
  fenced?: boolean;
}

export type FleetRouteDecision =
  | { kind: 'SERVE' }
  | { kind: 'REDIRECT'; location: string }
  | { kind: 'REFUSE'; status: 404 | 409 | 503; code: 'NOT_HERE' | 'MISPLACED' | 'FENCED' | 'REGION_UNAVAILABLE' | 'NOT_YET_AVAILABLE' };

export interface FleetRouteContext {
  selfNodeId: string;
  /** Host suffixes a tombstone may redirect to (lower case, no leading dot). Empty = no redirect is allowed. */
  allowedSuffixes: readonly string[];
  /** The request already carries the hop header. */
  hop: boolean;
  now: Date;
  /** Path and query of the request, appended to the redirect target unchanged. */
  pathAndQuery: string;
}

/** Parse `FLEET_ALLOWED_REDIRECT_SUFFIXES` (comma separated): trimmed, lower case, leading dots dropped, empties ignored. */
export function parseRedirectSuffixes(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/^\.+/, '')).filter((s) => s.length > 0);
}

/** The redirect base of a tombstone (origin + optional path, no trailing slash) when it is https, carries no credentials and its host is allowed; else null. */
export function allowedRedirectBase(baseUrl: string | null, allowedSuffixes: readonly string[]): string | null {
  if (!baseUrl) return null;
  let u: URL;
  try { u = new URL(baseUrl); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (!allowedSuffixes.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** The routing decision for one request (pure). */
export function decideFleetRoute(tenantId: string, row: FleetRouteRow | null, ctx: FleetRouteContext): FleetRouteDecision {
  if (!row || isReservedTenant(tenantId)) return { kind: 'SERVE' };
  if (row.tenantStatus === 'RELOCATED') {
    if (ctx.hop) return { kind: 'REFUSE', status: 503, code: 'REGION_UNAVAILABLE' };
    const until = row.tombstoneUntil ? Date.parse(row.tombstoneUntil) : NaN;
    if (!(until > ctx.now.getTime())) return { kind: 'REFUSE', status: 404, code: 'NOT_HERE' };
    const base = allowedRedirectBase(row.relocatedToBaseUrl, ctx.allowedSuffixes);
    if (!base) return { kind: 'REFUSE', status: 503, code: 'REGION_UNAVAILABLE' };
    return { kind: 'REDIRECT', location: `${base}${ctx.pathAndQuery}` };
  }
  if (row.tenantStatus === 'IMPORTING') return { kind: 'REFUSE', status: 503, code: 'NOT_YET_AVAILABLE' };
  // a fence only ever restricts: refused whatever the home says
  if (row.fenced) return { kind: 'REFUSE', status: 409, code: 'FENCED' };
  if (!row.homeNodeId || row.homeNodeId === ctx.selfNodeId) return { kind: 'SERVE' };
  return { kind: 'REFUSE', status: 409, code: 'MISPLACED' };
}

/** Cache key of the routing row; `clearCache` in tenant.helpers drops it together with the profile. */
export const routeCacheKey = (tenantId: string) => `tenant:route:${tenantId}`;
const ROUTE_CACHE_TTL_SECONDS = 60;
/** A cached "no such tenant", so a stream of unknown ids does not reach the database every time. */
const MISSING = 'none';

/** The routing row of a live tenant (cached briefly), null when there is none. Throws when neither the cache nor the database answers. */
export async function readFleetRouteRow(tenantId: string): Promise<FleetRouteRow | null> {
  const key = routeCacheKey(tenantId);
  const cached = await redis.get(key).catch(() => null);
  if (cached === MISSING) return null;
  if (cached) {
    try { return JSON.parse(cached) as FleetRouteRow; } catch { await redis.del(key).catch(() => {}); }
  }
  const t = await withSystemRLS((qr) => qr.manager.getRepository(TenantEntity).findOne({
    where: { tenantId },
    select: { tenantId: true, tenantStatus: true, homeNodeId: true, relocatedToBaseUrl: true, tombstoneUntil: true, fencedAt: true },
  }));
  const row: FleetRouteRow | null = t
    ? { tenantStatus: t.tenantStatus, homeNodeId: t.homeNodeId ?? null, relocatedToBaseUrl: t.relocatedToBaseUrl ?? null, tombstoneUntil: t.tombstoneUntil ? t.tombstoneUntil.toISOString() : null, fenced: !!t.fencedAt }
    : null;
  await redis.setex(key, ROUTE_CACHE_TTL_SECONDS, row ? JSON.stringify(row) : MISSING).catch(() => {});
  return row;
}

const MESSAGES: Record<Extract<FleetRouteDecision, { kind: 'REFUSE' }>['code'], string> = {
  NOT_HERE: 'This address is not configured in this region.',
  MISPLACED: 'This workspace is not served by this region.',
  FENCED: 'This workspace is now served by another region.',
  REGION_UNAVAILABLE: 'This workspace has moved and its new region cannot be reached from here right now.',
  NOT_YET_AVAILABLE: 'This workspace is being moved to this region and is not available yet.',
};

function refusal(pathname: string, status: number, code: keyof typeof MESSAGES): NextResponse {
  const headers = { 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '300' } : {}) };
  // The API shapes (`/api/...`, `/tenant/{id}/api/...`) answer JSON, pages a minimal document; neither names the tenant or another node.
  if (/^\/api\/|^\/tenant\/[^/]+\/api(?:\/|$)/.test(pathname)) return NextResponse.json({ error: code, message: MESSAGES[code] }, { status, headers });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${status}</title></head>`
    + `<body><main><p>${MESSAGES[code]}</p></main></body></html>`;
  return new NextResponse(html, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

/**
 * The proxy's fleet routing gate: null = carry on, otherwise the answer. Only a node with an id routes (`FLEET_ROLE=node`, `FLEET_NODE_ID`); the
 * proxy calls it only there, and this check keeps any other caller harmless.
 */
export async function gateFleetRoute(req: NextRequest, tenantId: string): Promise<NextResponse | null> {
  // The platform tenants live on every node: no lookup on their (most frequent) requests.
  if (env.FLEET_ROLE !== 'node' || !env.FLEET_NODE_ID || isReservedTenant(tenantId)) return null;
  let row: FleetRouteRow | null;
  try {
    row = await readFleetRouteRow(tenantId);
  } catch (err) {
    Logger.warn(`[fleet.route] routing row of tenant ${tenantId} unavailable, serving locally: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const decision = decideFleetRoute(tenantId, row, {
    selfNodeId: env.FLEET_NODE_ID,
    allowedSuffixes: parseRedirectSuffixes(env.FLEET_ALLOWED_REDIRECT_SUFFIXES),
    hop: req.headers.has(FLEET_HOP_HEADER),
    now: new Date(),
    pathAndQuery: `${req.nextUrl.pathname}${req.nextUrl.search}`,
  });
  if (decision.kind === 'SERVE') return null;
  if (decision.kind === 'REDIRECT') {
    const res = NextResponse.redirect(decision.location, 307);
    res.headers.set('X-Fleet-Hop', '1');
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }
  if (decision.code === 'FENCED') Logger.debug(`[fleet.route] tenant ${tenantId} is fenced on this node (old home, decision F1): refused`);
  if (decision.code === 'MISPLACED') Logger.error(`[fleet.route] tenant ${tenantId} is homed on node ${row?.homeNodeId} but was asked for on this node (misplaced)`);
  if (decision.code === 'REGION_UNAVAILABLE') Logger.warn(`[fleet.route] tenant ${tenantId} is relocated but its redirect was refused (hop or target not allowed)`);
  return refusal(req.nextUrl.pathname, decision.status, decision.code);
}
