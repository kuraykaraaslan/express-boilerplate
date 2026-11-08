/**
 * limiter.03: the longest a limiter round trip may take. The shared client queues commands while Redis is unreachable
 * (`maxRetriesPerRequest: null` and the offline queue), so an unbounded await would hang every request behind the limiter
 * instead of reaching the fail-open / fail-closed policy. Past this bound the call counts as a Redis failure.
 *
 * In a file of its own (no env, no observability import) so the proxy's ban gate (limiter.ban-gate.ts) can bound its reads too;
 * `limiter.service` re-exports both names, so every existing import keeps working.
 */
export const LIMITER_REDIS_TIMEOUT_MS = 1000;

export function withinRedisBound<T>(work: Promise<T> | T, ms = LIMITER_REDIS_TIMEOUT_MS): Promise<T> {
  const pending = Promise.resolve(work);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`redis did not answer within ${ms} ms`)), ms);
  });
  pending.catch(() => {}); // a late rejection after the bound must not surface as unhandled
  return Promise.race([pending, bound]).finally(() => clearTimeout(timer));
}
