import { randomBytes } from 'node:crypto';
import redis from '@kuraykaraaslan-labs/redis/server/redis.service';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Leader lock for single-owner work (docs/phases/14-docker/07 "Single-owner work", task 2).
 *
 * Work that must run once per cluster (schedulers, cron owners, BullMQ repeatable registration) runs in exactly one
 * process of a kind however many children or containers there are. That process holds
 * `proc:leader:<kind>:<job>` (SET NX PX 15 s), renews it every 5 s, and releases it when it stops. The others try
 * again every 5 s, so a dead leader is replaced within the TTL plus one retry.
 *
 * Every acquisition takes a new fencing token (`INCR proc:leader:<kind>:<job>:fence`), passed to `run`: a job that
 * writes somewhere shared can store it and refuse a write carrying an older one, which protects against a paused
 * ex-leader that has not noticed it lost the lock.
 *
 * With one process it changes nothing: the first attempt acquires the free lock and `run` starts before `withLeader`
 * resolves, exactly when the code it wraps used to run.
 *
 * Only single-key commands are used (SET NX, INCR, and compare-and-renew / compare-and-delete scripts on the lock key),
 * so it works on a single node, Sentinel or Cluster alike.
 */

export const LEADER_TTL_MS = 15_000;
export const LEADER_RENEW_MS = 5_000;

export const leaderKey = (kind: string, job: string): string => `proc:leader:${kind}:${job}`;
export const leaderFenceKey = (kind: string, job: string): string => `${leaderKey(kind, job)}:fence`;

/** The Redis calls the lock uses (ioredis-compatible). */
export interface LeaderRedis {
  set(key: string, value: string, px: 'PX', ms: number, nx: 'NX'): Promise<string | null>;
  incr(key: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface LeaderContext {
  kind: string;
  job: string;
  /** The fencing token of this term (strictly increasing per lock). */
  token: number;
  /** Aborted when leadership is lost or the handle stops. */
  signal: AbortSignal;
}

/** What `run` may return: a function that undoes what it started, called when leadership ends. */
export type LeaderCleanup = () => void | Promise<void>;
export type LeaderRun = (ctx: LeaderContext) => void | LeaderCleanup | Promise<void | LeaderCleanup>;

export interface LeaderHandle {
  readonly isLeader: boolean;
  /** The current term's token, null when not leader. */
  readonly token: number | null;
  /** Stops contending; a leader runs its cleanup and releases the lock. */
  stop(): Promise<void>;
}

export interface WithLeaderOptions {
  redis?: LeaderRedis;
  ttlMs?: number;
  renewMs?: number;
  /**
   * How long one lock call (SET NX, INCR, renew, release) may take before it counts as failed. Defaults to `renewMs`.
   * The shared client queues commands while it is disconnected and retries them forever, so without this bound a call
   * made during an outage would never settle and a partitioned leader would never notice it can no longer renew.
   */
  callTimeoutMs?: number;
  /** Called on every change of leadership (tests, metrics, logs). */
  onChange?: (leader: boolean, token: number | null) => void;
}

const RENEW = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

class LockCallTimeout extends Error {
  constructor(ms: number) { super(`leader lock call timed out after ${ms} ms`); }
}

/** Settles with `p`, or rejects after `ms` (the call itself may still complete later; every script compares the holder). */
function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new LockCallTimeout(ms)), ms); timer.unref?.(); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** One leadership term: its token, its signal, and what `run` handed back. */
interface Term {
  token: number;
  abort: AbortController;
  cleanup: LeaderCleanup | null;
  /** False once the term ended (stepped down); a cleanup that arrives after that runs at once. */
  current: boolean;
}

/**
 * Runs `run` while this process holds the leader lock of `kind`/`job`. Resolves after the first attempt (and, when it
 * won, after `run` resolved), so a caller can await it where it used to await the work itself.
 *
 * Renewal never waits for `run`: the lock calls go through their own serial chain and `run` executes beside it, so a
 * leader that takes longer than the TTL to start its work (a late acquisition starting every scheduler) keeps the lock
 * while it does. Every lock call is bounded by `callTimeoutMs`, so when Redis is unreachable the leader steps down
 * (aborting `signal`) before the lock it can no longer renew may have expired.
 */
