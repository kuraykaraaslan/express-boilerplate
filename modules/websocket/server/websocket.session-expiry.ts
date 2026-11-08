import type { Socket } from 'socket.io';

/** `setTimeout` runs immediately for a delay above this (2^31 - 1 ms, about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Close a socket when the session it was ticketed under expires (docs/phases/13-websocket/04 §4.5).
 *
 * Revocation is announced over the control channel; expiry is not (nothing deletes an expired
 * session), so without this a socket outlives the session indefinitely. At the deadline the client
 * gets `server:reauth` and the socket is dropped, the same path as `server:draining`: it mints a
 * new ticket, which the HTTP side refuses when the session is really gone, and grants when the
 * session was renewed meanwhile.
 *
 * Opt-in by data: an identity without a numeric `sessionExpiresAt` is left alone. A deadline already
 * in the past closes the socket at once. The timer never keeps the process alive and is cleared on
 * `disconnect`. `onExpire` runs just before the close (a metrics hook). Returns the disarm function, or null when nothing was armed.
 */
export function armSessionExpiry(
  socket: Pick<Socket, 'emit' | 'disconnect' | 'once'>,
  identity: unknown,
  now: () => number = Date.now,
  onExpire?: () => void,
): (() => void) | null {
  const at = (identity as { sessionExpiresAt?: unknown } | null | undefined)?.sessionExpiresAt;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = (): void => {
    const remaining = at - now();
    if (remaining > MAX_TIMER_MS) {
      timer = setTimeout(arm, MAX_TIMER_MS);
    } else {
      timer = setTimeout(() => {
        timer = null;
        onExpire?.();
        socket.emit('server:reauth');
        socket.disconnect(true);
      }, Math.max(0, remaining));
    }
    timer.unref?.();
  };
  arm();
  socket.once('disconnect', disarm);
  return disarm;
}

/**
 * Re-arm a socket's session deadline from a renewed identity, for a namespace that re-authorises a socket in place
 * instead of closing it (`/telephony`: closing would hang up a live call; risk register websocket.10; and every
 * `ticket:replace`, `websocket.ticket-replace.ts`). The gateway keeps the disarm of the timer it armed at connect on
 * `socket.data.sessionExpiryDisarm`; this disarms it, arms one for the new identity's `sessionExpiresAt` and keeps that
 * one there. The old timer's `disconnect` listener goes with it when the socket can remove one: a socket re-armed on
 * every replace would otherwise gather one listener per replace for as long as it lives.
 */
export function rearmSessionExpiry(
  socket: Pick<Socket, 'emit' | 'disconnect' | 'once'> & Partial<Pick<Socket, 'removeListener'>> & { data: Record<string, unknown> },
  identity: unknown,
  now: () => number = Date.now,
  onExpire?: () => void,
): void {
  const previous = socket.data.sessionExpiryDisarm as (() => void) | null | undefined;
  if (previous) {
    previous();
    socket.removeListener?.('disconnect', previous);
  }
  socket.data.sessionExpiryDisarm = armSessionExpiry(socket, identity, now, onExpire);
}
