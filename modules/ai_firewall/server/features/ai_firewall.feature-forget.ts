import {
  DISTINCT_DIMS, ERASED_MARK_SECONDS, FEATURE_WINDOWS, PROFILE_DIMS, activeActorsKey, activeMember, actorPart, bucketOf, counterKey, dayOf,
  distinctKey, erasedMarkKey, knownEndpointsKey, profileDistinctKey, profileKey,
} from './ai_firewall.feature-windows';

/**
 * Forgetting one actor of the feature store (docs/phases/55-ai-firewall/02 §2.8, D55-46), for the privacy erasure: the person's Redis
 * keys are deleted at once instead of waiting for their expiry, and a mark keeps the daily baseline job from rebuilding the erased
 * person's baseline out of a day profile a flush wrote after the erasure (the request folds of other processes flush up to 5 s late).
 *
 *   - the window buckets that can still exist (current, previous and the one before, per window) and their distinct sets;
 *   - the touched-endpoint set;
 *   - the day profiles (and their distinct sets) of today, yesterday and the day before, and the actor's member of each day's work list;
 *   - then the mark `fw:fx:<actor>` for ERASED_MARK_SECONDS.
 *
 * Every key name is computed (keyed hashes only, no scan). One pipeline; best effort: a Redis that cannot answer answers false and the
 * keys expire on their own within two days (the erasure itself never fails on it).
 */
export interface ForgetRedis {
  pipeline(): {
    del(key: string): unknown;
    srem(key: string, member: string): unknown;
    set(key: string, value: string, mode: 'EX', seconds: number): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
}

const DAY_MS = 86_400_000;
/** How many past buckets per window may still hold a key (bucketExpireAt: a bucket lives until its successor ended, plus a minute). */
const BUCKETS_BACK = 2;
/** Today, yesterday and the day before (a day profile lives until its day ended plus PROFILE_KEEP_SECONDS). */
const DAYS_BACK = 2;

/** Every key the store may hold for this actor at `nowMs`, and the work-list members to remove. Pure. */
export function featureKeysOfActor(scope: string, kind: string, hash: string, nowMs: number): { keys: string[]; members: Array<[string, string]> } {
  const actor = actorPart(scope, kind, hash);
  const nowSeconds = Math.floor(nowMs / 1000);
  const keys: string[] = [];
  for (const w of FEATURE_WINDOWS) {
    const current = bucketOf(nowSeconds, w.seconds);
    for (let b = current - BUCKETS_BACK; b <= current; b += 1) {
      keys.push(counterKey(w.id, b, actor));
      for (const dim of DISTINCT_DIMS) keys.push(distinctKey(w.id, b, actor, dim));
    }
  }
  keys.push(knownEndpointsKey(actor));
  const members: Array<[string, string]> = [];
  for (let i = 0; i <= DAYS_BACK; i += 1) {
    const day = dayOf(nowMs - i * DAY_MS);
    keys.push(profileKey(day, actor));
    for (const dim of PROFILE_DIMS) keys.push(profileDistinctKey(day, actor, dim));
    members.push([activeActorsKey(day), activeMember(scope, kind, hash)]);
  }
  return { keys, members };
}

async function defaultRedis(): Promise<ForgetRedis> {
  return (await import('@kuraykaraaslan-labs/redis')).default as unknown as ForgetRedis;
}

/** Deletes the actor's feature keys and marks it erased. Never throws; answers whether the pipeline ran. */
export async function forgetFeatureActor(
  scope: string, kind: string, hash: string, nowMs: number = Date.now(), redis?: ForgetRedis | (() => Promise<ForgetRedis>),
): Promise<boolean> {
  try {
    const client = typeof redis === 'function' ? await redis() : redis ?? (await defaultRedis());
    const { keys, members } = featureKeysOfActor(scope, kind, hash, nowMs);
    const pipe = client.pipeline();
    for (const key of keys) pipe.del(key);
    for (const [key, member] of members) pipe.srem(key, member);
    pipe.set(erasedMarkKey(actorPart(scope, kind, hash)), '1', 'EX', ERASED_MARK_SECONDS);
    const replies = await pipe.exec();
    return Array.isArray(replies) && replies.every(([err]) => !err);
  } catch {
    return false;
  }
}
