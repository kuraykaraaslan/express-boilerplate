import type { Namespace } from 'socket.io';
import type { RealtimeEmitTarget, RealtimeNamespace, RealtimeRoomEmitter } from './websocket.types';
import type { NamespaceStats } from './websocket.metrics';

/** One emit's audience: a room, minus the sockets of the `except` rooms. */
type Send = (room: string, except: readonly string[], event: string, args: unknown[]) => unknown;

/**
 * A chainable room emitter for the gateway's own wrappers: `except()` only collects
 * rooms, and `emit` hands the whole audience to `send` in one call, so a wrapper
 * (counting, volatile, coalescing) sees what it is about to deliver and to whom.
 */
function audience(room: string, except: readonly string[], send: Send): RealtimeRoomEmitter {
  return {
    emit: (event: string, ...args: unknown[]) => send(room, except, event, args),
    except: (more: string | string[]) => audience(room, [...except, ...(Array.isArray(more) ? more : [more])], send),
  };
}

/** `target.to(room)` narrowed by `except` rooms; with none, the plain room emitter. */
function narrowed(target: RealtimeEmitTarget, room: string, except: readonly string[]): RealtimeRoomEmitter {
  const emitter = target.to(room);
  if (except.length === 0) return emitter;
  // Every target in this file implements `except`; a sink that does not cannot honour the audience.
  if (!emitter.except) throw new Error('[websocket] emit target cannot leave rooms out (no except())');
  return emitter.except([...except]);
}

/**
 * Emit target for events that arrive over the Redis bridge.
 *
 * Every gateway node subscribes to every descriptor channel, so every node sees
 * each bridged event. `ns.to(room).emit` goes through the cluster adapter and
 * reaches the sockets on ALL nodes, which makes N nodes deliver it N times.
 * `ns.local` restricts the broadcast to this process: each node then serves only
 * its own sockets, and every socket gets the event exactly once at any node count.
 *
 * Only for bridge events. Emits that originate from a socket handler happen on
 * one node only and keep using the cluster-wide namespace.
 *
 * `to(room).except(other)` leaves the sockets of `other` out (Socket.IO's own
 * `BroadcastOperator.except`, applied to this node's sockets like the room itself).
 *
 * `volatile` emits with `.volatile`: a socket that cannot take the packet right now
 * loses it instead of buffering it. Socket.IO drops exactly those sockets whose
 * transport is not writable, so they are counted up front through `onVolatileDrops`
 * (sockets left out by `except` are not counted: they were never addressed).
 */
export function localEmitTarget(
  ns: Namespace,
  opts: { volatile?: boolean; onVolatileDrops?: (count: number) => void } = {},
): RealtimeEmitTarget {
  const leave = (fromRoom: string, room: string): void => { ns.local.in(fromRoom).socketsLeave(room); };
  if (!opts.volatile) {
    return { to: (room: string) => ns.local.to(room), leave };
  }
  return {
    leave,
    to: (room: string) => audience(room, [], (target, except, event, args) => {
      const dropped = countUnwritable(ns, target, except);
      if (dropped > 0) opts.onVolatileDrops?.(dropped);
      const op = ns.local.to(target);
      return (except.length ? op.except([...except]) : op).volatile.emit(event, ...args);
    }),
  };
}

/** Sockets of `room` on this node (minus those in any `except` room) whose transport cannot take a packet right now. */
export function countUnwritable(ns: Namespace, room: string, except: readonly string[] = []): number {
  const ids = ns.adapter.rooms.get(room);
  if (!ids) return 0;
  const skipped = new Set<string>();
  for (const other of except) for (const id of ns.adapter.rooms.get(other) ?? []) skipped.add(id);
  let n = 0;
  for (const id of ids) {
    if (skipped.has(id)) continue;
    const transport = (ns.sockets.get(id) as unknown as { conn?: { transport?: { writable?: boolean } } } | undefined)?.conn?.transport;
    if (transport && transport.writable === false) n++;
  }
  return n;
}

interface Pending { room: string; except: readonly string[]; event: string; args: unknown[] }

/**
 * Latest-wins coalescer: keeps the newest emit per `(room, except rooms, key, event)`
 * and flushes them all every `windowMs`. A burst of N events for one key therefore
 * costs one emit per window and the receiver always sees the newest value.
 *
 * The `except` rooms are part of the identity: an emit to "the room minus X" never
 * replaces one to "the whole room" (X would lose it), and vice versa.
 */
