/**
 * The limiter's token buckets (docs/phases/07-dashboard/40-data-traffic.md, D40-10): GCRA, the generic cell rate algorithm, with one
 * Lua script per check, so a check is one atomic round trip whatever it reads and writes.
 *
 * A bucket holds `burst` tokens and gains one every `emission` (a per-minute rate). Its whole state is one number, the theoretical
 * arrival time (TAT): absent or in the past means a full bucket. A request is admitted when the TAT it would push the bucket to is at
 * most `burst` emissions ahead of now. Unlike the fixed 60 s window it replaces, there is no minute boundary at which a client is locked
 * out for the rest of the minute or gets two minutes' worth at once, and the burst is explicit.
 *
 * Time is the Redis server's clock (`TIME`), read inside each script, so every app node spends a bucket on one clock: a node whose clock
 * is behind the others' would otherwise see every bucket further in debt than it is and refuse what they admit. The scripts keep it in
 * whole microseconds (the TAT, the emission), which holds any configurable rate to within 1% up to 600 000 a minute; they answer in
 * milliseconds, rounded up.
 *
 * Pure: no Redis, no env. The functions below are the maths the scripts mirror (the unit tests pin them, the live lane pins the Lua to
 * them), and every write a script makes carries an expiry of at most one full refill, so no key outlives its use.
 */
import { createHash } from 'node:crypto';

/** Every rate is "per minute". */
export const RATE_PERIOD_MS = 60_000;

/** The scripts' unit of time: microseconds per millisecond. */
export const US_PER_MS = 1000;

/** How long an active user is remembered per address: users are counted in 10-minute slots, the current one and the previous one. */
export const ACTIVE_USER_SLOT_MS = 10 * 60_000;

/**
 * The token spacing of a per-minute rate in microseconds, rounded UP so the rate is never exceeded. Whole milliseconds held a plan's
 * 40 000 a minute to 30 000 (2 ms) and anything past 60 000 to 60 000; a whole number keeps the Lua and this file equal.
 */
export function emissionUs(perMinute: number): number {
  return Math.ceil((RATE_PERIOD_MS * US_PER_MS) / Math.max(1, perMinute));
}

/** A span the scripts measured in microseconds, in whole milliseconds rounded up (a wait or an expiry is never shortened). */
export const msOf = (us: number): number => Math.ceil(us / US_PER_MS);

export interface GcraStep {
  admitted: boolean;
  /** The TAT after this step (unchanged by a refusal: hammering while refused never extends the wait). */
  tat: number;
  /** Requests still admissible right now. */
  remaining: number;
  /** Until a refused request would be admitted; 0 when admitted. In the unit of `now` and `emission`. */
  wait: number;
  /** Until the bucket is full again (the expiry its key is written with). In the unit of `now` and `emission`. */
  fullIn: number;
}

/** One GCRA step over a stored TAT (null: no key), in any one unit of time. Mirrored by `gcra` in SCRIPT_PRELUDE. */
export function gcra(stored: number | null, now: number, emission: number, burst: number): GcraStep {
  const tat = stored === null || Number.isNaN(stored) || stored < now ? now : stored;
  const next = tat + emission;
  const allowAt = next - emission * burst;
  if (now < allowAt) return { admitted: false, tat, remaining: 0, wait: allowAt - now, fullIn: tat - now };
  return { admitted: true, tat: next, remaining: Math.floor((now - allowAt) / emission), wait: 0, fullIn: next - now };
}

/**
 * The divisor a misbehaving address's ceiling is under (D40-10(d)): 2 (halved) or 4 (quartered); 1 when none is stored or the value is
 * not a number of at least 1, and never more than 16. Mirrored by `divisor` in SCRIPT_PRELUDE.
 */
export function divisorOf(raw: string | null): number {
  const d = raw === null ? Number.NaN : Number(raw);
  if (Number.isNaN(d) || d < 1) return 1;
  return Math.floor(Math.min(d, 16));
}

/** A rate or a burst under a divisor: floored, never below 1. */
export function divided(value: number, divisor: number): number {
  return Math.max(1, Math.floor(value / divisor));
}

