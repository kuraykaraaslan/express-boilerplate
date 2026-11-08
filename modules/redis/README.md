# Redis Module

Shared Redis client (ioredis) and BullMQ connection factory. One pooled client for application reads/writes, plus helpers for creating independent connections (Pub/Sub), BullMQ queues, and cache stampede protection. There are no entities, routes, or settings — this is a pure infrastructure module wired entirely from global `env.REDIS_*` variables.

---

## Public API

| Export | Source | Use |
|---|---|---|
| `redis` (default export) | [redis.service.ts](redis.service.ts) | The shared `ioredis` connection. Use for `get`/`set`/`incr`/etc. |
| `createRedisConnection()` | [redis.service.ts](redis.service.ts) | New independent connection (required for Pub/Sub subscribers — they can't share the main client). |
| `getBullMQConnection()` | [redis.bullmq.ts](redis.bullmq.ts) | `ConnectionOptions` for BullMQ workers and queues. |
| `createQueue<T>(name)` | [redis.bullmq.ts](redis.bullmq.ts) | Convenience factory: `new Queue(name, { connection: getBullMQConnection() })`. |
| `queueWait(name)`, `queueWaits(names)`, `oldestWaitSeconds(names)` | [redis.bullmq-wait.ts](server/redis.bullmq-wait.ts) | How long each queue's oldest waiting job has waited (`getJobCounts('wait', 'prioritized')`, then the oldest of the wait list and the head of the prioritized set; a job waits since `timestamp + delay`; delayed and paused jobs do not count). The `worker` process kind's scaling signal (docs/phases/14-docker/07 task 7). Import from `@kuraykaraaslan-labs/redis/server/redis.bullmq-wait`. |
| `jitter(ttl, factor?)` | [redis.cache.ts](redis.cache.ts) | Returns `ttl ± factor%` (default 10%). Apply to every `setex` TTL so co-written keys don't expire on the same second. |
| `singleFlight(key, loader)` | [redis.cache.ts](redis.cache.ts) | In-process dedup of concurrent loaders for the same key. Process-local — does not deduplicate across pods. |
| `redisCacheInstance()`, `noteRedisTrouble()`, `watchRedisClient(c)` | [redis.health.ts](server/redis.health.ts) | D253: the id of the Redis instance the default client talks to (its `run_id`; a marker key where INFO is refused), or null while the client is not ready and for 5 s after any error, close, reconnect or noted failed command. The caches that guard an access decision (session_end's cache guard) seal their entries with it, so nothing written to another instance, or while Redis was in trouble, is believed. `redis.service.ts` watches the default client. Import from `@kuraykaraaslan-labs/redis/server/redis.health`. |

The package root (`index.ts`) re-exports `default` (the client), `createRedisConnection`, `getBullMQConnection`, `jitter`, and `singleFlight`. `createQueue` is imported directly from `redis.bullmq.ts`.

---

## Usage

### Plain Redis

```ts
import redis from "@/modules/redis";

await redis.set(`session:${id}`, JSON.stringify(payload), "EX", 1800);
const raw = await redis.get(`session:${id}`);
```

### BullMQ queue

```ts
import { createQueue } from "@/modules/redis/redis.bullmq";

const mailQueue = createQueue<MailJob>("notification_mail");
await mailQueue.add("welcome", { userId, template: "welcome" });
```

### Pub/Sub subscriber

```ts
import { createRedisConnection } from "@/modules/redis";

const sub = createRedisConnection();
await sub.subscribe("tenant-events");
sub.on("message", (channel, msg) => { /* … */ });
```

### Cached read with stampede protection

```ts
import redis, { jitter, singleFlight } from "@/modules/redis";

async function getUserById(userId: string) {
  const cacheKey = `user:id:${userId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached);

  return singleFlight(cacheKey, async () => {
    const row = await db.user.findUnique({ where: { id: userId } });
    if (row) await redis.setex(cacheKey, jitter(300), JSON.stringify(row));
    return row;
  });
}
```

`singleFlight` keeps an in-process `Map<key, Promise>` — when N concurrent callers miss on the same key, only one DB query runs and the rest await its result. It does **not** dedupe across separate Node processes; for cross-pod single-flight you'd need a Redis `SET NX` lock layered on top.

---

## Connection options

Driven by `env.REDIS_URL` (default `redis://localhost:6379`) — a single connection string. `maxRetriesPerRequest: null` is set explicitly on both the client and the BullMQ connection — it's required by BullMQ.

**Sentinel.** When `REDIS_SENTINELS` is set (comma-separated `host[:port]`, port defaults to 26379), the shared client and the BullMQ connection discover the master through the sentinels and `REDIS_URL` is ignored: `REDIS_SENTINEL_NAME` (default `mymaster`), `REDIS_PASSWORD` (the master) and `REDIS_SENTINEL_PASSWORD` (the sentinels). The BullMQ side parses the list in [redis.sentinel.ts](redis.sentinel.ts) and throws on a malformed entry instead of connecting nowhere. Unset or empty `REDIS_SENTINELS` keeps the plain `REDIS_URL` connection. Redis Cluster is not supported: BullMQ would need hash-tagged queue names, which `createQueue` does not apply.

Both the shared client and `getBullMQConnection()` read the same settings, so connection settings stay consistent across the app.

---

## Where Redis is used in this project

- Session cache ([modules/user_session](../user_session/))
- Idempotency keys ([modules/redis_idempotency](../redis_idempotency/))
- Rate limiting ([modules/limiter](../limiter/))
- Mail / push / sms queues (BullMQ — see notification modules)
- OAuth state, OTP, password-reset tokens (TTL keys)

---

## Settings

None. This module has no per-module setting keys or settings fields — all configuration comes from global `env.REDIS_*` variables (see [modules/env](../env/)).

---

## Rules

- No `next/*`, no `react`.
- **Don't** create one-off `new Redis(...)` instances scattered across modules — go through this module's helpers so connection options stay consistent.
- For Pub/Sub subscribers, always use `createRedisConnection()` — subscribed connections cannot serve other commands.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

No per-tenant variability — The redis module provides a shared global ioredis client, BullMQ connection/queue factories, and cache primitives (jitter, singleFlight) wired entirely from global env.REDIS_* variables, with no tenant awareness at all.

---

## Dependencies

Requires [`env`](../env/) for connection configuration. Uses `ioredis` and `bullmq`.
