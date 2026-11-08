import { childIpc } from './supervisor.child-ipc';
import { isChildProcess } from './supervisor.policy';
import { procEnv } from './supervisor.env';
import type { HealthReport } from './supervisor.types';

/** How often a supervised child reports its CPU use (the scale-down CPU condition, 07 task 5). */
export const CPU_REPORT_MS = 5_000;

/**
 * A sampler of this process's CPU use since the previous call (the first call: since the sampler was made), in percent of
 * one core: user + system time over wall time, so above 100 when libuv's threads or several isolates run in parallel.
 */
export function cpuSampler(
  usage: () => NodeJS.CpuUsage = () => process.cpuUsage(),
  clockUs: () => number = () => performance.now() * 1_000,
): () => number {
  let base = usage();
  let at = clockUs();
  return () => {
    const cur = usage();
    const now = clockUs();
    const wall = now - at;
    const busy = cur.user - base.user + (cur.system - base.system);
    base = cur;
    at = now;
    return wall > 0 ? Math.max(0, (busy / wall) * 100) : 0;
  };
}

export interface ChildContext {
  /** True when a supervisor started this process (`PROC_CHILD=1` with an IPC channel). */
  isChild: boolean;
  kind: string;
  /** The child's slot (`PROC_CHILD_INDEX`), 0 outside a supervisor. */
  index: number;
  /** The supervisor's node id, when supervised. */
  supervisorNodeId: string | null;
  /** Reports this child's raw scaling signal (the supervisor combines the children's by the policy's `aggregate`). */
  reportSignal: (value: number) => void;
  /** Reports health outside the process-host beat (rarely needed: `startProcessHost` in child mode already does). */
  reportHealth: (report: HealthReport) => void;
  /** Runs `fn` every `ms` and reports its value as the signal (returns a stop function). A throw or NaN is skipped. */
  reportSignalEvery: (ms: number, fn: () => Promise<number> | number) => () => void;
}

/**
 * Runs the process body of a kind, supervised or not (07 "Roles"). In a supervisor's child it wires the IPC reports
 * and tells the supervisor `ready` once `start` resolved; outside one the context's reports are no-ops and `start`
 * runs exactly as before, so an entry can always go through this:
 *
 * ```ts
 * if (shouldSupervise('automation-worker')) {
 *   await startSupervisor({ kind: 'automation-worker', entry: fileURLToPath(import.meta.url), port, policy: { naturalCeiling: partitions } });
 * } else {
 *   await runAsChild('automation-worker', async (ctx) => {
 *     await startProcessHost({ kind: 'automation-worker', port, onDrain, health });   // child mode: no port, IPC health and drain
 *     ctx.reportSignalEvery(5_000, () => host.lagSeconds());
 *   });
 * }
 * ```
 */
export async function runAsChild<T>(kind: string, start: (ctx: ChildContext) => Promise<T> | T): Promise<T> {
  const env = procEnv();
  const supervised = isChildProcess(env) && typeof process.send === 'function';
  const ipc = supervised ? childIpc() : null;
  const reportSignal = (value: number) => {
    if (ipc && Number.isFinite(value)) ipc.send({ type: 'signal', value });
  };
  const ctx: ChildContext = {
    isChild: supervised,
    kind,
    index: supervised ? Number(env.PROC_CHILD_INDEX ?? 0) : 0,
    supervisorNodeId: supervised ? (env.PROC_SUPERVISOR_NODE ?? null) : null,
    reportSignal,
    reportHealth: (report) => { ipc?.send({ type: 'health', report }); },
    reportSignalEvery: (ms, fn) => {
      if (!ipc) return () => undefined;
      const t = setInterval(() => {
        void (async () => {
          try { reportSignal(await fn()); } catch { /* skipped sample */ }
        })();
      }, ms);
      t.unref?.();
      return () => clearInterval(t);
    },
  };
  const out = await start(ctx);
  if (ipc) {
    ipc.send({ type: 'ready' });
    // every supervised child reports its CPU, whatever its kind: a policy with `downCpuBelow` needs it to scale down
    const cpu = cpuSampler();
    const t = setInterval(() => { ipc.send({ type: 'cpu', value: Math.round(cpu() * 10) / 10 }); }, CPU_REPORT_MS);
    t.unref?.();
  }
  return out;
}

export interface DrainUntilOptions {
  /** Give up waiting after this long (resolves `timeout`). Unset: wait as long as it takes (telephony: the last call). */
  maxMs?: number;
  /** Stops the wait early (resolves `aborted`): the `DrainInfo.signal` of an escalated scale-down. */
  signal?: AbortSignal;
  /** How often `isIdle` is checked (default 1 s). */
  pollMs?: number;
}