export class Coalescer {
  private pending = new Map<string, Pending>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sink: RealtimeEmitTarget,
    private readonly windowMs: number,
    private readonly onCoalesced: () => void = () => {},
  ) {}

  /** A target whose emits are held under `key` until the next flush. */
  target(key: string): RealtimeEmitTarget {
    return {
      // Membership is not a value to coalesce: it changes at once.
      leave: (fromRoom: string, room: string) => this.sink.leave?.(fromRoom, room),
      to: (room: string) => audience(room, [], (target, except, event, args) => {
        const skip = [...new Set(except)].sort();
        const id = `${target}\u0000${skip.join('\u0001')}\u0000${key}\u0000${event}`;
        if (this.pending.has(id)) this.onCoalesced();
        this.pending.set(id, { room: target, except: skip, event, args });
        this.schedule();
      }),
    };
  }

  flush(): void {
    this.timer = null;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const p of batch) narrowed(this.sink, p.room, p.except).emit(p.event, ...p.args);
  }

  /** Stop the timer; what is still pending is flushed so the last values are not lost. */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.flush();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.windowMs);
    this.timer.unref?.();
  }
}

export interface Deliverer<Evt = unknown> {
  dispatch(event: Evt): void;
  close(): void;
}

/**
 * Build the per-namespace delivery path for bridge events: the descriptor's
 * `dispatch` gets a local target that counts emits, optionally volatile, optionally
 * coalesced (`descriptor.delivery`). A namespace with no `delivery` behaves as before.
 * `to(room).except(other)` is honoured on every one of these paths.
 */
export function createDeliverer<Evt>(
  descriptor: Pick<RealtimeNamespace<unknown, Evt>, 'dispatch' | 'delivery'>,
  ns: Namespace,
  stats: NamespaceStats,
): Deliverer<Evt> {
  const delivery = descriptor.delivery;
  const base = localEmitTarget(ns, {
    volatile: delivery?.volatile,
    onVolatileDrops: (n) => { stats.volatileDrops += n; },
  });
  const counted: RealtimeEmitTarget = {
    to: (room) => audience(room, [], (target, except, event, args) => {
      stats.emitsOut++;
      return narrowed(base, target, except).emit(event, ...args);
    }),
    leave: (fromRoom, room) => base.leave?.(fromRoom, room),
  };

  const windowMs = delivery?.coalesceMs;
  if (!windowMs || windowMs <= 0) {
    return {
      dispatch: (event) => { stats.bridgedIn++; descriptor.dispatch(counted, event); },
      close: () => {},
    };
  }
  const coalescer = new Coalescer(counted, windowMs, () => { stats.coalescedDrops++; });
  return {
    dispatch: (event) => {
      stats.bridgedIn++;
      descriptor.dispatch(coalescer.target(delivery?.keyOf?.(event) ?? ''), event);
    },
    close: () => coalescer.close(),
  };
}

interface EngineSocketLike {
  writeBuffer?: Array<{ data?: string | ArrayBufferLike | { byteLength?: number } }>;
  transport?: { socket?: { bufferedAmount?: number } };
}

/** Bytes queued toward one socket: engine.io's write buffer plus what `ws` has not flushed yet. */
export function bufferedBytes(conn: EngineSocketLike | undefined): number {
  if (!conn) return 0;
  let bytes = conn.transport?.socket?.bufferedAmount ?? 0;
  for (const packet of conn.writeBuffer ?? []) {
    const data = packet.data;
    if (typeof data === 'string') bytes += Buffer.byteLength(data);
    else if (data && typeof (data as { byteLength?: number }).byteLength === 'number') bytes += (data as { byteLength: number }).byteLength;
  }
  return bytes;
}

/**
 * Per-socket write-buffer guard. `sweep()` runs on a timer: a socket over `maxBytes`
 * is only flagged the first time; if it is still over at the next sweep ("for longer
 * than one flush") it gets `server:lagging` and is disconnected.
 */
export function createLagGuard(
  ns: Namespace,
  maxBytes: number,
  onLagging: () => void,
): { sweep(): void } {
  const flagged = new Set<string>();
  return {
    sweep() {
      for (const [id, socket] of ns.sockets) {
        const over = bufferedBytes((socket as unknown as { conn?: EngineSocketLike }).conn) > maxBytes;
        if (!over) { flagged.delete(id); continue; }
        if (!flagged.has(id)) { flagged.add(id); continue; }
        flagged.delete(id);
        onLagging();
        socket.emit('server:lagging');
        socket.disconnect(true);
      }
      for (const id of flagged) if (!ns.sockets.has(id)) flagged.delete(id);
    },
  };
}
