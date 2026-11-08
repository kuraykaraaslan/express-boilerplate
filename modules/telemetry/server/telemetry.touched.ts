import type { RetentionClass } from './telemetry.contract';
import { isRetentionClass } from './telemetry.classes';

/**
 * Touched pairs (docs/phases/42-telemetry/00 §0.8b, ED-12): the writer records which `(lane, tenant, class)` it wrote in which
 * minute, once per pair per minute (an in-process map makes the second write of a minute free), as a member of a Redis set
 * keyed by lane and minute (`telemetry:touched:{<lane>}:<minute>`, kept an hour). The lane's rollup job unions the last few
 * minutes' sets and visits only those pairs, instead of every tenant × every class of the install: an idle pair costs the job
 * nothing. Redis is a hint, not the truth: when it is unavailable the job falls back to the full scan, and a periodic full
 * sweep catches anything a lost set left behind.
 */
export const TOUCHED_WINDOW_MINUTES = 5;
export const TOUCHED_TTL_SECONDS = 3_600;
const MINUTE_MS = 60_000;
const MAP_MAX = 100_000;

export const touchedKeyOf = (lane: string, minuteBucket: number): string => `telemetry:touched:{${lane}}:${minuteBucket}`;

export interface TouchedRedis {
  sadd(key: string, ...members: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  sunion(...keys: string[]): Promise<string[]>;
}

export interface TouchedPair {
  tenantId: string;
  classDays: RetentionClass;
}

export class TouchedPairs {
  private readonly last = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly o: { redis?: TouchedRedis | null; now?: () => number; warn?: (text: string) => void } = {}) {
    this.now = o.now ?? Date.now;
  }

  /** Records a write of the pair in the current minute; returns at once (the Redis call is not awaited). */
  touch(lane: string, tenantId: string, classDays: RetentionClass): void {
    const minute = Math.floor(this.now() / MINUTE_MS);
    const key = `${lane}\u0000${tenantId}\u0000${classDays}`;
    if (this.last.get(key) === minute) return;
    this.last.set(key, minute);
    if (this.last.size > MAP_MAX) this.last.delete(this.last.keys().next().value as string);
    const redis = this.o.redis;
    if (!redis) return;
    const k = touchedKeyOf(lane, minute);
    redis.sadd(k, `${tenantId}:${classDays}`)
      .then(() => redis.expire(k, TOUCHED_TTL_SECONDS))
      .catch((e: unknown) => this.o.warn?.(`telemetry touched set unavailable: ${e instanceof Error ? e.message : String(e)}`));
  }

  /** The pairs of the lane written in the last `TOUCHED_WINDOW_MINUTES` minutes, or null when Redis cannot answer. */
  async pairs(lane: string): Promise<TouchedPair[] | null> {
    const redis = this.o.redis;
    if (!redis) return null;
    const minute = Math.floor(this.now() / MINUTE_MS);
    const keys = Array.from({ length: TOUCHED_WINDOW_MINUTES + 1 }, (_, i) => touchedKeyOf(lane, minute - i));
    try {
      const members = await redis.sunion(...keys);
      const out: TouchedPair[] = [];
      for (const m of members) {
        const i = m.lastIndexOf(':');
        const tenantId = m.slice(0, i);
        const d = Number(m.slice(i + 1));
        if (tenantId && isRetentionClass(d)) out.push({ tenantId, classDays: d });
      }
      return out;
    } catch (e) {
      this.o.warn?.(`telemetry touched set unavailable, scanning every tenant: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
