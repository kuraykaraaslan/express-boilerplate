import { z } from 'zod';
import { publishToChannel } from './websocket.pubsub';

/**
 * Gateway CONTROL channel — the one channel that is about sockets themselves rather than about
 * a domain's events.
 *
 * Authentication happens once, at the handshake, so nothing else ends a socket whose owner has
 * since lost the right to it: a revoked session, a removed or suspended member, a deleted
 * account, a suspended tenant. The HTTP process, which learns of those, publishes here and every gateway node drops
 * its own matching sockets. Like the rest of the bridge it imports only the socket.io-free
 * `websocket.pubsub`, so it is safe to reach from the Next process.
 */
export const WS_CONTROL_CHANNEL = 'ws:control';

/**
 * 2026-11-03 (docs/audits/2026-11-03-redis-outage.md, D247): the control orders travel on a Redis STREAM, read like `iot:kicks`:
 * every gateway node reads every entry from the last one it handled (`websocket.control-stream.ts`), so a node that was reconnecting
 * misses nothing, and a gap (Redis lost its data) makes it re-ticket every socket. The producers (`websocket_session`) write each order
 * through the `session_end` outbox, so an order Redis refused is relayed once it is back. Each entry carries one field, the event's
 * JSON with the outbox order id as `oid`. The pub/sub channel above is still read for one release (an older HTTP process publishes
 * there), never written by this build.
 */
export const WS_CONTROL_STREAM = 'ws:control:stream';
export const WS_CONTROL_STREAM_MAXLEN = 100_000;
export const WS_CONTROL_FIELD = 'e';

export const WsControlEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('disconnect_user'),
    userId: z.string().min(1),
    /** Omitted = every tenant. Sockets whose identity carries no tenant are matched on the user alone. */
    tenantId: z.string().min(1).optional(),
    /**
     * Only the sockets opened under this session. A socket whose identity carries no session id
     * (a ticket minted without one) cannot be told apart, so it is dropped too: failing closed.
     */
    userSessionId: z.string().min(1).optional(),
  }),
  z.object({
    /**
     * Every socket of the tenant, on every node and in every namespace, whoever opened it: the tenant was suspended, or its
     * deletion began (risk register websocket.09; docs/phases/02-fleet/05 section 7 stage 7). Sockets whose identity carries no
     * tenant (an anonymous namespace such as `/status`) are not matched: nothing ties them to the tenant.
     */
    kind: z.literal('disconnect_tenant'),
    tenantId: z.string().min(1),
  }),
]);
export type WsControlEvent = z.infer<typeof WsControlEventSchema>;

/** Safely parse a raw Redis payload; malformed or unknown events are ignored. */
export function parseControlEvent(raw: string): WsControlEvent | null {
  try {
    const parsed = WsControlEventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A control stream entry's fields (`[field, value, …]`): the event and its outbox order id, or null when it carries no event. */
export function parseControlEntry(fields: readonly unknown[]): { event: WsControlEvent; orderId?: string } | null {
  if (!Array.isArray(fields)) return null;
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] !== WS_CONTROL_FIELD) continue;
    const raw = fields[i + 1];
    if (typeof raw !== 'string' || raw.length > 4_096) return null;
    const event = parseControlEvent(raw);
    if (!event) return null;
    let oid: unknown;
    try { oid = (JSON.parse(raw) as { oid?: unknown }).oid; } catch { oid = undefined; }
    return typeof oid === 'string' && UUID.test(oid) ? { event, orderId: oid } : { event };
  }
  return null;
}

/**
 * Ask every gateway node to drop every socket of a tenant, over the legacy pub/sub channel. Best-effort, NOT durable: the producers of
 * this build write the control stream through the `session_end` outbox (`websocket_session.orders.ts`); kept for tools and tests.
 */
export function publishDisconnectTenant(tenantId: string): Promise<void> {
  return publishToChannel(WS_CONTROL_CHANNEL, { kind: 'disconnect_tenant', tenantId } satisfies WsControlEvent);
}

/** Ask every gateway node to drop this user's sockets (optionally in one tenant, optionally one session), over the legacy channel. Best-effort, not durable. */
export function publishDisconnectUser(target: { userId: string; tenantId?: string; userSessionId?: string }): Promise<void> {
  return publishToChannel(WS_CONTROL_CHANNEL, { kind: 'disconnect_user', ...target } satisfies WsControlEvent);
}
