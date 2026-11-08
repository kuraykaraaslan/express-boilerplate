import type { Namespace, Socket } from 'socket.io';
import type { RealtimeEmitTarget, RealtimeNamespace } from '@kuraykaraaslan-labs/websocket/server/websocket.types';
import { getTelemetryBackend } from './telemetry.config';
import {
  TAIL_CHANNEL, TAIL_EVENTS, TAIL_LIMITS, TAIL_NAMESPACE_PATH, TailBridgeEventSchema, TailTicketPayloadSchema, tailRoom,
  type TailBridgeEvent, type TailTicketPayload,
} from './telemetry.tail.realtime';
import { tailTicketService } from './telemetry.tail.ticket';
import { TailSession } from './telemetry.tail.session';

/**
 * The `/telemetry-tail` realtime namespace, contributed into `websocket:namespace`. Loaded ONLY by the standalone gateway process.
 *
 * Who may tail what is decided in Next, before the socket exists: `POST /api/telemetry/tail-ticket` runs the session guard for
 * `observability.telemetry.read` on the URL workspace and mints ONE single-use ticket whose payload is `{ tenantId, userId, session }`.
 * The tenant of every poll is that payload's `tenantId`; `tail:start` carries a FILTER only, validated with the REST log query's own
 * strict schema, so `{ tenantId: ... }` (or any unknown key, or a filter aimed at a tenant field) is refused and never read.
 * There is no client `join`; the only room is the tenant's own, built here, and only to end tails when the tenant's data is erased.
 *
 * What bounds it: the gateway enforces connections per tenant and per user (cluster-wide), frames per minute and the lagging-socket guard;
 * `TailSession` enforces poll size, lines per session, session time, backoff and backpressure (see `telemetry.tail.session.ts`). A socket
 * is closed after `maxSessionSeconds` with `server:reauth`, so a revoked permission stops the stream within that bound; a revoked session
 * or a removed member is dropped at once by the websocket module's control channel (the ticket carries the session binding).
 *
 * The backend is read from THIS process's configuration (`getTelemetryBackend`). With `TELEMETRY_BACKEND=memory` the gateway has its own
 * empty store, so a tail is only meaningful against the reference backend (Loki); the memory backend serves tests and single-process dev.
 */
/** Open sessions on this node, per tenant: erasure ends them and the tests count them. */
const sessions = new Map<string, Set<TailSession>>();
export const openTailSessions = (tenantId: string): number => sessions.get(tenantId)?.size ?? 0;

function register(tenantId: string, s: TailSession): () => void {
  let set = sessions.get(tenantId);
  if (!set) { set = new Set(); sessions.set(tenantId, set); }
  set.add(s);
  return () => { set!.delete(s); if (set!.size === 0) sessions.delete(tenantId); };
}

/** Engine-level write buffer of a socket: anything queued means the client has not drained the last batch. */
function busy(socket: Socket): boolean {
  const conn = socket.conn as unknown as { writeBuffer?: unknown[]; transport?: { writable?: boolean } } | undefined;
  if (!conn) return false;
  return (conn.writeBuffer?.length ?? 0) > 0 || conn.transport?.writable === false;
}

function onConnection(_ns: Namespace, socket: Socket, identity: TailTicketPayload): void {
  void socket.join(tailRoom(identity.tenantId));
  const session = new TailSession({
    tenantId: identity.tenantId,
    backend: getTelemetryBackend,
    emit: (event, payload) => { socket.emit(event, payload); },
    isBusy: () => busy(socket),
  });
  const unregister = register(identity.tenantId, session);

  socket.on(TAIL_EVENTS.START, (payload: unknown) => {
    // The payload is `{ filter }` and nothing else; a client cannot name a tenant, a room or a limit. The shape is strict.
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    if (!body || Object.keys(body).some((k) => k !== 'filter')) {
      socket.emit(TAIL_EVENTS.ERROR, { code: 'invalid_filter', message: 'tail:start takes { filter } only' });
      return;
    }
    session.start(body.filter);
  });
  socket.on(TAIL_EVENTS.STOP, () => { session.stop(); });

  const timer = setTimeout(() => {
    session.dispose();
    socket.emit('server:reauth');
    socket.disconnect(true);
  }, TAIL_LIMITS.maxSessionSeconds * 1000);
  timer.unref?.();
  socket.on('disconnect', () => { clearTimeout(timer); session.dispose(); unregister(); });
}

function parseEvent(raw: string): TailBridgeEvent | null {
  try {
    const r = TailBridgeEventSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The tenant's data was erased: every tail of that tenant on this node ends with the reason, and the room hears it too. */
function dispatch(target: RealtimeEmitTarget, event: TailBridgeEvent): void {
  for (const s of [...(sessions.get(event.tenantId) ?? [])]) s.end(event.reason);
  target.to(tailRoom(event.tenantId)).emit(TAIL_EVENTS.END, { reason: event.reason });
}

const telemetryTailNamespace: RealtimeNamespace<TailTicketPayload, TailBridgeEvent> = {
  path: TAIL_NAMESPACE_PATH,
  channel: TAIL_CHANNEL,
  authenticate: async (ticket) => {
    const parsed = TailTicketPayloadSchema.safeParse(await tailTicketService.consume(ticket));
    return parsed.success ? parsed.data : null;
  },
  onConnection,
  parseEvent,
  dispatch,
  // a socket whose write buffer stays above 2 MB for two checks is closed (`server:lagging`); the client reconnects and re-tails
  delivery: { maxBufferedBytes: 2_000_000 },
  limits: {
    maxConnectionsPerTenant: TAIL_LIMITS.maxConnectionsPerTenant,
    maxConnectionsPerUser: TAIL_LIMITS.maxConnectionsPerUser,
    maxRoomsPerSocket: TAIL_LIMITS.maxRoomsPerSocket, // the tenant's own room is the only one (the socket's own id room is not counted)
    inboundEventsPerMinute: TAIL_LIMITS.inboundEventsPerMinute,
  },
};

export default telemetryTailNamespace;
