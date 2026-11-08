import type { Socket } from 'socket.io';
import Logger from '@kuraykaraaslan-labs/logger';
import type { RealtimeLimits } from './websocket.types';

/**
 * Per-namespace limits, declared on the descriptor and enforced here
 * (docs/phases/13-websocket/02 §2.3). Value-free of `socket.io`: sockets are typed only.
 *
 * Deviation from the phase text: the inbound rate limit is an in-process sliding window,
 * not the `limiter` module's Redis primitive. A socket lives on exactly one node, so a
 * local window is exact, and `limiter` pulls `observability` and `tenant_usage`, which
 * the gateway must never import (OD-12).
 */

/** The slice of an ioredis client the connection counter uses. */
export interface CounterRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: string | number, max: string | number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export type ConnectionRefusal = 'tenant_limit' | 'user_limit';

/** Seconds a socket's slot survives without a refresh: a crashed node's counts expire with it. */
export const CONNECTION_SLOT_TTL_SECONDS = 90;
/** How often a live node re-stamps its slots; a third of the TTL. */
export const CONNECTION_REFRESH_MS = (CONNECTION_SLOT_TTL_SECONDS / 3) * 1000;

export interface ConnectionTracker {
  /** Count the socket in; returns the refusal reason when a cap is exceeded (the slot is then released). */
  acquire(path: string, socketId: string, identity: unknown, limits: RealtimeLimits): Promise<ConnectionRefusal | null>;
  release(socketId: string): Promise<void>;
  /** Re-stamp every local slot so it outlives the TTL. */
  refresh(): Promise<void>;
}

function idOf(identity: unknown, field: 'tenantId' | 'userId'): string | null {
  const value = (identity as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Cluster-wide connection counts in Redis: one sorted set per namespace + tenant/user, members
 * `<nodeId>:<socketId>` scored by their expiry time. Admission is add-then-count, so two
 * simultaneous handshakes can both be refused near the cap but never both admitted over it.
 *
 * When Redis is unreachable it falls back to this node's own count (risk register websocket.01): a counter outage must
 * not take realtime down, but it no longer lifts the cap either. The cap then holds per node, not cluster-wide, until
 * Redis answers again; sockets admitted during the outage are held like the others, so `refresh` stamps them back into
 * Redis and the cluster count converges.
 */
export function createConnectionTracker(redis: CounterRedis, nodeId: string, now: () => number = Date.now): ConnectionTracker {
  const held = new Map<string, string[]>(); // socketId -> keys
  const local = new Map<string, Set<string>>(); // key -> this node's socketIds in it
  const memberOf = (socketId: string): string => `${nodeId}:${socketId}`;
  const hold = (socketId: string, keys: string[]) => {
    held.set(socketId, keys);
    for (const key of keys) { let set = local.get(key); if (!set) local.set(key, (set = new Set())); set.add(socketId); }
  };

  return {
    async acquire(path, socketId, identity, limits) {
      const scopes: Array<{ key: string; max: number; reason: ConnectionRefusal }> = [];
      const tenantId = idOf(identity, 'tenantId');
      const userId = idOf(identity, 'userId');
      if (limits.maxConnectionsPerTenant != null && tenantId) {
        scopes.push({ key: `ws:conn:${path}:t:${tenantId}`, max: limits.maxConnectionsPerTenant, reason: 'tenant_limit' });
      }
      if (limits.maxConnectionsPerUser != null && userId) {
        scopes.push({ key: `ws:conn:${path}:u:${userId}`, max: limits.maxConnectionsPerUser, reason: 'user_limit' });
      }
      if (scopes.length === 0) return null;

      const member = memberOf(socketId);
      const added: string[] = [];
      try {
        for (const scope of scopes) {
          await redis.zremrangebyscore(scope.key, '-inf', now());
          await redis.zadd(scope.key, now() + CONNECTION_SLOT_TTL_SECONDS * 1000, member);
          added.push(scope.key);
          if ((await redis.zcard(scope.key)) > scope.max) {
            await Promise.all(added.map((key) => redis.zrem(key, member)));
            return scope.reason;
          }
          await redis.expire(scope.key, CONNECTION_SLOT_TTL_SECONDS * 2);
        }
      } catch (err) {
        Logger.warn(`[websocket] connection counter unavailable, capping on this node's own count: ${err instanceof Error ? err.message : String(err)}`);
        await Promise.all(added.map((key) => redis.zrem(key, member).catch(() => { /* the slot TTL heals it */ })));
        for (const scope of scopes) {
          if ((local.get(scope.key)?.size ?? 0) + 1 > scope.max) return scope.reason;
        }
        hold(socketId, scopes.map((scope) => scope.key));
        return null;
      }
      hold(socketId, added);
      return null;
    },

    async release(socketId) {
      const keys = held.get(socketId);
      if (!keys) return;
      held.delete(socketId);
      for (const key of keys) { const set = local.get(key); set?.delete(socketId); if (set && set.size === 0) local.delete(key); }
      await Promise.all(keys.map((key) => redis.zrem(key, memberOf(socketId)))).catch(() => { /* the slot TTL heals it */ });
    },

    async refresh() {
      const expiresAt = now() + CONNECTION_SLOT_TTL_SECONDS * 1000;
      for (const [socketId, keys] of held) {
        for (const key of keys) {
          await redis.zadd(key, expiresAt, memberOf(socketId)).catch(() => { /* retried next tick */ });
          await redis.expire(key, CONNECTION_SLOT_TTL_SECONDS * 2).catch(() => { /* idem */ });
        }
      }
    },
  };
}

/**
 * Make `socket.join` ignore rooms beyond `max` (the socket's own id room excluded).
 * Wrapping the method means descriptors keep calling `socket.join` and cannot bypass the cap.
 * `onRefused` receives how many rooms were turned away.
 */
export function capRoomsPerSocket(socket: Socket, max: number, onRefused: (count: number) => void): void {
  const join = socket.join.bind(socket);
  (socket as { join: Socket['join'] }).join = (rooms) => {
    const list = Array.isArray(rooms) ? rooms : [rooms];
    const joined = new Set(socket.rooms);
    const fresh = [...new Set(list)].filter((room) => !joined.has(room));
    const free = Math.max(0, max - (joined.size - 1)); // `rooms` holds the own-id room too
    const allowed = fresh.slice(0, free);
    if (fresh.length > allowed.length) onRefused(fresh.length - allowed.length);
    return allowed.length > 0 ? join(allowed) : undefined;
  };
}

/**
 * Sliding-window inbound rate limit per socket. Over the cap an event is dropped (its
 * handler never runs) and the client is told once per drop with `server:rate_limited`.
 */
export function limitInboundEvents(
  socket: Socket,
  perMinute: number,
  onDropped: () => void,
  now: () => number = Date.now,
): void {
  const stamps: number[] = [];
  socket.use((packet, next) => {
    const t = now();
    while (stamps.length > 0 && stamps[0] <= t - 60_000) stamps.shift();
    if (stamps.length >= perMinute) {
      onDropped();
      socket.emit('server:rate_limited', { event: String(packet[0]) });
      return; // never calling `next` drops the packet
    }
    stamps.push(t);
    next();
  });
}
