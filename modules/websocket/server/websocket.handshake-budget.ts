import type { Socket } from 'socket.io';

/**
 * Per-address handshake checks the auth middleware runs before a ticket is looked up (risk register websocket.06).
 * Dependency-free on purpose: `websocket.auth.ts` imports it, and the auth middleware must stay value-free of the logger,
 * the env and socket.io (types only).
 */

/** The address a handshake comes from, IPv4-mapped IPv6 folded (`::ffff:1.2.3.4` → `1.2.3.4`). */
export function handshakeAddress(socket: Pick<Socket, 'handshake'>): string {
  const raw = String(socket.handshake?.address ?? '');
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/** `WS_TRUSTED_PROXIES`: comma-separated addresses, IPv4-mapped IPv6 folded like `handshakeAddress` does. */
export function trustedProxies(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((a) => a.trim()).filter(Boolean).map((a) => (a.startsWith('::ffff:') ? a.slice(7) : a)));
}

export interface HandshakeBudget {
  /** False when `address` has used up its refusals in the current window: refuse without looking the ticket up. */
  allows(address: string): boolean;
  /** Count one refused handshake of `address`. */
  refused(address: string): void;
}

/**
 * A per-node budget of REFUSED handshakes per address and minute (risk register websocket.06): an anonymous client that
 * keeps presenting made-up tickets stops costing a ticket lookup each after `perMinute` refusals, until the window
 * rolls over. Accepted handshakes are not counted, so a user who connects normally never meets it. In-process, like
 * the inbound limit: a node only needs to protect itself, and the attacker's cost already scales with the node count.
 * `exempt` addresses (the load balancer, `WS_TRUSTED_PROXIES`) are never limited: behind a TCP balancer every client
 * shares its address. The map is swept each window, so it holds at most the addresses seen in one minute.
 */
export function createHandshakeBudget(
  perMinute: number,
  exempt: ReadonlySet<string> = new Set(),
  now: () => number = Date.now,
): HandshakeBudget {
  const WINDOW_MS = 60_000;
  let windowStart = now();
  let counts = new Map<string, number>();
  const roll = () => {
    if (now() - windowStart >= WINDOW_MS) { windowStart = now(); counts = new Map(); }
  };
  return {
    allows(address) {
      if (perMinute <= 0 || exempt.has(address)) return true;
      roll();
      return (counts.get(address) ?? 0) < perMinute;
    },
    refused(address) {
      if (perMinute <= 0 || exempt.has(address)) return;
      roll();
      counts.set(address, (counts.get(address) ?? 0) + 1);
    },
  };
}
