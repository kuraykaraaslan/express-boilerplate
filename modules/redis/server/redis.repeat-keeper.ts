import { randomBytes } from 'node:crypto';

/**
 * Re-registers this process's BullMQ repeatable jobs after Redis lost its data (docs/audits/2026-11-03-redis-outage.md §6, D250).
 *
 * A repeatable job lives in Redis only. A Redis that comes back empty (a restart without persistence, a failover to a replica that
 * had not caught up, a FLUSHALL) silently ends every recurring job of the platform: subscription expiry and billing, dunning, the
 * tenant purge, the session revocation outbox drain, the usage flush, the alert dispatch, the watchdog, about a hundred in all. The
 * boot tasks that registered them ran once; a process that wins the scheduler lock back does not run them again
 * (worker-bootstrap.ts), and many guard themselves with a "scheduled" flag, so nothing put them back until the next restart.
 *
 * `installRepeatKeeper(Queue)` wraps `Queue.prototype.add`: an `add` with `opts.repeat` that succeeded is remembered (queue, name,
 * data, options; one entry per queue, name and repeat spec). Every `intervalMs` (default 60 s, unref'd) the keeper refreshes a marker
 * key of this process (`bullmq:repeat-keeper:<process>`, TTL one day): when the marker is GONE, Redis lost its data, and every
 * remembered repeatable is added again (BullMQ dedupes a repeatable by its key, so adding one that exists is a no-op), then the marker
 * is set again. The marker is per process: another process's fresh registration cannot hide the loss from this one. A Redis that does
 * not answer costs nothing (the next tick asks again). Job data is checked by the secret guard as on the first add.
 *
 * What this does NOT bring back: one-off jobs that were waiting in a queue when Redis lost them (their producers' durable sources,
 * where they have one, are listed in the audit).
 */

export const REPEAT_KEEPER_MS = 60_000;
export const REPEAT_MARKER_TTL_S = 24 * 3600;
export const REPEAT_MARKER_PREFIX = 'bullmq:repeat-keeper:';

/** The commands the keeper needs: the shared command client (it fails fast; the BullMQ connection would queue forever). */
export interface MarkerClient {
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export interface RepeatKeeperDeps {
  client: () => MarkerClient | Promise<MarkerClient>;
  log: { info(m: string): void; warn(m: string): void };
  intervalMs?: number;
  /** The bound of one marker command, ms. */
  timeoutMs?: number;
}

type AddFn = (this: unknown, name: string, data: unknown, opts?: { repeat?: unknown }) => Promise<unknown>;
interface Kept { queue: unknown; name: string; data: unknown; opts: { repeat?: unknown } }

const KEPT = Symbol.for('nb.bullmq.repeatKeeper');

interface KeeperState {
  add: AddFn;
  deps: RepeatKeeperDeps;
  kept: Map<string, Kept>;
  marker: string;
  timer: ReturnType<typeof setInterval> | null;
  ticking: Promise<number> | null;
}

let state: KeeperState | null = null;

function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => {});
  return Promise.race([
    work,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('the marker command timed out')), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function keyOf(queue: unknown, name: string, repeat: unknown): string {
  return `${String((queue as { name?: string })?.name ?? '?')}\u0000${name}\u0000${JSON.stringify(repeat)}`;
}

/**
 * Wraps `add` of a Queue class's prototype (idempotent per prototype). Returns whether the prototype is kept. A class without a
 * prototype `add` (a test double) is left alone.
 */
export function installRepeatKeeper(QueueClass: unknown, deps: RepeatKeeperDeps): boolean {
  const proto = (QueueClass as { prototype?: Record<string | symbol, unknown> } | null)?.prototype;
  if (!proto) return false;
  if (proto[KEPT]) return true;
  if (typeof proto.add !== 'function') return false;
  const add = proto.add as AddFn;
  const s: KeeperState = {
    add, deps, kept: new Map(), timer: null, ticking: null,
    marker: `${REPEAT_MARKER_PREFIX}${process.pid}:${randomBytes(6).toString('hex')}`,
  };
  state = s;
  proto.add = async function keptAdd(this: unknown, name: string, data: unknown, opts?: { repeat?: unknown }) {
    const job = await add.call(this, name, data, opts);
    if (opts?.repeat) {
      s.kept.set(keyOf(this, name, opts.repeat), { queue: this, name, data, opts });
      void mark(s);
      start(s);
    }
    return job;
  };
  proto[KEPT] = true;
  return true;
}

async function mark(s: KeeperState): Promise<void> {
  try {
    const client = await s.deps.client();
    await bounded(client.set(s.marker, String(Date.now()), 'EX', REPEAT_MARKER_TTL_S), s.deps.timeoutMs ?? 2_000);
  } catch { /* the next tick refreshes it, or (missing) re-adds what it would have marked: harmless */ }
}

function start(s: KeeperState): void {
  if (s.timer) return;
  s.timer = setInterval(() => { void keepRepeatables().catch(() => undefined); }, s.deps.intervalMs ?? REPEAT_KEEPER_MS);
  s.timer.unref?.();
}

/**
 * One keeper tick: refresh this process's marker; when it is gone, add every remembered repeatable again and set it. Resolves with
 * the number re-added (0 when nothing was lost or Redis did not answer). One tick at a time.
 */
export function keepRepeatables(): Promise<number> {
  const s = state;
  if (!s || s.kept.size === 0) return Promise.resolve(0);
  s.ticking ??= tick(s).finally(() => { s.ticking = null; });
  return s.ticking;
}

async function tick(s: KeeperState): Promise<number> {
  let present: number;
  try {
    const client = await s.deps.client();
    present = Number(await bounded(client.expire(s.marker, REPEAT_MARKER_TTL_S), s.deps.timeoutMs ?? 2_000));
  } catch {
    return 0; // Redis did not answer: asked again on the next tick
  }
  if (present === 1) return 0;
  let readded = 0;
  for (const k of [...s.kept.values()]) {
    try {
      await s.add.call(k.queue, k.name, k.data, k.opts);
      readded++;
    } catch (err) {
      s.deps.log.warn(`[Redis:bullmq] repeatable ${String((k.queue as { name?: string })?.name)}/${k.name} could not be added again: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (readded === s.kept.size) await mark(s); // a partial pass leaves the marker missing: the next tick tries the rest again
  s.deps.log.warn(`[Redis:bullmq] Redis lost this process's repeatable jobs: ${readded} of ${s.kept.size} added again`);
  return readded;
}

/** Test seam: the state of the installed keeper (stops its timer). */
export function _resetRepeatKeeperForTests(): void {
  if (state?.timer) clearInterval(state.timer);
  state = null;
}
