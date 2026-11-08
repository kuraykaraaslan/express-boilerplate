import type { Namespace, Socket } from 'socket.io';

/**
 * Generic realtime transport contracts. Type-only on purpose — this file must
 * never pull `socket.io` (or anything else) into a value import, so the Next.js
 * HTTP process can reference these types without loading the WS runtime.
 *
 * A consumer module (e.g. `messaging`) describes its realtime surface as a
 * `RealtimeNamespace` descriptor and contributes it into the `websocket:namespace`
 * extension point. The standalone gateway discovers descriptors at boot and wires
 * each onto its own Socket.IO namespace — the gateway never imports the consumer.
 */

/** Minimal identity every authenticated socket carries in `socket.data.identity`. */
export interface WsIdentity {
  userId: string;
  tenantId: string;
  /** Session the handshake ticket was minted under, when the minting route knew it; lets a revocation drop one device. */
  userSessionId?: string;
  /** Epoch ms the session expires; the gateway closes the socket then with `server:reauth` (phase 04 §4.5). Optional. */
  sessionExpiresAt?: number;
}

/**
 * One domain's realtime namespace. `Id` is the identity the domain resolves from
 * its handshake ticket; `Evt` is the domain's validated pub/sub event payload.
 */
export interface RealtimeNamespace<Id = WsIdentity, Evt = unknown> {
  /** Socket.IO namespace path the browser connects to, e.g. `/messaging`. */
  path: string;
  /** Redis pub/sub channel this namespace subscribes to for cross-process fan-out. */
  channel: string;
  /**
   * Resolve a handshake ticket to a domain identity, or null to reject the
   * connection. Self-contained: the domain owns its ticket store.
   */
  authenticate(ticket: string): Promise<Id | null>;
  /**
   * Optional: may a handshake from this address go on at all? Asked before `authenticate`, so a refused address costs no
   * ticket lookup; false (or a throw) refuses with `limit_exceeded`, scope `ip`. For a namespace with its own per-address
   * rule, e.g. `/status`'s connection window. The address is the one the gateway sees (`WS_TRUSTED_PROXIES`, O25-5).
   */
  admitAddress?(address: string): Promise<boolean>;
  /**
   * Called once per accepted connection. The identity is already bound to
   * `socket.data.identity`; wire per-socket rooms + event handlers here.
   */
  onConnection(ns: Namespace, socket: Socket, identity: Id): void;
  /** Parse a raw Redis message into a validated event, or null to drop it. */
  parseEvent(raw: string): Evt | null;
  /**
   * Fan a validated bridge event into the namespace's rooms.
   *
   * `target` reaches only the sockets connected to THIS gateway node: every node
   * receives the Redis event, so going through the cluster adapter here would
   * deliver it once per node. Use `target.to(room).emit(...)` only.
   */
  dispatch(target: RealtimeEmitTarget, event: Evt): void;
  /**
   * Opt-in delivery shaping for bridge events (coalescing, volatile emits, a
   * per-socket buffered-bytes guard). Absent = every event is emitted as it arrives.
   */
  delivery?: RealtimeDelivery<Evt>;
  /** Opt-in per-namespace limits, declared here and enforced by the gateway. Absent = unlimited. */
  limits?: RealtimeLimits;
  /**
   * Opt-in: a client may re-ticket its open socket (`ticket:replace`) instead of opening another. Absent = the gateway
   * registers no such event, and a socket keeps the rooms of its handshake ticket for its whole life.
   */
  replace?: RealtimeReplace<Id>;
}

/**
 * Re-ticketing an open socket (docs/phases/07-dashboard/40 D40-4, D40-5), enforced by the gateway
 * (`websocket.ticket-replace.ts`). The client presents a fresh ticket on the socket it has, with an ack, when what it may
 * receive changes (a dashboard page switch) and before its re-authorisation deadline. The ticket passes the handshake's
 * own checks (single use, revocations, Origin, tenant fence) and must name the socket's own user, tenant and session; the
 * socket then leaves every room the new identity does not name, joins the ones it does, takes the new identity and has its
 * session expiry re-armed. A refused replace leaves the socket exactly as it was. A client still cannot name a room.
 */
