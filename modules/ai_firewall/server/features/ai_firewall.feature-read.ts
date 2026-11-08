import {
  DISTINCT_DIMS, FEATURE_WINDOWS, actorPart, bucketOf, counterKey, dayOf, distinctKey, profileKey, slidingValue,
  type DistinctDim, type WindowId,
} from './ai_firewall.feature-windows';

/**
 * Reads one actor's windows and today's profile from the feature store (docs/phases/55-ai-firewall/02 §2.1) in ONE pipeline:
 * for each of the four windows the current and the previous bucket (HGETALL) and the union count of each distinct dimension
 * (PFCOUNT over both buckets), and the day profile (HGETALL): 4 × (2 + 4) + 1 = 25 commands, one round trip.
 *
 * Bounded (`READ_TIMEOUT_MS`) and fail-open: a Redis that is down, slow or answers garbage gives `null`, and the caller scores without
 * windows (missing features, which the tree models route by their default direction; FWA-7).
 */
export const READ_TIMEOUT_MS = 50;

export interface WindowValues {
  counters: Record<string, number>;
  distinct: Record<DistinctDim, number>;
}
export interface ActorWindows {
  windows: Record<WindowId, WindowValues>;
  /** Today's (UTC) profile fields: `hHH`, `v:<class>`, `xb`, `adm`, `c:<CC>`, `a:<asn>`, `d:<device>` (numbers), `r` dropped. */
  today: Record<string, number>;
}

export interface ReadPipeline {
  hgetall(key: string): unknown;
  pfcount(...keys: string[]): unknown;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}
export interface ReadRedis {
  status?: string;
  pipeline(): ReadPipeline;
}

const numbersOf = (hash: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!hash || typeof hash !== 'object') return out;
  for (const [k, v] of Object.entries(hash as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
};

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** One actor's windows; null when they cannot be read now. Never throws. */
export async function readActorWindows(
  redis: ReadRedis, actor: { scope: string; kind: string; hash: string }, nowMs: number = Date.now(), timeoutMs: number = READ_TIMEOUT_MS,
): Promise<ActorWindows | null> {
  try {
    if (redis.status && redis.status !== 'ready') return null;
    const a = actorPart(actor.scope, actor.kind, actor.hash);
    const nowSeconds = Math.floor(nowMs / 1000);
    const pipe = redis.pipeline();
    for (const w of FEATURE_WINDOWS) {
      const b = bucketOf(nowSeconds, w.seconds);
      pipe.hgetall(counterKey(w.id, b, a));
      pipe.hgetall(counterKey(w.id, b - 1, a));
      for (const dim of DISTINCT_DIMS) pipe.pfcount(distinctKey(w.id, b, a, dim), distinctKey(w.id, b - 1, a, dim));
    }
    pipe.hgetall(profileKey(dayOf(nowMs), a));
    const replies = await within(pipe.exec(), timeoutMs);
    if (!replies) return null;
    let i = 0;
    const next = (): unknown => {
      const [err, value] = replies[i++] ?? [new Error('short reply'), null];
      if (err) throw err;
      return value;
    };
    const windows = {} as Record<WindowId, WindowValues>;
    for (const w of FEATURE_WINDOWS) {
      const cur = numbersOf(next());
      const prev = numbersOf(next());
      const counters: Record<string, number> = {};
      for (const f of new Set([...Object.keys(cur), ...Object.keys(prev)])) {
        counters[f] = slidingValue(cur[f] ?? 0, prev[f] ?? 0, nowSeconds, w.seconds);
      }
      const distinct = {} as Record<DistinctDim, number>;
      for (const dim of DISTINCT_DIMS) {
        const n = Number(next());
        distinct[dim] = Number.isFinite(n) ? n : 0;
      }
      windows[w.id] = { counters, distinct };
    }
    return { windows, today: numbersOf(next()) };
  } catch {
    return null;
  }
}
