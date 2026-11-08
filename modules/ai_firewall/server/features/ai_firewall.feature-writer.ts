import { createHash } from 'node:crypto';
import {
  DISTINCT_DIMS, FEATURE_WINDOWS, KNOWN_ENDPOINTS_TTL_ADDRESS_SECONDS, KNOWN_ENDPOINTS_TTL_SECONDS, PROFILE_DIMS, PROFILE_FIELDS_MAX,
  activeActorsKey, activeMember, actorPart, bucketExpireAt, bucketIsLive, bucketOf, counterKey, dayOf, distinctKey, isPlatformActorKind,
  knownEndpointsKey, profileDistinctKey, profileExpireAt, profileKey, type DistinctDim, type ProfileDim,
} from './ai_firewall.feature-windows';

/**
 * Writes the feature store's updates to Redis (docs/phases/55-ai-firewall/02 §2.1): ONE bounded pipeline per call, off every request
 * path (the request fold's timer and the signal consumer call it). Nothing here is awaited by a request, a sign-in or an audit write.
 *
 * Per actor update, at most:
 *   - one EVALSHA of FOLD_SCRIPT: adds the touched endpoints to the actor's known set and, in each live window bucket, every counter
 *     plus `nep` (endpoints added for the first time), and sets each bucket's expiry: one round of work, atomic per actor;
 *   - per distinct dimension with members, a PFADD and an EXPIREAT per live window;
 *   - for a baseline actor (a person or a key) one EVALSHA of PROFILE_SCRIPT on its day profile (capped field count, expiry, role), the
 *     day's distinct PFADDs, and an SADD of the day's work list.
 * The two scripts are loaded at the head of each pipeline (SCRIPT LOAD is idempotent and a few hundred bytes), so a Redis that restarted
 * or failed over never answers NOSCRIPT. A command whose reply is an error is counted; the rest of the pipeline still applies.
 * An update beyond `maxCommands` is dropped and counted (`command_cap`): a flood can never make one flush unbounded. A script call
 * counts as one command per SCRIPT_ARGS_PER_COMMAND arguments (D55-49: its work in Redis grows with its arguments), and a day profile
 * sends at most PROFILE_FIELDS_MAX fields (the script would leave the rest out anyway).
 *
 * Addresses churn (D55-48): at most ADDRESS_ENDPOINT_SETS_MAX address (or anonymous) updates of one flush touch their known-endpoint
 * set; beyond, the update still counts its windows but sends no endpoints (no `nep` for it this flush) and is counted
 * (`endpointsCapped`). With the address set's 24 h expiry and IPv6 keyed by its /64 (feature-id), an address flood cannot fill the
 * shared Redis with long-lived sets.
 */
export interface FeatureUpdate {
  scope: string;
  kind: string;
  hash: string;
  /** When it happened, ms: chooses the buckets (a late signal goes to its own bucket, or nowhere when that one expired). */
  atMs: number;
  counters: Readonly<Record<string, number>>;
  distinct?: Partial<Record<DistinctDim, readonly string[]>>;
  /** Route template tags touched (the known-endpoint set and `nep`). */
  endpoints?: readonly string[];
  /** The actor's day profile (persons and keys only). */
  profile?: { counters: Readonly<Record<string, number>>; role?: string | null; distinct?: Partial<Record<ProfileDim, readonly string[]>> };
}

export interface FeaturePipeline {
  script(subcommand: 'LOAD', script: string): unknown;
  evalsha(sha: string, numKeys: number, ...args: Array<string | number>): unknown;
  pfadd(key: string, ...members: string[]): unknown;
  sadd(key: string, ...members: string[]): unknown;
  expireat(key: string, unixSeconds: number): unknown;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}
export interface FeatureRedis {
  status?: string;
  pipeline(): FeaturePipeline;
}

