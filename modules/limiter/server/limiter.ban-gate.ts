/**
 * The ban gate (docs/phases/55-ai-firewall 00 §0.2, P-2): an address that is banned (the strike store's automatic bans, an
 * administrator's manual ones, the firewall's) or inside the platform-global blocklist is refused on EVERY request of a lane that
 * takes part in IP bans, early in the proxy (proxy/ip-ban.ts): pages, tenant APIs and the sign-in endpoints alike. Before this the
 * ban held only inside the `auth` limiter scope, so a banned address still read every other API and page.
 *
 * Lanes (38 L-4, FWA-6): human controls never apply to machine and device lanes. A request the proxy classifies as an API key, a fleet
 * agent, a device credential, the cron secret or a provider callback is not refused by address; those actors are acted on per
 * credential, node or endpoint. Because a lane at the proxy is a claim nobody has verified yet (`resolveLane` reads headers), the
 * exemption is narrow (`laneExemptFromIpBan`): never a strict (unclassifiable) lane, never a request that also carries a session cookie
 * (a person's browser, whatever header rides along), and for the credential lanes only an API path that verifies that credential
 * (`claimedLaneOn`: an API key never on `/api/auth` or `/api/public`, a fleet envelope only on the agent paths).
 * The cron secret is checked at the proxy and provider callbacks are matched by path, so those two are exempt on their own paths.
 *
 * Cost on the hot path: the client address's ban key is read once (GET `ip-ban:<bucket>`) and the answer kept in process for
 * `BAN_GATE_CACHE_MS`; the CIDR bans and the rebuild marker come from one HGETALL of `ip-bans:state` per process and period; the
 * global blocklist is the setting cache (limiter.global-blocklist.ts). So a ban or a lift reaches every gate within `BAN_GATE_CACHE_MS`
 * (the module instance that wrote it at once, `forgetCachedBans`; the proxy and the route handlers may be separate bundles, so the
 * proxy's copy may be one of the others). Every Redis read is bounded (`BAN_GATE_REDIS_TIMEOUT_MS`) and fails OPEN: a Redis outage
 * must not turn the gate into an outage (FWA-7); the auth limiter behind it fails closed on its own.
 *
 * After a Redis flush the marker is gone: the gate starts the rebuild from the database (limiter.ip-ban-store.ts), at most once per
 * `BAN_GATE_REBUILD_RETRY_MS` per process (the store also holds a Redis lock), and keeps answering meanwhile.
 *
 * No env, logger or database import: the proxy loads this file on every request path, and the proxy tests mock only redis.
 */
import redis from '@kuraykaraaslan-labs/redis';
import { DEFAULT_TRUSTED_PROXY_HOPS, clientIpFromForwardedFor } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.forwarded';
import { ipInSubnet, normalizeIp } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.ip';
import {
  claimedLaneOn, hasSessionCookieOf, laneRelativePath, resolveLane, type LaneRequest, type LaneResult,
} from '@kuraykaraaslan-labs/common/server/lane';
import { BAN_STATE_CIDR_PREFIX, BAN_STATE_HYDRATED_FIELD, BAN_STATE_KEY, banKey } from './limiter.ban-keys';
import { rateLimitBucketOf } from './limiter.ip-bucket';
import { banKindOf } from './limiter.ban-target';
import { withinRedisBound } from './limiter.redis-bound';
import { isGloballyBlocked } from './limiter.global-blocklist';
import { banHoldsEverywhere } from './limiter.ban-scope';

/** How long one answer about an address (banned until …, or not banned) and the CIDR snapshot are kept in process, ms. */
export const BAN_GATE_CACHE_MS = 5_000;
/** The most addresses kept; the oldest answer is dropped first. */
export const BAN_GATE_CACHE_MAX = 10_000;
/** The bound of one gate read: the proxy must not wait for a Redis that does not answer (limiter.03's bound is for the limiter). */
export const BAN_GATE_REDIS_TIMEOUT_MS = 250;
/** The shortest interval between two rebuild attempts of one process after a flush, ms. */
export const BAN_GATE_REBUILD_RETRY_MS = 30_000;

