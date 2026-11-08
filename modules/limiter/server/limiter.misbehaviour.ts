/**
 * The misbehaviour signal per client address (docs/phases/07-dashboard/40-data-traffic.md, D40-10(d)): the 401 / 403 / 404 answers an
 * address gets from the tenant API (counted where the dispatcher hands each answer over, Limiter.noteAnswer), so also its failed
 * sign-ins, which answer 401 (a wrong password, an unknown user, a wrong code) or 403 (a locked account), and the 429s of the address's
 * own `api` limits (its anonymous bucket, the ceiling of its signed-in traffic; counted where they refuse, Limiter.checkRateLimit).
 * A 429 the address did not earn is not counted: the tenant plan's allowance (spent by every caller of the tenant), a person's own
 * bucket (spendable from anywhere with that person's token), the other limiters' per-credential budgets. Past the threshold in the
 * window, the ceiling of the address's signed-in traffic is divided: halved for 15 minutes, quartered for an hour when it happens again
 * within the hour. The anonymous bucket stays at 120 (D40-10(e)), a person's own bucket and the auth scope (with its strikes and bans,
 * limiter.ip-strikes.ts) are not touched: bad behaviour costs the address, not good users elsewhere.
 *
 * Who is counted (Limiter.noteAnswer and the refusals alike): only lanes that take part in IP bans (human-web, human-native,
 * public-anon; docs/phases/38-security L-4: an API key, a fleet agent, a provider webhook or a cron job is never judged by its IP,
 * carrier and site NAT would put a whole building under one machine's failures), and never a request a browser marks as sent by
 * another site (`Sec-Fetch-Site: cross-site` or `same-site`): any page a person opens could otherwise fire hundreds of requests at the
 * tenant from their office. The app's own requests are same-origin; native apps and scripts send no such header.
 *
 * The threshold, 300 in 5 minutes, is one such answer a second on average. A normal office stays far below it: an expired access token
 * is one 401 per tab before its refresh, a stale link or a missing permission the odd 404 or 403, tens in 5 minutes even for many people
 * behind one address. Whatever crosses it is scanning, guessing or ignoring Retry-After: an anonymous scanner spending its whole `api`
 * budget (120 a minute and a burst of 120) on misses gets there in under three minutes, a client that hammers through its 429s in
 * seconds. Crossing it by mistake costs little: the address's ceiling shrinks, its people keep their own buckets.
 *
 * Best effort: a Redis failure here is logged and never changes an answer, and nobody waits for it. A division is also reported to the AI
 * firewall (phase 55 02.6, `limiter.address_divided`, limiter.firewall-emitters.ts; synchronous, never throws).
 */
import Logger from '@kuraykaraaslan-labs/logger';
import { env } from '@kuraykaraaslan-labs/env';
import redis from '@kuraykaraaslan-labs/redis';
import { CLEAR_FIREWALL_DIVISOR_SCRIPT, MISS_SCRIPT, divisorOf } from './limiter.gcra';
import { divisorKey, firewallDivisorKey, firewallDivisorRunKey, missesKey, runLimiterScript, shrunkKey, withinRedisBound } from './limiter.service';
import { noteAddressDivided } from './limiter.firewall-emitters';

/** The answers that count as a miss wherever they come from; a 429 counts only where the address's own limits refuse (see above). */
export const MISS_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);
/** The window misses are counted in, seconds. */
export const MISS_WINDOW_SECONDS = 5 * 60;
/** Misses in the window an address may have; the next one divides its limits. */
export const MISS_THRESHOLD = 300;
/** How long the first division (by 2) lasts, seconds. */
export const SHRINK_HALF_SECONDS = 15 * 60;
/** How long a repeat division (by 4) lasts, seconds. */
export const SHRINK_QUARTER_SECONDS = 60 * 60;
/** How long a division is remembered: crossing the threshold again within it is a repeat. */
export const SHRINK_MEMORY_SECONDS = 60 * 60;

/**
 * One miss of an address (its rate-limit bucket, `rateLimitBucketOf`). Returns the misses counted in the window and the divisor this
 * miss started (0 when none), or null when nothing was counted (the limiter is off, no address, Redis failed). Never throws.
 */