export interface RealtimeReplace<Id = WsIdentity> {
  /**
   * Every room a socket of this identity belongs in: what `onConnection` joins for it. After a replace the socket is in
   * exactly these (its own id room aside); a room it already had and keeps is never left, so its events keep flowing.
   */
  rooms(identity: Id): string[];
  /** After the swap, before the ack: restart what the namespace keeps per identity, such as its re-authorisation deadline. */
  onReplaced?(socket: Socket, identity: Id, previous: Id): void;
  /** Replaces one socket may ask for per minute, granted or refused (default 10). Over it a replace is refused before any lookup. */
  perMinute?: number;
}

/**
 * How the gateway delivers a namespace's bridge events (docs/phases/13-websocket/02 §2.2).
 * Applies to events arriving through `dispatch`; socket-originated emits are untouched.
 */
export interface RealtimeDelivery<Evt = unknown> {
  /**
   * Latest-wins window in ms. The gateway keeps only the newest emit per
   * `(room, keyOf(event), event name)` and flushes every `coalesceMs`, so a
   * 1 000 events/s key costs `1000 / coalesceMs` emits per second per room.
   */
  coalesceMs?: number;
  /** Key an event is coalesced under. Default: one key for the whole namespace. */
  keyOf?(event: Evt): string;
  /** Emit with `.volatile`: a socket whose transport is not writable drops the packet instead of buffering it. */
  volatile?: boolean;
  /**
   * Per-socket write-buffer ceiling in bytes (default: off). A socket above it for
   * two consecutive checks gets `server:lagging` and is disconnected; the client
   * re-mints a ticket and re-fetches state, the same path as `server:draining`.
   */
  maxBufferedBytes?: number;
}

/** Per-namespace limits (docs/phases/13-websocket/02 §2.3). Every field is optional; unset = unlimited. */
export interface RealtimeLimits {
  /** Concurrent sockets per `identity.tenantId`, counted cluster-wide. Over the cap the handshake fails with `limit_exceeded`. */
  maxConnectionsPerTenant?: number;
  /** Concurrent sockets per `identity.userId`, counted cluster-wide. */
  maxConnectionsPerUser?: number;
  /** Rooms one socket may join (its own id room excluded). Extra `socket.join` calls are ignored. */
  maxRoomsPerSocket?: number;
  /** Inbound events one socket may send per minute. Extra events are dropped and answered with `server:rate_limited`. */
  inboundEventsPerMinute?: number;
}

/**
 * What `target.to(room)` returns: an emit into that room, optionally narrowed first.
 *
 * `except(room)` leaves the sockets in `room` (or in any of the rooms given) out
 * of the emit, like Socket.IO's `BroadcastOperator.except`; calls chain and add up.
 * A typical use: a conversation-room broadcast that skips the author's own user room
 * because the author gets a copy of their own (messaging, OD-18).
 */
export interface RealtimeRoomEmitter {
  emit(event: string, ...args: unknown[]): unknown;
  /**
   * Every target the gateway hands a dispatcher implements this, on the plain,
   * volatile and coalesced delivery paths alike (2026-10-17). It is optional in
   * the type only so an existing implementer that just emits (a test double, an
   * older plugin) still satisfies the contract; a dispatcher that relies on it
   * decides what to do when it is missing.
   */
  except?(room: string | string[]): RealtimeRoomEmitter;
}

/** The narrow emit surface a bridge dispatcher gets (a `Namespace` also satisfies it). */
export interface RealtimeEmitTarget {
  to(room: string): RealtimeRoomEmitter;
  /**
   * Make this node's sockets that are in `fromRoom` leave `room` (Socket.IO `local.in(fromRoom).socketsLeave(room)`).
   * For a membership that ended while sockets are open (risk register messaging.02): every node gets the bridge event,
   * so each moves only its own sockets, like `to`. Never coalesced: it takes effect at once. The gateway's targets all
   * implement it (2026-10-18); optional only so a test double that just emits still satisfies the contract.
   */
  leave?(fromRoom: string, room: string): void;
}

/** `socket.data` shape once the auth middleware has run. */
export interface WsSocketData<Id = WsIdentity> {
  identity: Id;
}
