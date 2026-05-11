import { Redis } from 'ioredis';
import { Queue, ConnectionOptions } from 'bullmq';
import { env } from '@/libs/env';

// ── Connection options ────────────────────────────────────────────────────────

export const redisConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null as null, // Required by BullMQ
};

// ── Singleton Redis instance ──────────────────────────────────────────────────

export const redisInstance = new Redis(redisConnectionOptions);

/** Create an independent Redis connection (e.g. for Pub/Sub subscribers). */
export const createRedisConnection = (): Redis => new Redis(redisConnectionOptions);

// ── BullMQ helpers ────────────────────────────────────────────────────────────

export function getBullMQConnection(): ConnectionOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
}

/** Create a BullMQ Queue with the shared Redis connection. */
export function createQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: getBullMQConnection() });
}

export default redisInstance;