export async function recordMiss(address: string): Promise<{ misses: number; divisor: number } | null> {
  if (env.RATE_LIMIT_DISABLED || !address || address === 'unknown') return null;
  try {
    const [misses, divisor] = await runLimiterScript(
      MISS_SCRIPT,
      [missesKey(address), divisorKey(address), shrunkKey(address)],
      [MISS_WINDOW_SECONDS * 1000, MISS_THRESHOLD, SHRINK_HALF_SECONDS * 1000, SHRINK_QUARTER_SECONDS * 1000, SHRINK_MEMORY_SECONDS * 1000],
      2,
    );
    if (divisor! > 0) {
      Logger.warn(`[limiter] misbehaving address: ip=${address} misses=${misses} in ${MISS_WINDOW_SECONDS} s, its ceiling divided by ${divisor} for ${divisor === 2 ? SHRINK_HALF_SECONDS : SHRINK_QUARTER_SECONDS} s`);
      // Phase 55 02.6: the division is a signal for the AI firewall (`limiter.address_divided`); at most once per address per 15 minutes.
      noteAddressDivided({ address, divisor: divisor!, misses: misses!, seconds: divisor === 2 ? SHRINK_HALF_SECONDS : SHRINK_QUARTER_SECONDS });
    }
    return { misses: misses!, divisor: divisor! };
  } catch (err) {
    Logger.warn(`[limiter] miss not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * A decided division of an address's signed-in ceiling (phase 55 01.6: the firewall's throttle, `limiter.throttle`), by `divisor` (2..16)
 * for `ms`, set by the run `runId` (its proposal id). It lives in its own key (`firewallDivisorKey`), never the misbehaviour script's
 * `divisorKey`: the signed-in script divides by the larger of the two, so a decision never replaces, shortens or weakens the script's
 * division and its undo or expiry can never end one (FWA-2, FWA-7), and the script's next division never weakens the decision. The run
 * is recorded beside it (`firewallDivisorRunKey`), in the same MULTI and with the same span (D55-20). A decided division at least as
 * strong already in force is left alone (`applied: false`); `previous` is the divisor the ceiling was under before (the larger of the two
 * keys). Throws when Redis does not answer (the caller reports the run as failed; nothing in the request path waits for this).
 */
export async function throttleAddress(address: string, divisor: number, ms: number, runId: string): Promise<{ applied: boolean; previous: number }> {
  const d = divisorOf(String(divisor));
  const key = firewallDivisorKey(address);
  const [scripted, decided] = await Promise.all([
    withinRedisBound(redis.get(divisorKey(address))),
    withinRedisBound(redis.get(key)),
  ]);
  const previous = Math.max(divisorOf(scripted), divisorOf(decided));
  if (divisorOf(decided) >= d) return { applied: false, previous };
  const span = Math.max(1_000, Math.floor(ms));
  const results = await withinRedisBound(redis.multi()
    .set(key, String(d), 'PX', span)
    .set(firewallDivisorRunKey(address), runId, 'PX', span)
    .exec());
  const failed = results?.find(([err]) => err);
  if (!results || failed) throw failed?.[0] ?? new Error('the decided division was not written');
  Logger.info(`[limiter] address throttled by decision: ip=${address} ceiling divided by ${d} for ${Math.round(ms / 1000)} s`);
  return { applied: true, previous };
}

/**
 * Lifts a decided division: only the firewall's own key, and only while it is still the run's own (the run key names `runId` and the
 * divisor is the one `throttleAddress` set), checked and deleted in one script (D55-20). One that ran out is not lifted, and neither is a
 * later run's of the same strength. The misbehaviour script's division and its memory (`divisorKey`, `shrunkKey`) are never touched.
 * Answers whether one was lifted.
 */
export async function clearAddressThrottle(address: string, divisor: number, runId: string): Promise<boolean> {
  if (!runId) return false;
  const [lifted] = await runLimiterScript(
    CLEAR_FIREWALL_DIVISOR_SCRIPT,
    [firewallDivisorKey(address), firewallDivisorRunKey(address)],
    [divisorOf(String(divisor)), runId],
    1,
  );
  return lifted === 1;
}