/**
 * The per-minute ceiling of the signed-in traffic of one address (D40-10(c)): `base + perUser × users`, at most `max`, under the
 * address's divisor.
 */
export function ceilingPerMinute(users: number, ceiling: { base: number; perUser: number; max: number }, divisor = 1): number {
  return divided(Math.min(ceiling.max, ceiling.base + ceiling.perUser * users), divisor);
}

/** The burst of a per-minute rate that may be spent at once: `burstSeconds` of it, never below 1. */
export function burstOf(perMinute: number, burstSeconds: number): number {
  return Math.max(1, Math.floor((perMinute * burstSeconds) / 60));
}

/** The 10-minute slots active users are counted in at `now`, and how long the current slot's key must live (to the end of the next slot). */
export function activeUserSlots(now: number): { current: number; previous: number; ttlMs: number } {
  const current = Math.floor(now / ACTIVE_USER_SLOT_MS);
  return { current, previous: current - 1, ttlMs: (current + 2) * ACTIVE_USER_SLOT_MS - now };
}

/** A Lua script by its source and the SHA-1 EVALSHA names it by. */
export interface LimiterScript {
  readonly lua: string;
  readonly sha: string;
}

const script = (lua: string): LimiterScript => ({ lua, sha: createHash('sha1').update(lua).digest('hex') });

/**
 * The `now` argument of a bucket script: empty for the Redis server's clock, which is what the limiter always passes. A test that must
 * replay exact times (the live lane's comparison of the Lua with its JS twins) pins one, in milliseconds.
 */
export const REDIS_CLOCK = '';

// The local functions every bucket script starts with. Numbers stay whole (whole microseconds in, whole emission), so what a script
// writes and returns is exactly what `gcra` above computes. `clock` reads TIME before any write: scripts are replicated by their effects
// (the only mode since Redis 7, the default since 5), so a non-deterministic read is allowed there.
const SCRIPT_PRELUDE = `
local function gcra(stored, now, emission, burst)
  local tat = tonumber(stored)
  if tat == nil or tat ~= tat or tat < now then tat = now end
  local nxt = tat + emission
  local allow_at = nxt - emission * burst
  if now < allow_at then return 0, tat, 0, allow_at - now, tat - now end
  return 1, nxt, math.floor((now - allow_at) / emission), 0, nxt - now
end
local function clock(pinned_ms)
  local pinned = tonumber(pinned_ms)
  if pinned ~= nil then return pinned * 1000 end
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000000 + tonumber(t[2])
end
local function spacing(per_minute) return math.ceil(60000000 / per_minute) end
local function ms(us) return math.ceil(us / 1000) end
local function divisor(key)
  local d = tonumber(redis.call('GET', key))
  if d == nil or d ~= d or d < 1 then return 1 end
  return math.floor(math.min(d, 16))
end
`;

/**
 * One bucket. KEYS[1] the bucket.
 * ARGV: now (REDIS_CLOCK, or pinned ms), the per-minute rate, the burst.
 * Returns { admitted (1 or 0), remaining, wait ms, ms until full, the per-minute rate applied }.
 */
export const BUCKET_SCRIPT = script(`${SCRIPT_PRELUDE}
local now = clock(ARGV[1])
local per_minute = tonumber(ARGV[2])
local admitted, tat, remaining, wait, full = gcra(redis.call('GET', KEYS[1]), now, spacing(per_minute), tonumber(ARGV[3]))
if admitted == 1 then redis.call('SET', KEYS[1], tat, 'PX', ms(full)) end
return { admitted, remaining, ms(wait), ms(full), per_minute }
`);

