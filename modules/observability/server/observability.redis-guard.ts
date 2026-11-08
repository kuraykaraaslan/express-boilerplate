/**
 * A bound on every Redis call the governance layer makes on a hot path (ingest, alert ingest). A Redis that is down must never hold a customer's request:
 * the client may queue commands while it reconnects, so a plain `await redis.incrby(...)` can wait for as long as the outage lasts. Every such call goes
 * through `redisCall`, which gives up after `REDIS_CALL_TIMEOUT_MS` and throws, and each caller treats the throw as "the counter cannot answer" and fails
 * OPEN (the refusal is the exception; a counter outage is not a reason to refuse or to wait).
 */
export const REDIS_CALL_TIMEOUT_MS = 250

export class RedisCallTimeout extends Error {
  constructor(ms: number) { super(`redis did not answer within ${ms} ms`); this.name = 'RedisCallTimeout' }
}

export function redisCall<T>(run: () => Promise<T>, ms: number = REDIS_CALL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RedisCallTimeout(ms)), ms); timer.unref?.() })
  return Promise.race([run(), timeout]).finally(() => { if (timer) clearTimeout(timer) })
}