export async function withLeader(kind: string, job: string, run: LeaderRun, opts: WithLeaderOptions = {}): Promise<LeaderHandle> {
  const client = opts.redis ?? (redis as unknown as LeaderRedis);
  const ttlMs = opts.ttlMs ?? LEADER_TTL_MS;
  const renewMs = opts.renewMs ?? LEADER_RENEW_MS;
  const callMs = opts.callTimeoutMs ?? renewMs;
  const key = leaderKey(kind, job);
  const holder = `${process.pid}:${randomBytes(6).toString('hex')}`;
  const label = `${kind}/${job}`;

  let term: Term | null = null;
  let lastSettled: Promise<void> = Promise.resolve();
  let validUntil = 0;
  let stopped = false;
  let busy: Promise<void> = Promise.resolve();
  let ticking = false;

  const changed = (leader: boolean) => { try { opts.onChange?.(leader, term?.token ?? null); } catch { /* observer */ } };
  const runCleanup = async (undo: LeaderCleanup | null) => {
    if (!undo) return;
    try { await undo(); } catch (e) { Logger.warn(`[process_host] leader ${label}: cleanup failed: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const release = async () => { try { await bounded(client.eval(RELEASE, 1, key, holder), callMs); } catch { /* the TTL frees it */ } };

  const stepDown = async (why: string, releaseLock: boolean): Promise<void> => {
    const ended = term;
    if (ended === null) return;
    Logger.info(`[process_host] leader ${label}: stepping down (${why})`);
    term = null;
    ended.current = false;
    ended.abort.abort();
    const undo = ended.cleanup;
    ended.cleanup = null;
    await runCleanup(undo);
    if (releaseLock) await release();
    changed(false);
  };

  const serial = (fn: () => Promise<void>): Promise<void> => (busy = busy.then(fn, fn));

  /** Starts `run` for a new term without waiting for it: the lock chain stays free to renew. */
  const begin = (t: Term): Promise<void> => {
    let out: Awaited<ReturnType<LeaderRun>>;
    const started = (async () => {
      try {
        out = await run({ kind, job, token: t.token, signal: t.abort.signal });
      } catch (e) {
        Logger.warn(`[process_host] leader ${label}: run failed, releasing: ${e instanceof Error ? e.message : String(e)}`);
        if (t.current) await serial(async () => { if (term === t) await stepDown('run failed', true); });
        return;
      }
      if (typeof out !== 'function') return;
      if (t.current) t.cleanup = out;
      else await runCleanup(out); // the term ended while `run` was still starting: undo what it started now
    })();
    lastSettled = started;
    return started;
  };

  /**
   * One lock step: renew while leading, otherwise try to acquire. Returns the new term's run when it just won, boxed:
   * an async function returning the bare promise would adopt it and hold the lock chain until `run` settled.
   */
  const attempt = async (): Promise<{ running: Promise<void> } | null> => {
    if (stopped) return null;
    const now = Date.now();
    if (term !== null) {
      try {
        const ok = Number(await bounded(client.eval(RENEW, 1, key, holder, ttlMs), callMs));
        if (ok === 1) { validUntil = now + ttlMs; return null; }
        await stepDown('lock lost', false);
      } catch {
        // Redis unreachable (or too slow): keep leading while the lock we hold is certainly still ours, then give up
        if (Date.now() >= validUntil - renewMs - callMs) await stepDown('lock could not be renewed', false);
      }
      return null;
    }
    let won = false;
    try {
      won = (await bounded(client.set(key, holder, 'PX', ttlMs, 'NX'), callMs)) === 'OK';
    } catch {
      return null;
    }
    if (!won) return null;
    validUntil = now + ttlMs;
    let token: number;
    try {
      token = await bounded(client.incr(leaderFenceKey(kind, job)), callMs);
    } catch {
      await release();
      return null;
    }
    if (stopped) { await release(); return null; }
    const t: Term = { token, abort: new AbortController(), cleanup: null, current: true };
    term = t;
    Logger.info(`[process_host] leader ${label}: acquired (token ${token})`);
    changed(true);
    return { running: begin(t) };
  };

  // The first attempt resolves only after `run` did (when it won), as the code it wraps used to; renewal starts now.
  const first = await new Promise<{ running: Promise<void> } | null>((resolve) => {
    void serial(async () => { try { resolve(await attempt()); } catch { resolve(null); } });
  });
  const timer = setInterval(() => {
    if (ticking) return; // the previous step is still waiting on Redis: do not pile up calls
    ticking = true;
    void serial(async () => { await attempt(); }).finally(() => { ticking = false; });
  }, renewMs);
  timer.unref?.();
  if (first) await first.running;

  return {
    get isLeader() { return term !== null; },
    get token() { return term?.token ?? null; },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await serial(() => stepDown('stopped', true));
      await lastSettled; // a `run` still starting finishes, and its cleanup runs, before stop resolves
    },
  };
}
