import type { Socket } from 'socket.io';
import type { RealtimeNamespace } from './websocket.types';
import { handshakeAddress, type HandshakeBudget } from './websocket.handshake-budget';
import type { RevocationMemory } from './websocket.revocation-memory';

/**
 * Generic handshake middleware for a namespace: read the single-use ticket from
 * the handshake, resolve it to a domain identity via the descriptor, and bind it
 * to `socket.data.identity`. The gateway NEVER trusts client-supplied identity
 * fields — they come only from the descriptor's `authenticate`.
 *
 * `socket.io` is imported type-only, so this file (and thus the descriptor's
 * transitive graph) stays value-free of the WS runtime until the gateway loads
 * it. Install with `namespace.use(makeTicketAuthMiddleware(descriptor))` — note
 * a named namespace needs `ns.use`, not the default-namespace `io.use`.
 */
/**
 * May a socket with this identity open from this Origin (risk register websocket.04)? CORS does not apply to the websocket
 * transport, so the gateway checks it. Tenants are served on their own subdomains and custom domains, which no static
 * list can name, so the ticket carries the Origin of the request that minted it and the upgrade must come from there,
 * or from an allowlisted origin. No Origin (a native app, a server) passes: browsers always send one. Anonymous
 * identities (`/status`, public data, no ticket) and the development policy are not checked.
 */
export function originAllowed(policy: string[] | boolean | undefined, origin: unknown, identity: unknown): boolean {
  if (policy === undefined || policy === true || policy === false) return true;
  if (typeof origin !== 'string' || origin === '') return true;
  const id = identity as { userId?: unknown; origin?: unknown } | null;
  if (!id || typeof id.userId !== 'string') return true;
  return policy.includes(origin) || id.origin === origin;
}

/** What the handshake middleware (and, for the parts it shares, `ticket:replace`) is handed by the gateway. */
export interface TicketAuthHooks<Id> {
  /** After a valid ticket: a refusal reason (e.g. a connection cap) rejects the handshake with `limit_exceeded`. */
  admit?: (socket: Socket, identity: Id) => Promise<string | null>;
  /**
   * After a valid ticket, before admission: true refuses the handshake as `unauthorized` (the identity's tenant is suspended,
   * websocket.tenant-fence). A check that throws refuses too: the ticket it guards was read from the same Redis.
   */
  fenced?: (identity: Id) => Promise<boolean>;
  /** Called with the reason every time a handshake is refused. */
  onRefused?: (reason: string) => void;
  /**
   * The node's budget of refused handshakes per address (websocket.06). Checked before the ticket is looked up; every
   * `unauthorized` refusal is counted against the address.
   */
  budget?: HandshakeBudget;
  /** What this node was told was revoked lately (websocket.17): a matching identity is refused like a bad ticket. */
  revocations?: RevocationMemory;
  /**
   * The origin policy (websocket.04): an allowlist, or `true` (development, no check). With an allowlist, an upgrade
   * that carries an Origin opens a ticketed socket only from the origin that minted the ticket or an allowlisted one.
   */
  origins?: string[] | boolean;
}

/**
 * Why a presented ticket is no identity: `bad_ticket` when the namespace's `authenticate` found none (unknown, used,
 * expired, malformed: what a guesser gets, counted against the address), `unauthorized` when a real ticket was refused
 * (revoked since it was minted, presented from another Origin, its tenant suspended: nobody guessed anything).
 */
export type TicketRefusal = 'bad_ticket' | 'unauthorized';

/**
 * The checks a presented ticket passes to become a socket's identity, in this order: the namespace's own `authenticate`
 * (single use, server-minted), the revocation memory (websocket.17), the Origin (websocket.04) and the tenant fence. The
 * handshake runs them, and so does `ticket:replace` (`websocket.ticket-replace.ts`), so a ticket presented on an open
 * socket is judged exactly as one presented on a new connection. `origin` is the Origin header of the socket's upgrade.
 * Never throws.
 */
export async function identityFromTicket<Id>(
  descriptor: Pick<RealtimeNamespace<Id>, 'authenticate'>,
  ticket: unknown,
  origin: unknown,
  hooks: Pick<TicketAuthHooks<Id>, 'revocations' | 'origins' | 'fenced'> = {},
): Promise<{ identity: Id } | { refused: TicketRefusal }> {
  let identity: Id | null;
  try {
    identity = await descriptor.authenticate(String(ticket ?? ''));
  } catch {
    identity = null;
  }
  if (!identity) return { refused: 'bad_ticket' };
  // A real ticket whose session, membership or tenant was revoked after it was minted: refused all the same.
  if (hooks.revocations?.refuses(identity)) return { refused: 'unauthorized' };
  if (!originAllowed(hooks.origins, origin, identity)) return { refused: 'unauthorized' };
  if (hooks.fenced) {
    let fenced: boolean;
    try {
      fenced = await hooks.fenced(identity);
    } catch {
      fenced = true;
    }
    if (fenced) return { refused: 'unauthorized' };
  }
  return { identity };
}

export function makeTicketAuthMiddleware<Id>(descriptor: RealtimeNamespace<Id>, hooks: TicketAuthHooks<Id> = {}) {
  const refuse = (next: (err?: Error) => void, reason: string): void => {
    hooks.onRefused?.(reason);
    if (reason === 'unauthorized') {
      next(new Error('unauthorized'));
      return;
    }
    if (reason === 'admission_unavailable') {
      next(Object.assign(new Error('limit_exceeded'), { data: { code: 'admission_unavailable' } }));
      return;
    }
    // Typed error: the client reads `err.data.code` / `err.data.scope`, no message parsing.
    next(Object.assign(new Error('limit_exceeded'), {
      data: { code: 'connection_limit', scope: reason === 'user_limit' ? 'user' : reason === 'ip_limit' ? 'ip' : 'tenant' },
    }));
  };
  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    // Per-address checks come first, so an address that is over them costs no ticket lookup.
    const address = handshakeAddress(socket);
    if (hooks.budget && !hooks.budget.allows(address)) {
      refuse(next, 'ip_limit');
      return;
    }
    if (descriptor.admitAddress) {
      let ok = false;
      try {
        ok = await descriptor.admitAddress(address);
      } catch {
        ok = false; // a namespace that cannot answer refuses (fail closed); its own code decides whether to fail open
      }
      if (!ok) {
        refuse(next, 'ip_limit');
        return;
      }
    }
    const checked = await identityFromTicket(descriptor, socket.handshake.auth?.ticket, socket.handshake.headers?.origin, hooks);
    if ('refused' in checked) {
      // Only a ticket that is no ticket is counted against the address: a revoked one, a foreign Origin or a suspended
      // tenant is a real ticket, and no attacker guessed anything.
      if (checked.refused === 'bad_ticket') hooks.budget?.refused(address);
      refuse(next, 'unauthorized');
      return;
    }
    const { identity } = checked;
    if (hooks.admit) {
      let reason: string | null = null;
      try {
        reason = await hooks.admit(socket, identity);
      } catch {
        // An admission check that cannot answer refuses (risk register websocket.01): skipping it would skip the cap.
        // The gateway's own tracker never throws (it falls back to the node's count); this guards any other hook.
        reason = 'admission_unavailable';
      }
      if (reason) {
        refuse(next, reason);
        return;
      }
    }
    (socket.data as { identity: Id }).identity = identity;
    next();
  };
}
