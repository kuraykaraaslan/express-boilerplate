import { LessThan } from 'typeorm';
import Logger from '@kuraykaraaslan-labs/logger';
import { IdempotencyClaim } from './entities/idempotency_claim.entity';

/**
 * redis_idempotency.02: the database side of an Idempotency-Key claim (see the entity). Every call is bounded and never
 * throws: `null` means "the durable store could not answer", and the caller decides (the HTTP wrapper then refuses 503 if
 * Redis could not answer either). The timer is captured at load, so a test's fake clock cannot stall a claim.
 */
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
const DB_TIMEOUT_MS = 2000;

/**
 * On by default. Off when IDEMPOTENCY_DURABLE_STORE=off, and under NODE_ENV=test unless IDEMPOTENCY_DURABLE_STORE=on: unit
 * suites stub Redis but not the database, and a test that exercises the durable path opts in (with the entity registered
 * in its fake data source).
 */
function enabled(): boolean {
  const flag = process.env.IDEMPOTENCY_DURABLE_STORE;
  if (flag === 'off') return false;
  if (flag === 'on') return true;
  return process.env.NODE_ENV !== 'test';
}

async function bounded<T>(work: () => Promise<T>): Promise<T | null> {
  if (!enabled()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = work();
    pending.catch(() => {});
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => { timer = realSetTimeout(() => resolve(null), DB_TIMEOUT_MS); }),
    ]);
  } catch (err) {
    Logger.warn(`[idempotency] durable store unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    if (timer) realClearTimeout(timer);
  }
}

async function repo() {
  const { getDataSource } = await import('@kuraykaraaslan-labs/db');
  return (await getDataSource()).getRepository(IdempotencyClaim);
}

export type DurableClaim = { acquired: true } | { acquired: false; status: 'pending' | 'completed' };

/** Claim `claimKey` (insert-if-absent; an expired row is replaced). Null when the database could not answer. */
export function durableAcquire(claimKey: string, pendingTtlSeconds: number): Promise<DurableClaim | null> {
  return bounded(async () => {
    const r = await repo();
    const now = new Date();
    await r.delete({ claimKey, expiresAt: LessThan(now) });
    const res = await r.createQueryBuilder().insert().into(IdempotencyClaim)
      .values({ claimKey, status: 'pending', expiresAt: new Date(now.getTime() + pendingTtlSeconds * 1000) })
      .orIgnore().execute();
    // Postgres answers the RETURNING rows of what was really inserted (none when ON CONFLICT DO NOTHING skipped it).
    const inserted = Array.isArray(res.raw) ? res.raw.length : Number((res.raw as { rowCount?: number } | undefined)?.rowCount ?? 0);
    if (inserted > 0) return { acquired: true } as const;
    const existing = await r.findOne({ where: { claimKey } });
    if (!existing) return { acquired: true } as const;
    return { acquired: false, status: existing.status === 'completed' ? 'completed' : 'pending' } as const;
  });
}

export function durableComplete(claimKey: string, ttlSeconds: number): Promise<unknown> {
  return bounded(async () => {
    const r = await repo();
    await r.upsert({ claimKey, status: 'completed', expiresAt: new Date(Date.now() + ttlSeconds * 1000) }, ['claimKey']);
    return true;
  });
}

export function durableRelease(claimKey: string): Promise<unknown> {
  return bounded(async () => {
    await (await repo()).delete({ claimKey });
    return true;
  });
}
