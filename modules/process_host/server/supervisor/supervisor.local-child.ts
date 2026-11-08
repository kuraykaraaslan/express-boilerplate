import { childIpc } from './supervisor.child-ipc';
import { runAsChild, type ChildContext } from './supervisor.child';
import { createDrainSequence, shutdownGraceFrom, type DrainInfo } from './supervisor.drain';
import { procEnv, type EnvSource } from './supervisor.env';
import type { HealthReport } from './supervisor.types';

/**
 * The child side of a credential-less kind (07 task 7: the script host, the plugin host), the counterpart of
 * `startProcessHost`'s child mode for a process that cannot load it (no env schema, no logger, no Redis):
 *
 * - `start` runs the kind's body (it listens on the shared service port: under a `node:cluster` supervisor the port is shared);
 * - health goes to the supervisor every 5 s, the signal every `signal.everyMs` (default 5 s), the CPU through `runAsChild`;
 * - a `drain` request runs `drain` — stop taking work, finish what is in flight — then acknowledges with `drained` and
 *   exits; losing the supervisor drains the same way (no orphan lingers), except under a `node:cluster` supervisor (the
 *   default here), where Node exits the worker at once on an unexpected disconnect. This is the same drain protocol as
 *   `startProcessHost` (`createDrainSequence`, `supervisor.drain.ts`): a `scale-down` gets the kind's grace (`DrainInfo`),
 *   a `shutdown` or a lost supervisor is bounded by `SHUTDOWN_GRACE_MS` (default 10 s), and a `shutdown` during a
 *   scale-down escalates it (`info.signal` aborts, the shorter bound starts).
 *
 * Outside a supervisor `start` runs exactly as before and nothing else is wired: the entry keeps its own SIGTERM handling.
 */
export const LOCAL_HEALTH_REPORT_MS = 5_000;
export const LOCAL_SIGNAL_REPORT_MS = 5_000;

export interface LocalChildOptions {
  kind: string;
  start: (ctx: ChildContext) => Promise<void> | void;
  /** Stop taking new work and resolve once the work in flight has finished (sooner once `info.signal` aborts, if it can). */
  drain: (info: DrainInfo) => Promise<void>;
  health?: () => HealthReport;
  signal?: { everyMs?: number; read: () => number | Promise<number> };
  /** Default `process.exit`. */
  exit?: (code: number) => void;
  /** Where `SHUTDOWN_GRACE_MS` is read from (default `process.env`). */
  env?: EnvSource;
}

export async function runLocalChild(o: LocalChildOptions): Promise<ChildContext> {
  const exit = o.exit ?? ((code: number) => process.exit(code));
  return runAsChild(o.kind, async (ctx) => {
    await o.start(ctx);
    if (!ctx.isChild) return ctx;
    const ipc = childIpc();
    const report = () => {
      let h: HealthReport = { status: 'ok' };
      try { if (o.health) h = o.health(); } catch (e) { h = { status: 'fail', detail: e instanceof Error ? e.message : String(e) }; }
      ipc.send({ type: 'health', report: h });
    };
    report();
    const beat = setInterval(report, LOCAL_HEALTH_REPORT_MS);
    beat.unref?.();
    const stopSignal = o.signal ? ctx.reportSignalEvery(o.signal.everyMs ?? LOCAL_SIGNAL_REPORT_MS, o.signal.read) : () => undefined;
    const sequence = createDrainSequence({
      kind: o.kind,
      shutdownGraceMs: shutdownGraceFrom(o.env ?? procEnv()),
      run: async (info) => {
        clearInterval(beat);
        stopSignal();
        await o.drain(info);
      },
      done: async () => {
        await ipc.sendAsync({ type: 'drained' });
        exit(0);
      },
      expired: () => exit(0),
    });
    ipc.onDrain((request) => sequence.request('drain', request));
    ipc.onDisconnect(() => { void sequence.request('supervisor gone'); });
    return ctx;
  });
}
