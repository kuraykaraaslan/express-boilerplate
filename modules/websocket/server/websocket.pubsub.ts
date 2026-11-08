import redis from '@kuraykaraaslan-labs/redis/server/redis.service';

/**
 * Cross-process realtime bridge — the publish side.
 *
 * CRITICAL: this file may import ONLY `@kuraykaraaslan-labs/redis/server/redis.service`
 * (not the `@kuraykaraaslan-labs/redis` barrel — that also re-exports `redis.bullmq`,
 * which pulls in `bullmq` and `node:async_hooks` and breaks the client bundle
 * when this file is reached from a 'use client' chain, e.g. the page editor's
 * collab hook). It is imported by the Next.js HTTP process (via each domain's
 * realtime contract, e.g. `messaging.realtime`), which must NEVER transitively
 * load `socket.io`. Do not import the gateway, the auth middleware, `socket.io`,
 * or the websocket module's own barrel here.
 *
 * The HTTP process has no Socket.IO server, so it hands persisted events to the
 * standalone WS gateway over a Redis pub/sub channel; the gateway's subscriber
 * routes each payload into the right namespace + rooms.
 */

/** Publish a realtime event for the WS gateway to fan out. Best-effort. */
export async function publishToChannel(channel: string, payload: unknown): Promise<void> {
  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch {
    // Swallow — realtime is best-effort; the triggering write is already durable.
  }
}

/** Conventional tenant-scoped room name: `t:<tenantId>:<kind>:<id>`. */
export const tenantEntityRoom = (tenantId: string, kind: string, id: string): string =>
  `t:${tenantId}:${kind}:${id}`;
