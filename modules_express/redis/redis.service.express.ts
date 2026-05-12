import { Queue } from 'bullmq';
import { getBullMQConnection } from '@/modules/redis';

export { default, createRedisConnection, redisConnectionOptions, getBullMQConnection } from '@/modules/redis';

export function createQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: getBullMQConnection() });
}