/**
 * A signed-in request: the user's bucket and the address's ceiling, both or neither (a refusal by one never spends the other).
 * KEYS: the user's bucket, the address's ceiling, the users active from the address in this 10-minute slot and in the previous one
 * (HyperLogLogs), the address's divisor, the revocation mark of the request's session (limiter.session-revoked.ts), the firewall's divisor
 * of the address (phase 55 01.6, its own key: the ceiling is divided by the larger of the two).
 * ARGV: now (REDIS_CLOCK, or pinned ms), the user's per-minute rate, the user's burst, the ceiling's base, its share per active user, its
 * maximum, its burst in seconds of its rate, the user id (the HyperLogLog member), the slot key's lifetime (ms).
 * Returns { admitted, refused by (0 none, 1 the user, 2 the address, 3 a revoked session: no person, nothing read or written), remaining,
 * wait ms, ms until full, the per-minute rate of the bucket that decided, active users, divisor }.
 */
export const SIGNED_IN_SCRIPT = script(`${SCRIPT_PRELUDE}
if redis.call('EXISTS', KEYS[6]) == 1 then return { 0, 3, 0, 0, 0, 0, 0, 1 } end
local now = clock(ARGV[1])
if redis.call('PFADD', KEYS[3], ARGV[8]) == 1 then redis.call('PEXPIRE', KEYS[3], ARGV[9]) end
local users = redis.call('PFCOUNT', KEYS[3], KEYS[4])
local d = math.max(divisor(KEYS[5]), divisor(KEYS[7]))
local ceiling = math.max(1, math.floor(math.min(tonumber(ARGV[6]), tonumber(ARGV[4]) + tonumber(ARGV[5]) * users) / d))
local ceiling_burst = math.max(1, math.floor(ceiling * tonumber(ARGV[7]) / 60))
local user_rate = tonumber(ARGV[2])
local ua, utat, urem, uwait, ufull = gcra(redis.call('GET', KEYS[1]), now, spacing(user_rate), tonumber(ARGV[3]))
local ca, ctat, crem, cwait, cfull = gcra(redis.call('GET', KEYS[2]), now, spacing(ceiling), ceiling_burst)
if ua == 1 and ca == 1 then
  redis.call('SET', KEYS[1], utat, 'PX', ms(ufull))
  redis.call('SET', KEYS[2], ctat, 'PX', ms(cfull))
  if urem <= crem then return { 1, 0, urem, 0, ms(ufull), user_rate, users, d } end
  return { 1, 0, crem, 0, ms(cfull), ceiling, users, d }
end
if ua == 0 and (ca == 1 or uwait >= cwait) then return { 0, 1, 0, ms(uwait), ms(ufull), user_rate, users, d } end
return { 0, 2, 0, ms(cwait), ms(cfull), ceiling, users, d }
`);

/**
 * Lifts the firewall's decided division of an address (phase 55 01.6, D55-20) only while it is the run's own: the run key names the run and
 * the divisor is the one it set. Both keys go together, or neither.
 * KEYS: the firewall's divisor of the address, the run that set it. ARGV: the divisor, the run (proposal id).
 * Returns { 1 lifted, 0 not this run's or gone }.
 */
export const CLEAR_FIREWALL_DIVISOR_SCRIPT = script(`
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return { 0 } end
if tonumber(redis.call('GET', KEYS[1])) ~= tonumber(ARGV[1]) then return { 0 } end
redis.call('DEL', KEYS[1], KEYS[2])
return { 1 }
`);

/**
 * One miss of an address (D40-10(d)): counted in a window; the count that goes over the threshold divides the address's ceiling by 2,
 * or by 4 when the address was already divided within the memory period, and starts a new count.
 * KEYS: the address's misses, its divisor, the memory of its last division.
 * ARGV: the window (ms), the threshold, how long a halving lasts (ms), a quartering (ms), the memory (ms).
 * Returns { misses counted, the divisor this miss started (0 = none) }.
 */
export const MISS_SCRIPT = script(`
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if n <= tonumber(ARGV[2]) then return { n, 0 } end
redis.call('DEL', KEYS[1])
local d, ms = 2, ARGV[3]
if redis.call('EXISTS', KEYS[3]) == 1 then d, ms = 4, ARGV[4] end
redis.call('SET', KEYS[2], d, 'PX', ms)
redis.call('SET', KEYS[3], 1, 'PX', ARGV[5])
return { n, d }
`);
