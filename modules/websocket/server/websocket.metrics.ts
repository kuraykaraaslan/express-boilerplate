import type { MetricsRegistryLike } from '@kuraykaraaslan-labs/process_host/server/process-host';

/**
 * Per-namespace gateway counters (docs/phases/13-websocket/02 §2.4).
 *
 * Plain in-memory numbers: they cost nothing when `METRICS_ENABLED` is off and
 * the same values feed the heartbeat. `register` mirrors them onto the
 * `process_host` per-process prom registry (OD-12) — no second metrics system.
 */

export type RefusalReason = 'unauthorized' | 'tenant_limit' | 'user_limit' | 'ip_limit' | 'admission_unavailable';

export interface NamespaceStats {
  /** Bridge events parsed and handed to the descriptor's `dispatch`. */
  bridgedIn: number;
  /** `emit` calls that left the gateway toward rooms (one per flush when coalescing). */
  emitsOut: number;
  /** Emits replaced by a newer one inside a coalescing window. */
  coalescedDrops: number;
  /** Packets a volatile emit skipped because the socket's transport was not writable. */
  volatileDrops: number;
  /** Sockets disconnected by the buffered-bytes guard. */
  laggingDisconnects: number;
  /** `socket.join` calls ignored by `maxRoomsPerSocket`. */
  roomsRefused: number;
  /** Inbound events dropped by `inboundEventsPerMinute`. */
  inboundDropped: number;
  /** Sockets closed at their ticket's `sessionExpiresAt` (`server:reauth`). */
  sessionExpired: number;
  /** `ticket:replace` calls granted: an open socket took a fresh ticket instead of a new connection being opened. */
  ticketReplaced: number;
  /** `ticket:replace` calls refused (limited, busy or an unauthorized ticket); the socket was left as it was. */
  ticketReplaceRefused: number;
  refused: Record<RefusalReason, number>;
}

const emptyStats = (): NamespaceStats => ({
  bridgedIn: 0, emitsOut: 0, coalescedDrops: 0, volatileDrops: 0, laggingDisconnects: 0,
  roomsRefused: 0, inboundDropped: 0, sessionExpired: 0, ticketReplaced: 0, ticketReplaceRefused: 0,
  refused: { unauthorized: 0, tenant_limit: 0, user_limit: 0, ip_limit: 0, admission_unavailable: 0 },
});

/** Loose prom-client surface: loaded lazily by `process_host`, never imported here. */
interface PromLike {
  Counter: new (cfg: Record<string, unknown>) => { reset(): void; inc(labels: Record<string, string>, value?: number): void };
  Gauge: new (cfg: Record<string, unknown>) => { reset(): void; set(labels: Record<string, string>, value: number): void };
}

export class WsMetrics {
  private readonly byPath = new Map<string, NamespaceStats>();

  /** Stats of one namespace, created on first use. */
  for(path: string): NamespaceStats {
    let stats = this.byPath.get(path);
    if (!stats) {
      stats = emptyStats();
      this.byPath.set(path, stats);
    }
    return stats;
  }

  paths(): string[] {
    return [...this.byPath.keys()];
  }

  /**
   * Expose the counters on a prom registry. Counters are mirrored (reset, then set to the
   * absolute value on every scrape) because the gateway keeps its own running totals.
   * `socketsOf` supplies the live gauge.
   */
  register(registry: MetricsRegistryLike, prom: unknown, socketsOf: (path: string) => number): void {
    const { Counter, Gauge } = prom as PromLike;
    const registers = [registry];
    const labelNames = ['namespace'];
    const mirror = (name: string, help: string, pick: (s: NamespaceStats) => number) => {
      const stats = this.byPath;
      new Counter({
        name, help, labelNames, registers,
        collect(this: { reset(): void; inc(l: Record<string, string>, v?: number): void }) {
          this.reset();
          for (const [namespace, s] of stats) this.inc({ namespace }, pick(s));
        },
      });
    };
    mirror('ws_bridged_events_total', 'Bridge events received from Redis and dispatched', (s) => s.bridgedIn);
    mirror('ws_emits_total', 'Emits sent toward rooms (one per flush when coalescing)', (s) => s.emitsOut);
    mirror('ws_coalesced_dropped_total', 'Emits replaced by a newer one inside a coalescing window', (s) => s.coalescedDrops);
    mirror('ws_volatile_dropped_total', 'Volatile packets dropped because the socket could not keep up', (s) => s.volatileDrops);
    mirror('ws_lagging_disconnects_total', 'Sockets disconnected for exceeding the buffered-bytes ceiling', (s) => s.laggingDisconnects);
    mirror('ws_rooms_refused_total', 'socket.join calls ignored by maxRoomsPerSocket', (s) => s.roomsRefused);
    mirror('ws_inbound_dropped_total', 'Inbound events dropped by inboundEventsPerMinute', (s) => s.inboundDropped);
    mirror('ws_session_expired_total', 'Sockets closed because the session their ticket was minted under expired', (s) => s.sessionExpired);
    mirror('ws_ticket_replaced_total', 'ticket:replace calls granted on an open socket', (s) => s.ticketReplaced);
    mirror('ws_ticket_replace_refused_total', 'ticket:replace calls refused, the socket left as it was', (s) => s.ticketReplaceRefused);

    const stats = this.byPath;
    new Counter({
      name: 'ws_connections_refused_total', help: 'Handshakes refused, by reason',
      labelNames: ['namespace', 'reason'], registers,
      collect(this: { reset(): void; inc(l: Record<string, string>, v?: number): void }) {
        this.reset();
        for (const [namespace, s] of stats) {
          for (const [reason, n] of Object.entries(s.refused)) this.inc({ namespace, reason }, n);
        }
      },
    });
    new Gauge({
      name: 'ws_sockets', help: 'Sockets currently connected to this node, per namespace', labelNames, registers,
      collect(this: { reset(): void; set(l: Record<string, string>, v: number): void }) {
        this.reset();
        for (const namespace of stats.keys()) this.set({ namespace }, socketsOf(namespace));
      },
    });
  }
}