/**
 * The waiting half of a long drain (07 task 7): resolves once `isIdle()` holds (`idle`), the time is up (`timeout`) or
 * the drain is escalated (`aborted`). ws waits for its sockets to leave within the grace; telephony waits for 0 active
 * calls with no time limit.
 */
export function drainUntil(isIdle: () => boolean, opts: DrainUntilOptions = {}): Promise<'idle' | 'timeout' | 'aborted'> {
  return new Promise((resolve) => {
    const started = Date.now();
    const pollMs = opts.pollMs ?? 1_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: 'idle' | 'timeout' | 'aborted') => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const onAbort = () => finish('aborted');
    if (opts.signal?.aborted) { resolve('aborted'); return; }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const check = () => {
      if (isIdle()) { finish('idle'); return; }
      const left = opts.maxMs === undefined ? pollMs : opts.maxMs - (Date.now() - started);
      if (left <= 0) { finish('timeout'); return; }
      timer = setTimeout(check, Math.min(pollMs, left));
    };
    check();
  });
}

/** The part of `http.Server` an HTTP drain needs (structural, so tests and other servers fit). */
export interface DrainableHttpServer {
  on(event: 'request', listener: (req: unknown, res: DrainableResponse) => void): unknown;
  prependListener(event: 'request', listener: (req: unknown, res: DrainableResponse) => void): unknown;
  close(callback?: (err?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

/** The part of `http.ServerResponse` an HTTP drain needs. */
export interface DrainableResponse {
  shouldKeepAlive: boolean;
  readonly headersSent: boolean;
  once(event: 'close' | 'finish', listener: () => void): unknown;
}

export interface HttpDrainOptions {
  /** Other work that must finish too (a sandbox call, a scheduled batch): the drain waits until it holds. */
  isIdle?: () => boolean;
  /** Stop waiting after this long and cut the connections that are left. Unset: wait (the drain sequence's own bound exits). */
  maxMs?: number;
  /** Escalation (`DrainInfo.signal`): cut the connections that are left now. */
  signal?: AbortSignal;
  /** How often `isIdle` is checked (default 25 ms). */
  pollMs?: number;
}

export interface HttpDrain {
  /** Requests received and not answered yet. */
  inflight(): number;
  /** True once `drain` was called. */
  readonly draining: boolean;
  /**
   * Takes the server out of service without cutting anything off: the listener closes (no new connection), idle
   * keep-alive connections close, every response from now on (including one already being produced, and a request that
   * still arrives on a busy keep-alive connection) carries `Connection: close`, and its connection closes after it.
   * Resolves once every request was answered, `isIdle` holds and the server's `close` callback ran (the last connection
   * ended); after `maxMs` or an abort the connections left are closed (`closeAllConnections`). Idempotent.
   */
  drain(opts?: HttpDrainOptions): Promise<void>;
}

/**
 * The HTTP half of a child drain (07 task 7), shared by the credential-less hosts (the script host, the plugin host). Call
 * it right after creating the server, before it listens, so every response is tracked.
 */
export function trackHttpDrain(server: DrainableHttpServer): HttpDrain {
  const active = new Set<DrainableResponse>();
  let draining = false;
  let done: Promise<void> | null = null;
  const closeIdleSoon = () => setImmediate(() => server.closeIdleConnections?.());
  // first, so the flag is set before any handler writes a header
  server.prependListener('request', (_req, res) => {
    active.add(res);
    res.once('close', () => { active.delete(res); });
    if (draining) {
      res.shouldKeepAlive = false;
      res.once('finish', closeIdleSoon);
    }
  });

  const drain = (opts: HttpDrainOptions = {}): Promise<void> => {
    done ??= (async () => {
      draining = true;
      for (const res of active) {
        if (!res.headersSent) res.shouldKeepAlive = false;
        // a response whose headers already said keep-alive: its connection goes idle afterwards, close it then
        res.once('finish', closeIdleSoon);
      }
      const closed = new Promise<void>((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
      });
      server.closeIdleConnections?.();
      const pollMs = opts.pollMs ?? 25;
      const settled = (async () => {
        while (active.size > 0 || (opts.isIdle && !opts.isIdle())) await new Promise((r) => setTimeout(r, pollMs));
        await closed;
      })();
      const outcome = await Promise.race([
        settled.then(() => 'done' as const),
        new Promise<'cut'>((resolve) => {
          if (opts.signal?.aborted) { resolve('cut'); return; }
          opts.signal?.addEventListener('abort', () => resolve('cut'), { once: true });
          if (opts.maxMs !== undefined) setTimeout(() => resolve('cut'), opts.maxMs).unref?.();
        }),
      ]);
      if (outcome === 'cut') server.closeAllConnections?.();
    })();
    return done;
  };

  return { inflight: () => active.size, get draining() { return draining; }, drain };
}
