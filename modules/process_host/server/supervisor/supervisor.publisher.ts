import redis from '@kuraykaraaslan-labs/redis/server/redis.service';
import Logger from '@kuraykaraaslan-labs/logger';
import type { SignalSample, SupervisorEvent, SupervisorStateV1 } from './supervisor.types';

/**
 * The supervisor's state and decision log in Redis (07 "Observability", D4), next to the process registry.
 *
 * | Key | Type | Content |
 * |---|---|---|
 * | `proc:sup:<kind>:<nodeId>` | string, TTL 15 s | `SupervisorStateV1` JSON, rewritten every 5 s |
 * | `proc:sup:events:<kind>:<nodeId>` | list, newest first, last 200, TTL 24 h | `SupervisorEvent` JSON |
 * | `proc:sup:signal:<kind>:<nodeId>` | list, newest first, last 720 (1 h at 5 s), TTL 1 h | `SignalSample` JSON, one per sample |
 *
 * The supervisor also announces itself in `proc:nodes:<kind>` (through `startProcessHost`) with the same `nodeId` and
 * `info.role = 'supervisor'`, so a reader finds the supervisors of a kind from the registry without a key scan.
 * Writes are best-effort: a supervisor that cannot reach Redis keeps scaling.
 */

export const SUP_STATE_TTL_SECONDS = 15;
export const SUP_EVENTS_MAX = 200;
export const SUP_EVENTS_TTL_SECONDS = 24 * 60 * 60;

export const SUP_SIGNAL_MAX = 720;
export const SUP_SIGNAL_TTL_SECONDS = 60 * 60;

export const supStateKey = (kind: string, nodeId: string): string => `proc:sup:${kind}:${nodeId}`;
export const supEventsKey = (kind: string, nodeId: string): string => `proc:sup:events:${kind}:${nodeId}`;
export const supSignalKey = (kind: string, nodeId: string): string => `proc:sup:signal:${kind}:${nodeId}`;

/** The Redis calls the publisher uses (ioredis-compatible). */
export interface SupervisorRedis {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del(key: string): Promise<unknown>;
}

export interface SupervisorPublisher {
  state(state: SupervisorStateV1): Promise<void>;
  event(kind: string, nodeId: string, event: SupervisorEvent): Promise<void>;
  /** One smoothed-signal sample for the last-hour history (optional so a test publisher may leave it out). */
  signal?(kind: string, nodeId: string, sample: SignalSample): Promise<void>;
  clear(kind: string, nodeId: string): Promise<void>;
}

export function redisSupervisorPublisher(client: SupervisorRedis = redis as unknown as SupervisorRedis): SupervisorPublisher {
  let warned = false;
  const warn = (error: unknown) => {
    if (warned) return;
    warned = true;
    Logger.warn(`[process_host] supervisor state not published: ${error instanceof Error ? error.message : String(error)}`);
  };
  return {
    async state(state) {
      try {
        await client.set(supStateKey(state.kind, state.nodeId), JSON.stringify(state), 'EX', SUP_STATE_TTL_SECONDS);
        warned = false;
      } catch (e) { warn(e); }
    },
    async event(kind, nodeId, event) {
      const key = supEventsKey(kind, nodeId);
      try {
        await client.lpush(key, JSON.stringify(event));
        await client.ltrim(key, 0, SUP_EVENTS_MAX - 1);
        await client.expire(key, SUP_EVENTS_TTL_SECONDS);
      } catch (e) { warn(e); }
    },
    async signal(kind, nodeId, sample) {
      const key = supSignalKey(kind, nodeId);
      try {
        await client.lpush(key, JSON.stringify(sample));
        await client.ltrim(key, 0, SUP_SIGNAL_MAX - 1);
        await client.expire(key, SUP_SIGNAL_TTL_SECONDS);
      } catch (e) { warn(e); }
    },
    async clear(kind, nodeId) {
      // the state key goes at once (the supervisor is stopping); the decision log stays for its 24 h
      try { await client.del(supStateKey(kind, nodeId)); } catch { /* TTL */ }
    },
  };
}

/** Reads one supervisor's state; null when absent or unreadable. */
export async function readSupervisorState(kind: string, nodeId: string, client: SupervisorRedis = redis as unknown as SupervisorRedis): Promise<SupervisorStateV1 | null> {
  const raw = await client.get(supStateKey(kind, nodeId));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SupervisorStateV1;
    return s.v === 1 ? s : null;
  } catch {
    return null;
  }
}

/** Reads a supervisor's decision log, newest first. */
export async function readSupervisorEvents(kind: string, nodeId: string, limit = SUP_EVENTS_MAX, client: SupervisorRedis = redis as unknown as SupervisorRedis): Promise<SupervisorEvent[]> {
  const raw = await client.lrange(supEventsKey(kind, nodeId), 0, Math.max(0, limit - 1));
  const out: SupervisorEvent[] = [];
  for (const r of raw) {
    try { out.push(JSON.parse(r) as SupervisorEvent); } catch { /* torn */ }
  }
  return out;
}

/** Reads a supervisor's signal history, OLDEST first (ready to plot), optionally only samples at or after `sinceTs`. */
export async function readSupervisorSignal(kind: string, nodeId: string, sinceTs = 0, client: SupervisorRedis = redis as unknown as SupervisorRedis): Promise<SignalSample[]> {
  const raw = await client.lrange(supSignalKey(kind, nodeId), 0, SUP_SIGNAL_MAX - 1);
  const out: SignalSample[] = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    try {
      const s = JSON.parse(raw[i]) as SignalSample;
      if (typeof s.ts === 'number' && s.ts >= sinceTs) out.push({ ts: s.ts, value: typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : null });
    } catch { /* torn */ }
  }
  return out;
}
