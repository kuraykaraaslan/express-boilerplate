import type { RedisOptions } from 'ioredis';

/**
 * Sentinel settings from the environment, shared by every connection that must follow a failover (today the BullMQ one).
 *
 *   REDIS_SENTINELS=sentinel1:26379,sentinel2:26379   comma-separated host:port, a missing port means 26379
 *   REDIS_SENTINEL_NAME=mymaster                      the monitored master (default `mymaster`)
 *   REDIS_PASSWORD / REDIS_SENTINEL_PASSWORD          the master's and the sentinels' passwords
 *
 * Unset or empty `REDIS_SENTINELS` means no Sentinel: callers keep using `REDIS_URL`, exactly as before. Once it is set, `REDIS_URL`
 * is ignored (the same rule as `redis.service.ts`), and a malformed list throws instead of producing a connection that silently
 * points nowhere. Redis Cluster is not supported here: BullMQ needs hash-tagged queue names on a cluster, which the shared
 * `createQueue` does not do.
 */
export const DEFAULT_SENTINEL_PORT = 26379;
const DEFAULT_MASTER_NAME = 'mymaster';

export interface SentinelEnv {
  REDIS_SENTINELS?: string;
  REDIS_SENTINEL_NAME?: string;
  REDIS_PASSWORD?: string;
  REDIS_SENTINEL_PASSWORD?: string;
}

function parseEndpoint(entry: string): { host: string; port: number } {
  const at = entry.lastIndexOf(':');
  const host = (at === -1 ? entry : entry.slice(0, at)).trim();
  const portText = at === -1 ? '' : entry.slice(at + 1).trim();
  const port = portText === '' ? DEFAULT_SENTINEL_PORT : Number(portText);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`REDIS_SENTINELS entry "${entry}" is not host[:port]`);
  }
  return { host, port };
}

/** The ioredis options that make a client discover the master through the sentinels; null when Sentinel is not configured. */
export function sentinelOptions(env: SentinelEnv): Pick<RedisOptions, 'sentinels' | 'name' | 'password' | 'sentinelPassword'> | null {
  if (!env.REDIS_SENTINELS?.trim()) return null;
  const entries = env.REDIS_SENTINELS.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error('REDIS_SENTINELS lists no sentinel');
  return {
    sentinels: entries.map(parseEndpoint),
    name: env.REDIS_SENTINEL_NAME || DEFAULT_MASTER_NAME,
    password: env.REDIS_PASSWORD,
    sentinelPassword: env.REDIS_SENTINEL_PASSWORD,
  };
}