/** KEYS[1] the known-endpoint set, KEYS[2..] the live counter buckets. ARGV: knownTtl, nEp, ep…, nF, field, n, …, expireAt per bucket. */
export const FOLD_SCRIPT = `local i = 1
local knownTtl = tonumber(ARGV[i]); i = i + 1
local nEp = tonumber(ARGV[i]); i = i + 1
local added = 0
for j = 1, nEp do
  added = added + redis.call('SADD', KEYS[1], ARGV[i]); i = i + 1
end
if nEp > 0 then redis.call('EXPIRE', KEYS[1], knownTtl) end
local nF = tonumber(ARGV[i]); i = i + 1
local f0 = i
i = i + 2 * nF
for k = 2, #KEYS do
  for j = 0, nF - 1 do
    redis.call('HINCRBY', KEYS[k], ARGV[f0 + 2 * j], ARGV[f0 + 2 * j + 1])
  end
  if added > 0 then redis.call('HINCRBY', KEYS[k], 'nep', added) end
  redis.call('EXPIREAT', KEYS[k], ARGV[i]); i = i + 1
end
return added`;

/** KEYS[1] the day profile. ARGV: fieldCap, expireAt, role ('' = none), nF, field, n, …. A new field beyond the cap is left out. */
export const PROFILE_SCRIPT = `local cap = tonumber(ARGV[1])
local n = tonumber(ARGV[4])
local len = redis.call('HLEN', KEYS[1])
for j = 0, n - 1 do
  local f = ARGV[5 + 2 * j]
  local exists = redis.call('HEXISTS', KEYS[1], f) == 1
  if exists or len < cap then
    redis.call('HINCRBY', KEYS[1], f, ARGV[6 + 2 * j])
    if not exists then len = len + 1 end
  end
end
if ARGV[3] ~= '' then redis.call('HSET', KEYS[1], 'r', ARGV[3]) end
redis.call('EXPIREAT', KEYS[1], ARGV[2])
return len`;

export const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');
export const FOLD_SHA = sha1(FOLD_SCRIPT);
export const PROFILE_SHA = sha1(PROFILE_SCRIPT);

export const FLUSH_MAX_COMMANDS = 40_000;
/** Arguments a script call may carry per command it counts as. */
export const SCRIPT_ARGS_PER_COMMAND = 64;
/** Address updates per flush that may add to their known-endpoint set. */
export const ADDRESS_ENDPOINT_SETS_MAX = 1_000;
const scriptCost = (args: number): number => 1 + Math.floor(args / SCRIPT_ARGS_PER_COMMAND);
/** Members one distinct dimension of one update sends (the rest are left out: the count is an estimate anyway). */
export const DISTINCT_MEMBERS_MAX = 64;

export interface WriteResult {
  /** Updates sent. */
  written: number;
  /** Updates left out: over the command bound. */
  capped: number;
  /** Commands whose reply was an error. */
  commandErrors: number;
  /** Address updates sent without their endpoints (ADDRESS_ENDPOINT_SETS_MAX); present only when some were. */
  endpointsCapped?: number;
}

const integer = (n: number): number => (Number.isFinite(n) ? Math.round(n) : 0);

