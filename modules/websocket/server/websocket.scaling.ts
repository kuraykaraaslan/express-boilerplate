import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * The `ws` kind's scaling signal and drain timing (docs/phases/14-docker/07 task 7).
 *
 * A supervised ws child reports one number every 5 s: its load ratio
 *
 *     max(connections / WS_SCALE_CONNECTIONS, event-loop lag p99 / WS_SCALE_LAG_MS)
 *
 * so 1.0 means "5 000 sockets or 50 ms of loop lag on this child". The supervisor averages the children's ratios and its
 * `ws` policy (process_host `KIND_DEFAULTS.ws`) scales up when the average holds at ≥ 1 for 60 s and down when it holds
 * below 0.5 for 30 min.
 *
 * A scale-down drains one child: it stops accepting (its listener closes, so the cluster primary routes new connections to
 * its siblings), keeps its sockets for the grace below, then sends the reconnect hint (`server:draining`, the same notice
 * a rolling deploy sends and every client already handles) and closes what is left, spread over a few seconds so the
 * reconnects do not arrive in one burst.
 */

/** Connections per child that count as full load (ratio 1). */
export const WS_SCALE_CONNECTIONS = 5_000;
/** Event-loop lag p99 (ms) that counts as full load (ratio 1). */
export const WS_SCALE_LAG_MS = 50;
/** How often a supervised child reports its ratio (the supervisor samples every 5 s). */
export const WS_SIGNAL_REPORT_MS = 5_000;
/** Sockets on a drained child get this long to leave by themselves (07: "existing sockets up to 10 min"). */
export const WS_SOCKET_GRACE_MS = 10 * 60_000;
/** The reconnect hint and the closing of the remaining sockets are spread over this long. */
export const WS_RECONNECT_SPREAD_MS = 5_000;

/** The load ratio of one child. */
export function loadRatio(connections: number, lagP99Ms: number): number {
  const c = Number.isFinite(connections) && connections > 0 ? connections / WS_SCALE_CONNECTIONS : 0;
  const l = Number.isFinite(lagP99Ms) && lagP99Ms > 0 ? lagP99Ms / WS_SCALE_LAG_MS : 0;
  return Math.max(c, l);
}

/**
 * How long a drained child keeps its sockets, given the supervisor's grace for the drain: the grace minus a margin for the
 * hint, the close and the exit (a tenth of it, at most a minute), so the default 11 min grace gives the 10 min of 07.
 * Without a grace (an older supervisor): the 10 min.
 */
export function socketGraceFor(graceMs: number | undefined): number {
  if (graceMs === undefined || !Number.isFinite(graceMs) || graceMs <= 0) return WS_SOCKET_GRACE_MS;
  return Math.max(0, Math.floor(graceMs - Math.min(60_000, graceMs / 10)));
}

export interface LoadSignal {
  /** The ratio since the previous sample (the lag histogram restarts at each sample). */
  sample(): number;
  /** The last sample's parts, for logs and the heartbeat. */
  last(): { connections: number; lagP99Ms: number; ratio: number };
  stop(): void;
}

const LAG_RESOLUTION_MS = 10;

/** Samples `connections()` and this process's event-loop delay (p99, via `perf_hooks.monitorEventLoopDelay`). */
export function createLoadSignal(connections: () => number): LoadSignal {
  const h = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
  h.enable();
  let last = { connections: 0, lagP99Ms: 0, ratio: 0 };
  return {
    sample() {
      // the histogram records the interval of a 10 ms timer (ns): an idle loop reads ~10 ms, so the lag is the excess
      const lagP99Ms = h.count > 0 ? Math.max(0, h.percentile(99) / 1e6 - LAG_RESOLUTION_MS) : 0;
      h.reset();
      const n = connections();
      last = { connections: n, lagP99Ms: Math.round(lagP99Ms * 10) / 10, ratio: loadRatio(n, lagP99Ms) };
      return last.ratio;
    },
    last: () => last,
    stop: () => h.disable(),
  };
}