export type BanVerdict =
  | { blocked: false }
  | { blocked: true; reason: 'banned'; retryAfter: number }
  | { blocked: true; reason: 'blocklisted' };

const PASS: BanVerdict = { blocked: false };
const API_PATH = /^\/api(?:\/|$)/;

const addresses = new Map<string, { until: number; expires: number }>();
let state: { expires: number; cidrs: Array<{ target: string; until: number }> } | null = null;
let refreshing: Promise<void> | null = null;
let rebuilding: Promise<void> | null = null;
let lastRebuildAt = Number.NEGATIVE_INFINITY;

/** Drops what this process remembers (a ban or lift written here, tests): one address's answer, or everything. */
export function forgetCachedBans(target?: string): void {
  if (target && banKindOf(target) === 'address') addresses.delete(target);
  else addresses.clear();
  state = null;
}

/** Tests: everything back to a fresh process, the rebuild throttle included. */
export function resetBanGate(): void {
  addresses.clear();
  state = null;
  refreshing = null;
  rebuilding = null;
  lastRebuildAt = Number.NEGATIVE_INFINITY;
}

/** Tests: the rebuild a gate read started, if one is running. */
export function pendingBanRebuild(): Promise<void> | null {
  return rebuilding;
}

/**
 * Whether a request of this lane is exempt from address bans at the proxy (L-4), see the file comment. `relativePath` is the
 * tenant-relative path (`laneRelativePath`); `hasSessionCookie` whether it carries `accessToken` or `refreshToken`. Pure.
 */
export function laneExemptFromIpBan(lane: LaneResult, relativePath: string, hasSessionCookie: boolean): boolean {
  if (lane.policy.banParticipation === true || lane.strict || hasSessionCookie) return false;
  if (lane.lane === 'internal-cron' || lane.lane === 'provider-webhook') return true;
  // A credential lane holds only where its credential is verified (`claimedLaneOn`): an API key outside the sign-in / public
  // surfaces, a fleet envelope on the agent paths. A forged header on a password reset is the public lane, and banned.
  return API_PATH.test(relativePath) && claimedLaneOn(lane.lane, relativePath) === lane.lane;
}

/** The client address as the limiter reads it (X-Forwarded-For through `TRUSTED_PROXY_HOPS`), or null without one. */
function clientAddress(headers: LaneRequest['headers']): string | null {
  const configured = process.env.TRUSTED_PROXY_HOPS?.trim();
  const raw = configured ? Number(configured) : Number.NaN;
  const hops = Number.isInteger(raw) && raw >= 0 && raw <= 10 ? raw : DEFAULT_TRUSTED_PROXY_HOPS;
  const ip = clientIpFromForwardedFor(headers.get('x-forwarded-for'), hops);
  return ip && ip !== 'unknown' ? normalizeIp(ip) : null;
}

function remember(bucket: string, until: number): void {
  if (addresses.size >= BAN_GATE_CACHE_MAX && !addresses.has(bucket)) {
    const oldest = addresses.keys().next().value;
    if (oldest !== undefined) addresses.delete(oldest);
  }
  addresses.delete(bucket);
  addresses.set(bucket, { until, expires: performance.now() + BAN_GATE_CACHE_MS });
}

