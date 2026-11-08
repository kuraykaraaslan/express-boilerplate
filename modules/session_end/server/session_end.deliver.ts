import { entryJson, DELIVERY_TIMEOUT_MS, type SessionEndPayload } from './session_end.contract';

/**
 * Delivering one order to Redis (`session_end.contract.ts`): the generation bumps, the deletes, then the XADD. Shared by the writer's
 * fast path and the relay, so both write the same entry. No database, no Next. Throws when Redis does not take every step within
 * `timeoutMs`; a step that already ran is harmless to run again (see the contract).
 */

/** The part of an ioredis client delivery uses (`ioredis` satisfies it; tests pass a fake). */
export interface DeliveryRedis {
  incr(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  xadd(key: string, ...args: Array<string | number>): Promise<unknown>;
}

export class DeliveryTimeout extends Error {
  constructor(ms: number) {
    super(`Redis did not answer within ${ms} ms`);
    this.name = 'DeliveryTimeout';
  }
}

/** `work`, or a rejection after `ms` (the work itself is not cancelled: ioredis ends it on its own retry limit). */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeliveryTimeout(ms)), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function deliverSteps(redis: DeliveryRedis, orderId: string, p: SessionEndPayload): Promise<void> {
  for (const { key, ttlSeconds } of p.incr ?? []) {
    await redis.incr(key);
    await redis.expire(key, ttlSeconds);
  }
  if (p.del?.length) await redis.del(...p.del);
  await redis.xadd(p.stream, 'MAXLEN', '~', p.maxlen, '*', p.field, entryJson(orderId, p.entry));
}

/** Writes one order. Throws when Redis refuses or does not answer within `timeoutMs`. */
export function deliverPayload(redis: DeliveryRedis, orderId: string, payload: SessionEndPayload, timeoutMs = DELIVERY_TIMEOUT_MS): Promise<void> {
  return withTimeout(deliverSteps(redis, orderId, payload), timeoutMs);
}