/** The commands of one update, appended to `pipe`; answers how many it added (counted as the bound counts them). */
function appendUpdate(pipe: FeaturePipeline, u: FeatureUpdate, nowMs: number, capLeft: number, withEndpoints = true): number {
  const actor = actorPart(u.scope, u.kind, u.hash);
  const atSeconds = Math.floor(u.atMs / 1000);
  const nowSeconds = Math.floor(nowMs / 1000);
  const live = FEATURE_WINDOWS.map((w) => ({ id: w.id, seconds: w.seconds, bucket: bucketOf(atSeconds, w.seconds) }))
    .filter((w) => bucketIsLive(w.bucket, w.seconds, nowSeconds));
  const fields = Object.entries(u.counters).filter(([, n]) => integer(n) !== 0);
  const endpoints = withEndpoints ? (u.endpoints ?? []).slice(0, DISTINCT_MEMBERS_MAX) : [];
  const dims = DISTINCT_DIMS.map((dim) => [dim, (u.distinct?.[dim] ?? []).slice(0, DISTINCT_MEMBERS_MAX)] as const).filter(([, m]) => m.length > 0);
  const profile = u.profile;
  const profileFields = profile ? Object.entries(profile.counters).filter(([, n]) => integer(n) !== 0).slice(0, PROFILE_FIELDS_MAX) : [];
  const profileDims = profile ? PROFILE_DIMS.map((dim) => [dim, (profile.distinct?.[dim] ?? []).slice(0, DISTINCT_MEMBERS_MAX)] as const).filter(([, m]) => m.length > 0) : [];
  const profileLive = profile && dayOf(u.atMs) >= dayOf(nowMs - 86_400_000);

  const folds = live.length > 0 && (fields.length > 0 || endpoints.length > 0);
  const needed = (folds ? scriptCost(3 + endpoints.length + 2 * fields.length + live.length) : 0) + dims.length * live.length * 2
    + (profileLive ? scriptCost(4 + 2 * profileFields.length) + profileDims.length * 2 + 1 : 0);
  if (needed === 0) return 0;
  if (needed > capLeft) return -1;

  if (folds) {
    const ttl = isPlatformActorKind(u.kind) ? KNOWN_ENDPOINTS_TTL_ADDRESS_SECONDS : KNOWN_ENDPOINTS_TTL_SECONDS;
    const keys = [knownEndpointsKey(actor), ...live.map((w) => counterKey(w.id, w.bucket, actor))];
    const args: Array<string | number> = [ttl, endpoints.length, ...endpoints, fields.length];
    for (const [f, n] of fields) args.push(f, integer(n));
    for (const w of live) args.push(bucketExpireAt(w.bucket, w.seconds));
    pipe.evalsha(FOLD_SHA, keys.length, ...keys, ...args);
  }
  for (const [dim, members] of dims) {
    for (const w of live) {
      const key = distinctKey(w.id, w.bucket, actor, dim);
      pipe.pfadd(key, ...members);
      pipe.expireat(key, bucketExpireAt(w.bucket, w.seconds));
    }
  }
  if (profileLive && profile) {
    const day = dayOf(u.atMs);
    const expireAt = profileExpireAt(u.atMs);
    const args: Array<string | number> = [PROFILE_FIELDS_MAX, expireAt, profile.role ?? '', profileFields.length];
    for (const [f, n] of profileFields) args.push(f, integer(n));
    pipe.evalsha(PROFILE_SHA, 1, profileKey(day, actor), ...args);
    for (const [dim, members] of profileDims) {
      const key = profileDistinctKey(day, actor, dim);
      pipe.pfadd(key, ...members);
      pipe.expireat(key, expireAt);
    }
    pipe.sadd(activeActorsKey(day), activeMember(u.scope, u.kind, u.hash));
  }
  return needed;
}

/** Thrown when Redis is not connected: the caller drops the batch (counted), never queues it. */
export class FeatureRedisUnavailable extends Error {}

/**
 * One pipeline for `updates`. Rejects only when the pipeline itself fails (the caller drops the batch and counts it, never retries).
 */
export async function writeFeatureUpdates(
  redis: FeatureRedis, updates: readonly FeatureUpdate[], nowMs: number = Date.now(), maxCommands: number = FLUSH_MAX_COMMANDS,
  maxAddressEndpointSets: number = ADDRESS_ENDPOINT_SETS_MAX,
): Promise<WriteResult> {
  // ioredis queues commands while it reconnects; the store must not pile up behind that (FWA-7).
  if (redis.status && redis.status !== 'ready') throw new FeatureRedisUnavailable(`Redis is ${redis.status}`);
  const result: WriteResult = { written: 0, capped: 0, commandErrors: 0 };
  if (updates.length === 0) return result;
  const pipe = redis.pipeline();
  pipe.script('LOAD', FOLD_SCRIPT);
  pipe.script('LOAD', PROFILE_SCRIPT);
  let left = Math.max(0, maxCommands - 2);
  const days = new Map<string, number>();
  let addressSets = 0;
  let endpointsCapped = 0;
  for (const u of updates) {
    let withEndpoints = true;
    if (isPlatformActorKind(u.kind) && (u.endpoints?.length ?? 0) > 0) {
      if (addressSets >= maxAddressEndpointSets) { withEndpoints = false; endpointsCapped += 1; } else addressSets += 1;
    }
    const added = appendUpdate(pipe, u, nowMs, left, withEndpoints);
    if (added < 0) { result.capped += 1; continue; }
    if (added > 0) {
      result.written += 1;
      left -= added;
      if (u.profile) days.set(dayOf(u.atMs), profileExpireAt(u.atMs));
    }
  }
  for (const [day, expireAt] of days) pipe.expireat(activeActorsKey(day), expireAt);
  const replies = await pipe.exec();
  if (!replies) throw new Error('the feature pipeline was not executed');
  for (const [err] of replies) if (err) result.commandErrors += 1;
  if (endpointsCapped > 0) result.endpointsCapped = endpointsCapped;
  return result;
}
