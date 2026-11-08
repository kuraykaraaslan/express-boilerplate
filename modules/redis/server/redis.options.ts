import type { RedisOptions } from 'ioredis';

/**
 * The options of the shared (non-BullMQ) Redis client. limiter.03: with `maxRetriesPerRequest: null` a command issued while
 * Redis is unreachable sat in ioredis's offline queue until the connection came back, so every request behind the
 * limiter, an idempotency claim, a cache read or a lock hung instead of reaching its fail-open / fail-closed branch. A
 * small retry budget makes such a command reject after a couple of reconnection attempts (well under a second with the
 * default backoff), and each caller's own outage policy decides. BullMQ connections keep `null` (redis.bullmq.ts): BullMQ
 * requires it for its blocking commands.
 *
 * No imports and no side effects, so the security harness can build a "production" client from the same options.
 */
export const REDIS_CLIENT_OPTIONS: RedisOptions = { maxRetriesPerRequest: 2 };
