import type { Socket } from 'socket.io';
import { identityFromTicket, type TicketAuthHooks } from './websocket.auth';
import { handshakeAddress } from './websocket.handshake-budget';
import { rearmSessionExpiry } from './websocket.session-expiry';
import type { RealtimeNamespace } from './websocket.types';

/**
 * `ticket:replace`: re-ticket an open socket instead of opening another (docs/phases/07-dashboard/40 D40-4, D40-5).
 *
 * A namespace opts in with `replace` on its descriptor (`RealtimeReplace`). Its client presents a fresh ticket, minted by
 * the same HTTP route as a handshake ticket, on the socket it already has, with an ack: when what it may receive changes
 * (a dashboard page switch) and before the namespace's re-authorisation deadline. The gateway then:
 *
 * - refuses a socket over `replace.perMinute` (default 10) before any lookup, and one replace while another is checked;
 * - runs the ticket through the handshake's own checks (`identityFromTicket`: single use, server-minted, revocations,
 *   the socket's upgrade Origin, the tenant fence) behind the node's per-address budget, and counts a ticket that is no
 *   ticket (or another person's) against the address as the handshake does;
 * - requires the socket's own user, tenant and session: a replace continues the session the socket was opened under,
 *   it never moves the socket to someone else's, and a ticket of another user, tenant or session is refused;
 * - leaves every room the new identity does not name, joins the ones it does (through the socket's room cap, as on
 *   connect) and never leaves a room both name, so their events keep flowing; then binds the new identity, re-arms the
 *   session expiry and lets the namespace restart what it keeps per identity (`replace.onReplaced`).
 *
 * The ack says `{ ok: true }`, or `{ ok: false, reason }` with the socket left exactly as it was: its rooms, its identity
 * and its deadlines. Swapping and acking happen in one turn, so every event of a room the socket left was written to it
 * before the ack, and none after. A replace without an ack is ignored (nothing is looked up), and a socket that closes
 * while its ticket is checked is not touched. The client can still name no room: rooms only ever come from a ticket.
 *
 * Value-free of `socket.io` like the auth middleware: sockets are typed only.
 */

/** The client → server event; it must carry an ack. */
export const TICKET_REPLACE_EVENT = 'ticket:replace';
/** Replaces one socket may ask for per minute when its namespace sets no `replace.perMinute`. */
export const DEFAULT_REPLACES_PER_MINUTE = 10;

/**
 * Why a replace was refused: `rate_limited` (the socket's replaces per minute, or its address's budget of refused
 * tickets), `busy` (another replace of this socket is being checked), `unauthorized` (the ticket: missing, unknown, used,
 * expired, revoked, from another Origin, its tenant suspended, or another user's, tenant's or session's).
 */
export type TicketReplaceRefusal = 'rate_limited' | 'busy' | 'unauthorized';
export type TicketReplaceAck = { ok: true } | { ok: false; reason: TicketReplaceRefusal };

export interface TicketReplaceHooks<Id> extends Pick<TicketAuthHooks<Id>, 'budget' | 'revocations' | 'origins' | 'fenced'> {
  /** Every answered replace (metrics). */
  onOutcome?: (ack: TicketReplaceAck) => void;
  /** Handed to the re-armed session expiry: runs when it closes the socket (metrics). */
  onExpire?: () => void;
}

/** The fields a replace may not change: the socket's user, tenant and session. */
function sameSubject(previous: unknown, next: unknown): boolean {
  const a = previous as { userId?: unknown; tenantId?: unknown; userSessionId?: unknown } | null | undefined;
  const b = next as typeof a;
  if (!a || !b || typeof a.userId !== 'string' || a.userId.length === 0) return false;
  return a.userId === b.userId && a.tenantId === b.tenantId && a.userSessionId === b.userSessionId;
}

/** Wire `ticket:replace` on a connected socket of a namespace that declares `replace`; a no-op for one that does not. */
export function installTicketReplace<Id>(
  socket: Socket,
  descriptor: Pick<RealtimeNamespace<Id>, 'authenticate' | 'replace'>,
  hooks: TicketReplaceHooks<Id> = {},
  now: () => number = Date.now,
): void {
  const replace = descriptor.replace;
  if (!replace) return;
  const perMinute = replace.perMinute ?? DEFAULT_REPLACES_PER_MINUTE;
  const stamps: number[] = [];
  let checking = false;

  socket.on(TICKET_REPLACE_EVENT, async (payload: unknown, ack: unknown) => {
    if (typeof ack !== 'function') return;
    const answer = (result: TicketReplaceAck): void => {
      hooks.onOutcome?.(result);
      (ack as (result: TicketReplaceAck) => void)(result);
    };
    // Every replace counts, granted or refused, so a socket cannot spend lookups faster than this.
    const t = now();
    while (stamps.length > 0 && stamps[0] <= t - 60_000) stamps.shift();
    if (stamps.length >= perMinute) { answer({ ok: false, reason: 'rate_limited' }); return; }
    stamps.push(t);
    if (checking) { answer({ ok: false, reason: 'busy' }); return; }
    const address = handshakeAddress(socket);
    if (hooks.budget && !hooks.budget.allows(address)) { answer({ ok: false, reason: 'rate_limited' }); return; }

    checking = true;
    try {
      const previous = (socket.data as { identity: Id }).identity;
      const ticket = (payload as { ticket?: unknown } | null | undefined)?.ticket;
      const checked = await identityFromTicket(descriptor, ticket, socket.handshake.headers?.origin, hooks);
      if ('refused' in checked || !sameSubject(previous, checked.identity)) {
        // A ticket that is no ticket, or someone else's, is what a guesser or a thief presents: counted like a refused handshake.
        if (!('refused' in checked) || checked.refused === 'bad_ticket') hooks.budget?.refused(address);
        answer({ ok: false, reason: 'unauthorized' });
        return;
      }
      // Closed while its ticket was checked: nothing to swap, and a join now would put a gone socket back into rooms.
      if (socket.disconnected) return;
      const next = checked.identity;
      const wanted = new Set(replace.rooms(next));
      // Leave first, so the room cap counts only what stays; a room both identities name is never left.
      for (const room of [...socket.rooms]) if (room !== socket.id && !wanted.has(room)) void socket.leave(room);
      const fresh = [...wanted].filter((room) => !socket.rooms.has(room));
      if (fresh.length > 0) void socket.join(fresh);
      (socket.data as { identity: Id }).identity = next;
      rearmSessionExpiry(socket as never, next, now, hooks.onExpire);
      replace.onReplaced?.(socket, next, previous);
      answer({ ok: true });
    } finally {
      checking = false;
    }
  });
}
