import type { Namespace, Socket } from 'socket.io'
import type { RealtimeEmitTarget, RealtimeNamespace } from '@kuraykaraaslan-labs/websocket/server/websocket.types'
import redis from '@kuraykaraaslan-labs/redis/server/redis.service'
import {
  STATUS_CHANNEL, STATUS_EVENTS, StatusEventSchema, statusRoom, type StatusEvent,
} from './status.realtime'

/**
 * observability's `/status` realtime namespace, contributed into
 * `websocket:namespace`. Loaded ONLY by the standalone WS gateway (never by
 * Next), so the socket.io types are safe here.
 *
 * ANONYMOUS by design: the status page works without a session (that is its
 * point — customers check it when everything else is broken), so
 * `authenticate` accepts every handshake instead of consuming a ticket.
 * Isolation comes from the room names: a socket may only join
 * `t:<tenantId>:status:public` rooms, whose events are the already-sanitized
 * "changed, refetch" signals — there is nothing tenant-secret to overhear.
 *
 * The abuse guard for an anonymous namespace is the connection rate limit
 * below (fixed window per IP, straight on Redis — the `limiter` module is not
 * imported because it imports observability back).
 */

const CONN_WINDOW_SECONDS = 60
const CONN_LIMIT_PER_IP = 30
/** Status rooms one anonymous socket may join, and `status:join` events it may send per minute. */
export const STATUS_MAX_ROOMS_PER_SOCKET = 10
export const STATUS_INBOUND_PER_MINUTE = 60

/** Anonymous viewer identity — no user, no tenant until a room is joined. */
export interface StatusViewerIdentity {
  anonymous: true
}

async function allowConnection(ip: string): Promise<boolean> {
  try {
    const key = `rl:status:conn:${ip}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, CONN_WINDOW_SECONDS)
    return count <= CONN_LIMIT_PER_IP
  } catch {
    // Redis blip: fail open — the page is public data and read-only.
    return true
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const statusNamespace: RealtimeNamespace<StatusViewerIdentity, StatusEvent> = {
  path: '/status',
  channel: STATUS_CHANNEL,

  // No ticket: every handshake yields the same anonymous identity.
  authenticate: async () => ({ anonymous: true }),

  // The per-IP window is asked BEFORE admission, so the 31st handshake in a minute is refused (`limit_exceeded`, scope
  // `ip`) instead of admitted and then dropped (risk register websocket.16).
  admitAddress: (address: string) => allowConnection(address || 'unknown'),

  // A viewer watches a status page or a few; one socket subscribed to every tenant's room would be a free scraper of
  // which tenants exist and when they have incidents (websocket.16). The inbound limit bounds `status:join` itself.
  limits: { maxRoomsPerSocket: STATUS_MAX_ROOMS_PER_SOCKET, inboundEventsPerMinute: STATUS_INBOUND_PER_MINUTE },

  onConnection: (_ns: Namespace, socket: Socket) => {

    // The client asks for one tenant's public room; the shape is validated and
    // the room name is BUILT here — a socket can never name an arbitrary room.
    socket.on('status:join', (payload: unknown) => {
      const tenantId = (payload as { tenantId?: unknown })?.tenantId
      if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) return
      void socket.join(statusRoom(tenantId))
    })
  },

  parseEvent: (raw: string) => {
    try {
      return StatusEventSchema.parse(JSON.parse(raw))
    } catch {
      return null
    }
  },

  dispatch: (ns: RealtimeEmitTarget, event: StatusEvent) => {
    ns.to(statusRoom(event.tenantId)).emit(STATUS_EVENTS.CHANGED, { at: event.at })
  },
}

export default statusNamespace
