import type { Namespace, Socket } from 'socket.io'
import type { RealtimeEmitTarget, RealtimeNamespace } from '@kuraykaraaslan-labs/websocket/server/websocket.types'
import { liveTicketService } from './live.ticket.service'
import {
  LIVE_CHANNEL, LIVE_NAMESPACE_PATH, LiveEnvelopeSchema, LiveTicketPayloadSchema, DEFAULT_MAX_SESSION_SECONDS, MAX_TICKET_TOPICS,
  liveRoom, type LiveEnvelope, type LiveTicketPayload,
} from './live.types'

/**
 * The `/dashboard` realtime namespace, contributed into `websocket:namespace`.
 * Loaded ONLY by the gateway process, never by Next.
 *
 * Authorisation lives in Next: the ticket's payload is the topic list the
 * live-ticket route already authorised (the same three gates as a normal query).
 * The socket joins exactly those rooms on connect. There is NO client
 * `subscribe` event — a client cannot ask for a topic it was not given, and a
 * forged ticket does not exist (single-use, server-minted, Redis-held).
 *
 * Re-authorisation: every socket is closed after `maxSessionSeconds` with
 * `server:reauth`, and the client mints a new ticket — which re-runs the gates.
 * A revoked permission therefore stops deltas within that bound (default 15 min).
 *
 * The socket stays (docs/phases/07-dashboard/40 D40-4, D40-5): the namespace declares `replace`, so a client whose
 * registrations change (a page switch) presents a fresh ticket on its open socket (`ticket:replace`, the gateway's
 * `websocket.ticket-replace.ts`), and does the same about a minute before the deadline. The gateway judges that ticket
 * exactly as a handshake's and swaps the socket's rooms to exactly its topics; a granted replace restarts the deadline
 * here, so the deadline only closes sockets that did not re-authorise. Topics still come from a ticket alone.
 */

/** Gateway coalescing window: a topic emitting faster than this is delivered latest-wins. */
export const LIVE_COALESCE_MS = 250
export const LIVE_MAX_CONNECTIONS_PER_USER = 10
/**
 * Inbound events one socket may send per minute. The only one it handles is the gateway's `ticket:replace`, which has its
 * own cap of `LIVE_REPLACES_PER_MINUTE`; this bounds everything else a client sends (the siege's inbound-rate control).
 */
export const LIVE_INBOUND_EVENTS_PER_MINUTE = 30
/** `ticket:replace` per socket and minute: a page switch costs one, the re-authorisation one every 14 minutes. */
export const LIVE_REPLACES_PER_MINUTE = 10

/**
 * The coalescing key of an event (15.5d). Latest-wins per TOPIC dropped rows: two
 * deltas on one topic carrying different rows are not the same fact, and only the
 * last was delivered. A rows delta is keyed by its row identities (`id`, `key`
 * or `pk`; the whole row when it has none), so the newest delta for the SAME rows
 * wins and a delta for other rows is delivered as well. Scalars, series and
 * records stay latest-wins per topic.
 */
export function liveCoalesceKey(event: LiveEnvelope): string {
  const rows = event.delta.rows
  if (!rows || rows.length === 0) return event.topic
  const ids = rows.map((r) => {
    const id = r.id ?? r.key ?? r.pk
    return id !== undefined && id !== null ? String(id) : JSON.stringify(r)
  })
  return `${event.topic}#${[...ids].sort().join('|')}`
}

const MAX_SESSION_MS = DEFAULT_MAX_SESSION_SECONDS * 1000

function parseEvent(raw: string): LiveEnvelope | null {
  try {
    return LiveEnvelopeSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Fan a delta into the topic's room (local emit — every node receives the Redis event). */
function dispatch(target: RealtimeEmitTarget, event: LiveEnvelope): void {
  target.to(liveRoom(event.tenantId, event.topic)).emit('delta', { topic: event.topic, delta: event.delta })
}

/** The rooms a ticket's socket belongs in: one per topic, under the ticket's tenant, at most MAX_TICKET_TOPICS. */
export function liveRooms(identity: Pick<LiveTicketPayload, 'tenantId' | 'topics'>): string[] {
  return identity.topics.slice(0, MAX_TICKET_TOPICS).map((topic) => liveRoom(identity.tenantId, topic))
}

/** Each open socket's re-authorisation deadline, restarted by a granted replace (D40-5). */
const deadlines = new WeakMap<Socket, () => void>()

function onConnection(_ns: Namespace, socket: Socket, identity: LiveTicketPayload): void {
  for (const room of liveRooms(identity)) void socket.join(room)
  let timer: ReturnType<typeof setTimeout> | null = null
  const restart = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      socket.emit('server:reauth')
      socket.disconnect(true)
    }, MAX_SESSION_MS)
    timer.unref?.()
  }
  restart()
  deadlines.set(socket, restart)
  socket.on('disconnect', () => {
    if (timer) clearTimeout(timer)
    deadlines.delete(socket)
  })
}

const dashboardNamespace: RealtimeNamespace<LiveTicketPayload, LiveEnvelope> = {
  path: LIVE_NAMESPACE_PATH,
  channel: LIVE_CHANNEL,
  authenticate: async (ticket) => {
    const parsed = LiveTicketPayloadSchema.safeParse(await liveTicketService.consume(ticket))
    return parsed.success ? parsed.data : null
  },
  onConnection,
  parseEvent,
  dispatch,
  // Gateway-enforced (docs/phases/13-websocket/02): latest-wins per topic (per row set for a rows delta) every 250 ms, and caps that
  // match the ticket route's own ceiling (MAX_TICKET_TOPICS rooms, a handful of tabs per user).
  delivery: { coalesceMs: LIVE_COALESCE_MS, keyOf: liveCoalesceKey },
  limits: {
    maxConnectionsPerUser: LIVE_MAX_CONNECTIONS_PER_USER, maxRoomsPerSocket: MAX_TICKET_TOPICS, inboundEventsPerMinute: LIVE_INBOUND_EVENTS_PER_MINUTE,
  },
  // D40-4 / D40-5: a fresh ticket on the open socket; its rooms are the ticket's topics, as on connect.
  replace: {
    rooms: liveRooms,
    onReplaced: (socket) => { deadlines.get(socket)?.() },
    perMinute: LIVE_REPLACES_PER_MINUTE,
  },
}

export default dashboardNamespace