/** When the ban on this bucket ends (ms), 0 when there is none or Redis did not answer (fail open). */
async function bucketBanUntil(bucket: string): Promise<number> {
  const hit = addresses.get(bucket);
  if (hit && performance.now() < hit.expires) return hit.until;
  let until = 0;
  try {
    const raw = await withinRedisBound(redis.get(banKey(bucket)), BAN_GATE_REDIS_TIMEOUT_MS);
    if (raw) {
      const ban = JSON.parse(raw) as { until?: unknown; offense?: unknown; manual?: unknown; source?: unknown; scope?: unknown } | null;
      const value = Number(ban?.until);
      // D55-3: a ban that holds only on the sign-in endpoints is the limiter's (auth scope), not the gate's.
      const everywhere = !!ban && banHoldsEverywhere({
        offense: Number(ban.offense), manual: ban.manual === true,
        source: typeof ban.source === 'string' ? ban.source : undefined, scope: typeof ban.scope === 'string' ? ban.scope : undefined,
      });
      until = everywhere && Number.isFinite(value) ? value : 0;
    }
  } catch {
    until = 0;
  }
  remember(bucket, until);
  return until;
}

function startRebuild(): void {
  const now = performance.now();
  if (rebuilding || now - lastRebuildAt < BAN_GATE_REBUILD_RETRY_MS) return;
  lastRebuildAt = now;
  rebuilding = import('./limiter.ip-ban-store')
    .then((store) => store.rebuildIfFlushed())
    .then(() => { addresses.clear(); state = null; })
    .catch(() => undefined)
    .finally(() => { rebuilding = null; });
}

async function refreshState(): Promise<void> {
  try {
    const hash = ((await withinRedisBound(redis.hgetall(BAN_STATE_KEY), BAN_GATE_REDIS_TIMEOUT_MS)) ?? {}) as Record<string, string>;
    const now = Date.now();
    const cidrs: Array<{ target: string; until: number }> = [];
    for (const [field, value] of Object.entries(hash)) {
      if (!field.startsWith(BAN_STATE_CIDR_PREFIX)) continue;
      const until = Number(value);
      if (Number.isFinite(until) && until > now) cidrs.push({ target: field.slice(BAN_STATE_CIDR_PREFIX.length), until });
    }
    state = { expires: performance.now() + BAN_GATE_CACHE_MS, cidrs };
    if (!hash[BAN_STATE_HYDRATED_FIELD]) startRebuild();
  } catch {
    // Fail open, and do not ask again on every request while Redis is away: keep the last snapshot for one period.
    state = { expires: performance.now() + BAN_GATE_CACHE_MS, cidrs: state?.cidrs ?? [] };
  }
}

async function cidrBans(): Promise<Array<{ target: string; until: number }>> {
  if (!state || performance.now() >= state.expires) {
    refreshing ??= refreshState().finally(() => { refreshing = null; });
    await refreshing;
  }
  return state?.cidrs ?? [];
}

/**
 * The gate's answer for one request: refused (a ban, with the seconds until it ends; or the global blocklist) or passed. Passed
 * without a client address, on an exempt lane (`laneExemptFromIpBan`), and whenever a store cannot be read. The lane is classified
 * here from the request itself (`resolveLane`), never from an inbound `x-nb-lane`, which at the proxy is a client's claim.
 */
export async function ipBanVerdict(
  request: LaneRequest & { nextUrl: { pathname: string } },
  tenantPathPrefix = 't',
): Promise<BanVerdict> {
  const ip = clientAddress(request.headers);
  if (!ip) return PASS;
  const path = laneRelativePath(request.nextUrl.pathname, tenantPathPrefix);
  const hasSessionCookie = hasSessionCookieOf(request);
  const lane = resolveLane({ path, headers: request.headers, hasSessionCookie, cronSecret: process.env.CRON_SECRET });
  if (laneExemptFromIpBan(lane, path, hasSessionCookie)) return PASS;

  if (await isGloballyBlocked(ip)) return { blocked: true, reason: 'blocklisted' };

  const [bucketUntil, cidrs] = await Promise.all([bucketBanUntil(rateLimitBucketOf(ip)), cidrBans()]);
  const now = Date.now();
  let until = bucketUntil > now ? bucketUntil : 0;
  for (const c of cidrs) if (c.until > now && c.until > until && ipInSubnet(ip, c.target)) until = c.until;
  return until > now ? { blocked: true, reason: 'banned', retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) } : PASS;
}
