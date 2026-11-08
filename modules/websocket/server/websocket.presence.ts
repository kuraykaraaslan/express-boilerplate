import redis, { tenantKey } from '@kuraykaraaslan-labs/redis';

/**
 * Generic ephemeral presence + marker (e.g. typing) state, stored only in Redis
 * (never persisted). Presence is a per-user TTL key refreshed by a heartbeat; a
 * user is "online" while the key exists. Markers are even shorter self-expiring
 * keys so a dropped "stop" event heals on its own.
 *
 * Redis-only: no `socket.io` import here. Keys are built with the caller's
 * namespace prefix via `tenantKey(tenantId, nsKey, ...segments)`, so a consumer
 * reproduces its exact historical key shape (e.g. `t:<t>:msg:presence:<u>`).
 */

export interface PresenceOptions {
  /** Presence key TTL in seconds (refreshed by the heartbeat). */
  presenceTtl: number;
  /** Default marker TTL in seconds (e.g. typing). */
  markerTtl: number;
}

export function createPresence(nsKey: string, opts: PresenceOptions) {
  const presenceKey = (tenantId: string, userId: string): string =>
    tenantKey(tenantId, nsKey, 'presence', userId);

  const markerKey = (tenantId: string, kind: string, segments: string[]): string =>
    tenantKey(tenantId, nsKey, kind, ...segments);

  /** Mark a user online (called on connect and on each heartbeat). */
  async function touchPresence(tenantId: string, userId: string): Promise<void> {
    try {
      await redis.set(presenceKey(tenantId, userId), Date.now().toString(), 'EX', opts.presenceTtl);
    } catch {
      /* best-effort */
    }
  }

  /** Clear presence on disconnect (last device). */
  async function clearPresence(tenantId: string, userId: string): Promise<void> {
    try {
      await redis.del(presenceKey(tenantId, userId));
    } catch {
      /* best-effort */
    }
  }

  /** Bulk presence lookup for a set of users. */
  async function arePresent(tenantId: string, userIds: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    if (userIds.length === 0) return out;
    try {
      const vals = await redis.mget(...userIds.map((u) => presenceKey(tenantId, u)));
      userIds.forEach((u, i) => {
        out[u] = vals[i] != null;
      });
    } catch {
      userIds.forEach((u) => {
        out[u] = false;
      });
    }
    return out;
  }

  /** Record a short-lived marker (self-heals if the matching "stop" is lost). */
  async function setMarker(
    tenantId: string,
    kind: string,
    segments: string[],
    ttl: number = opts.markerTtl,
  ): Promise<void> {
    try {
      await redis.set(markerKey(tenantId, kind, segments), '1', 'EX', ttl);
    } catch {
      /* best-effort */
    }
  }

  async function clearMarker(tenantId: string, kind: string, segments: string[]): Promise<void> {
    try {
      await redis.del(markerKey(tenantId, kind, segments));
    } catch {
      /* best-effort */
    }
  }

  return { touchPresence, clearPresence, arePresent, setMarker, clearMarker };
}

export type Presence = ReturnType<typeof createPresence>;
