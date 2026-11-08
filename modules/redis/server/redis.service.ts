import { Redis, type RedisOptions } from 'ioredis';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';

import { REDIS_CLIENT_OPTIONS } from './redis.options';
import { watchRedisClient } from './redis.health';

const BASE_OPTIONS: RedisOptions = { ...REDIS_CLIENT_OPTIONS };

function buildOptions(): RedisOptions {
  // Prefer Sentinel config when REDIS_SENTINELS is provided (comma-separated host:port list).
  // e.g. REDIS_SENTINELS=sentinel1:26379,sentinel2:26379  REDIS_SENTINEL_NAME=mymaster
  if (env.REDIS_SENTINELS) {
    const sentinels = env.REDIS_SENTINELS.split(',').map((s) => {
      const [host, portStr] = s.trim().split(':');
      return { host, port: parseInt(portStr ?? '26379', 10) };
    });
    return {
      ...BASE_OPTIONS,
      sentinels,
      name: env.REDIS_SENTINEL_NAME ?? 'mymaster',
      password: env.REDIS_PASSWORD,
      sentinelPassword: env.REDIS_SENTINEL_PASSWORD,
    };
  }
  return BASE_OPTIONS;
}

function attachLifecycleListeners(client: Redis, label: string): Redis {
  client.on('error', (err) => Logger.error(`[Redis:${label}] connection error: ${err.message}`));
  client.on('reconnecting', () => Logger.warn(`[Redis:${label}] reconnecting…`));
  client.on('ready', () => Logger.info(`[Redis:${label}] ready`));
  return client;
}

// Inside the Next server, instrumentation, route handlers and the proxy are separate bundle graphs that each evaluate
// this module, so a module-level `new Redis()` opens one connection set per graph (three `[Redis:default] ready` lines at
// boot, seven sockets after the first request) and dev reloads add more. Outside Next (sidecars, vitest) nothing
// duplicates it, and tests must keep their own instance, so the shared slot is used only when NEXT_RUNTIME is set.
const SHARED_SLOT = Symbol.for('nb.redis.default');
const sharedStore = globalThis as typeof globalThis & { [SHARED_SLOT]?: Redis };

function createDefaultInstance(): Redis {
  return attachLifecycleListeners(
    env.REDIS_SENTINELS
      ? new Redis(buildOptions())
      : new Redis(env.REDIS_URL, buildOptions()),
    'default',
  );
}

const redisInstance = process.env.NEXT_RUNTIME
  ? (sharedStore[SHARED_SLOT] ??= createDefaultInstance())
  : createDefaultInstance();

// D253: the caches that guard an access decision trust an entry only while this client is ready, quiet and talking to the instance
// the entry was written to (redis.health.ts). Each bundle graph has its own tracker, so each one watches the shared client.
watchRedisClient(redisInstance);

/** Create an independent Redis connection (e.g. for Pub/Sub subscribers). */
export const createRedisConnection = (): Redis =>
  attachLifecycleListeners(
    env.REDIS_SENTINELS
      ? new Redis(buildOptions())
      : new Redis(env.REDIS_URL, buildOptions()),
    'pubsub',
  );

export default redisInstance;
