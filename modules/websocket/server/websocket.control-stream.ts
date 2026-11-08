import Logger from '@kuraykaraaslan-labs/logger';
import { WS_CONTROL_STREAM, parseControlEntry, type WsControlEvent } from './websocket.control';

/**
 * The control stream reader of a gateway node (2026-11-03, docs/audits/2026-11-03-redis-outage.md, D247), the `iot:kicks` reader's
 * rules (`iot_gateway/gateway/auth/kick-listener.ts`) for `ws:control:stream`:
 *
 *   - **Every node reads every entry**, no consumer group: `XREAD BLOCK` on a dedicated connection, from the id of the last entry this
 *     node handled. Start: the newest entry at start (`$` pinned to an id), so nothing written after the start is lost. A start
 *     while Redis does not answer does not stop the node (its sockets are ticketed through the HTTP side, which checks the database):
 *     the pin is retried, and once it succeeds `onGap` re-tickets what connected meanwhile.
 *   - **Reconnect**: a failed read is retried with a growing pause from the same id, so the orders written meanwhile are read then, in
 *     order. When the stream no longer runs through that id (trimmed past it, or Redis lost its data) orders may be gone: `onGap`.
 *   - **Once per order**: an entry's `oid` (the `session_end` order id) is remembered, a second copy of it (fast path and relay) is
 *     skipped, so a socket that reconnected after the first copy is not dropped again.
 *   - Value-free of `socket.io`: the gateway acts on each event (`gateway.ts`).
 */

export interface ControlStreamRedis {
  call(command: string, ...args: Array<string | number>): Promise<unknown>;
}

export interface ControlStreamOptions {
  key?: string;
  blockMs?: number;
  count?: number;
  retryMs?: number;
  /** A read that has not answered after this long failed (default `blockMs` + 5 s; see `readWithin`). */
  readTimeoutMs?: number;
  /** Orders may have been missed while this node could not read. */
  onGap?: () => void;
  /** Counted: an entry skipped as a second copy of an order, one ignored as malformed. */
  onSkipped?: (why: 'duplicate' | 'malformed') => void;
}

export interface ControlStreamReader {
  position(): string;
  stop(): void;
}

type Entry = [id: string, fields: unknown[]];
const START = '0-0';
const MAX_RETRY_MS = 10_000;
export const SEEN_ORDERS_MAX = 20_000;

function rangeEntries(reply: unknown): Entry[] {
  if (!Array.isArray(reply)) return [];
  const out: Entry[] = [];
  for (const e of reply) if (Array.isArray(e) && typeof e[0] === 'string') out.push([e[0], Array.isArray(e[1]) ? e[1] : []]);
  return out;
}
const readEntries = (reply: unknown): Entry[] => (!Array.isArray(reply) || !Array.isArray(reply[0]) ? [] : rangeEntries(reply[0][1]));
const cmpDec = (a: string, b: string): number => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);
export function compareStreamIds(a: string, b: string): number {
  const [am, as = '0'] = a.split('-');
  const [bm, bs = '0'] = b.split('-');
  return cmpDec(am, bm) || cmpDec(as, bs);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/**
 * One `XREAD BLOCK` that FAILS when it has not answered within `ms` (siege R15, 2026-11-03): with `autoResendUnfulfilledCommands = false`
 * ioredis drops a read the dropped connection held on the reconnect and never settles its promise, so the reader stopped for good after a
 * Redis restart (no order read, no gap check). A read past its BLOCK time plus a grace counts as a failed read; a late answer is ignored
 * and its entries are read again from `last`. Same rule as the MQTT gateway's kick reader (`iot_gateway` `kick-listener.ts`).
 */
export function readWithin<T>(read: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`the read did not answer within ${ms} ms (dropped by a reconnect)`)), ms);
    t.unref?.();
    read.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function startControlStreamReader(
  redis: ControlStreamRedis,
  onEvent: (event: WsControlEvent) => void,
  o: ControlStreamOptions = {},
): Promise<ControlStreamReader> {
  const key = o.key ?? WS_CONTROL_STREAM;
  const blockMs = o.blockMs ?? 5_000;
  const count = o.count ?? 512;
  const retryMs = o.retryMs ?? 500;
  const readTimeoutMs = o.readTimeoutMs ?? blockMs + 5_000;
  const pin = async (): Promise<string> => rangeEntries(await readWithin(redis.call('XREVRANGE', key, '+', '-', 'COUNT', 1), readTimeoutMs))[0]?.[0] ?? START;
  let last: string | null = await pin().catch((err: Error) => {
    Logger.warn(`[websocket] ${key} unreadable at start, retried in the background: ${err.message}`);
    return null;
  });
  let stopped = false;
  const seen = new Set<string>();

  const handle = (entries: Entry[]): void => {
    for (const [id, fields] of entries) {
      last = id;
      const parsed = parseControlEntry(fields);
      if (!parsed) {
        o.onSkipped?.('malformed');
        Logger.warn(`[websocket] ignored the malformed entry ${id} of ${key}`);
        continue;
      }
      if (parsed.orderId !== undefined) {
        if (seen.has(parsed.orderId)) { o.onSkipped?.('duplicate'); continue; }
        seen.add(parsed.orderId);
        if (seen.size > SEEN_ORDERS_MAX) seen.delete(seen.values().next().value as string);
      }
      try {
        onEvent(parsed.event);
      } catch (err) {
        Logger.error(`[websocket] control order handling failed: ${(err as Error).message}`);
      }
    }
  };

  const checkGap = async (): Promise<void> => {
    if (last === null || last === START) return;
    // the same rule as the read: a command the reconnect dropped never settles
    const oldest = rangeEntries(await readWithin(redis.call('XRANGE', key, '-', '+', 'COUNT', 1), readTimeoutMs))[0]?.[0];
    const newest = rangeEntries(await readWithin(redis.call('XREVRANGE', key, '+', '-', 'COUNT', 1), readTimeoutMs))[0]?.[0];
    if (oldest !== undefined && newest !== undefined && compareStreamIds(oldest, last) <= 0 && compareStreamIds(newest, last) >= 0) return;
    Logger.warn(`[websocket] ${key} no longer runs through ${last}: control orders may have been missed, every socket is re-ticketed`);
    if (newest === undefined) last = START;
    else if (compareStreamIds(newest, last) < 0) last = newest;
    try { o.onGap?.(); } catch (err) { Logger.error(`[websocket] gap handling failed: ${(err as Error).message}`); }
  };

  void (async () => {
    let failures = 0;
    let recovering = false;
    while (!stopped) {
      let reply: unknown;
      try {
        if (last === null) {
          last = await pin();
          // what connected before the pin may have missed an order: re-ticketed
          try { o.onGap?.(); } catch (err) { Logger.error(`[websocket] gap handling failed: ${(err as Error).message}`); }
        }
        if (recovering) {
          await checkGap();
          recovering = false;
        }
        reply = await readWithin(redis.call('XREAD', 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', key, last), readTimeoutMs);
      } catch (err) {
        if (stopped) return;
        recovering = true;
        failures += 1;
        if (failures === 1 && last !== null) Logger.warn(`[websocket] ${key} is unreadable, reading on from ${last} once Redis answers: ${(err as Error).message}`);
        await sleep(Math.min(retryMs * 2 ** Math.min(failures - 1, 10), MAX_RETRY_MS));
        continue;
      }
      if (stopped) return;
      if (failures > 0) {
        Logger.info(`[websocket] ${key} is readable again, read on from ${last}`);
        failures = 0;
      }
      handle(readEntries(reply));
    }
  })();

  return { position: () => last ?? START, stop: () => { stopped = true; } };
}
