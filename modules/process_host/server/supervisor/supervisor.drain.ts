import type { DrainRequest } from './supervisor.child-ipc';
import { supLog, type SupervisorLogger } from './supervisor.log';

/**
 * The child's half of the **one** drain protocol of process_host (07 task 7), shared by `startProcessHost` (every kind that
 * holds Redis: worker, automation-worker, ws, telephony-gateway) and `runLocalChild` (the credential-less script and
 * plugin hosts). Pure Node (no env schema, logger or Redis), so the local child can load it.
 *
 * - A **signal** (SIGTERM/SIGINT, a lost supervisor) or a supervisor **shutdown** drains bounded by `shutdownGraceMs`
 *   (`SHUTDOWN_GRACE_MS`, default 10 s): when it runs out the process exits with work still open.
 * - A supervisor **scale-down** may take the kind's grace instead (`graceMs`, at least `shutdownGraceMs`), or no bound at
 *   all with `force: false` (telephony waits for its last call).
 * - **Escalation**: a SIGTERM or a shutdown during a scale-down drain finishes it now: `DrainInfo.signal` aborts (the
 *   kind's long wait, e.g. `drainUntil`, returns) and the `shutdownGraceMs` bound starts.
 *
 * The supervisor's half (reason, grace, `force`, escalating a scale-down slot on a group shutdown) is `Supervisor.drain`.
 */

export type HostDrainReason = 'signal' | 'scale-down' | 'shutdown';

export interface DrainInfo {
  /** `signal`: SIGTERM/SIGINT or a lost supervisor; `scale-down`/`shutdown`: a supervisor's request. */
  reason: HostDrainReason;
  /** The supervisor's grace for a scale-down (the process exits at the latest then, unless `force` is false). */
  graceMs?: number;
  /** False: nothing cuts this scale-down short except an escalation. */
  force?: boolean;
  /** Aborts when a long (scale-down) drain is escalated by a SIGTERM or a shutdown: finish now, as on SIGTERM. */
  signal: AbortSignal;
}

/** The default bound of a plain drain when the caller has no `SHUTDOWN_GRACE_MS` (the env schema default). */
export const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

/**
 * How much longer than its children a supervisor gives a shutdown. A child bounds its shutdown drain by
 * `SHUTDOWN_GRACE_MS`; the supervisor must outlive that (it sends the drain a moment after the signal, and waits for the
 * exit), and its SIGTERM → SIGKILL escalation must not cut a child short that is still inside its own grace.
 */
export const SUPERVISOR_SHUTDOWN_MARGIN_MS = 5_000;

/** The supervisor's own shutdown bound, and its SIGTERM → SIGKILL delay: the children's grace plus the margin. */
export const supervisorShutdownLimit = (shutdownGraceMs: number): number => shutdownGraceMs + SUPERVISOR_SHUTDOWN_MARGIN_MS;

export interface DrainSequenceOptions {
  kind: string;
  /** The bound of a signal / shutdown drain and of an escalated scale-down (`SHUTDOWN_GRACE_MS`). */
  shutdownGraceMs: number;
  /** The drain: stop taking work, finish (or, once `info.signal` aborts, cut short) what is in flight. A throw is logged. */
  run: (info: DrainInfo) => Promise<void>;
  /** After `run`: acknowledge (`drained`) and exit. Not called when the bound ran out first. */
  done: () => Promise<void> | void;
  /** The bound ran out before `run` finished: exit with work still open. */
  expired: () => void;
  log?: SupervisorLogger;
}

export interface DrainSequence {
  /** Starts the drain (`signal` names the trigger in the log; `request` is a supervisor's drain), or escalates a running one. */
  request(signal: string, request?: DrainRequest): Promise<void>;
  /** True once a drain has started. */
  readonly started: boolean;
}

export function createDrainSequence(o: DrainSequenceOptions): DrainSequence {
  const log = o.log ?? supLog;
  let started = false;
  let longDrain = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const abort = new AbortController();

  const arm = (ms: number | null): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (ms === null) return;
    timer = setTimeout(() => {
      log.warn(`[${o.kind}] grace period elapsed — exiting with work still open`);
      o.expired();
    }, ms);
    timer.unref?.();
  };

  const request = async (signal: string, req?: DrainRequest): Promise<void> => {
    const reason: HostDrainReason = req?.reason ?? (signal === 'drain' ? 'shutdown' : 'signal');
    if (started) {
      // a SIGTERM or a shutdown during a long scale-down drain: finish it now, bounded as on SIGTERM
      if (longDrain && reason !== 'scale-down') {
        longDrain = false;
        log.info(`[${o.kind}] ${signal} received during a scale-down drain — finishing now`);
        arm(o.shutdownGraceMs);
        abort.abort();
      }
      return;
    }
    started = true;
    longDrain = reason === 'scale-down';
    log.info(`[${o.kind}] ${signal} received — draining${longDrain ? ` (scale-down, grace ${req?.force === false ? 'unbounded' : `${req?.graceMs ?? o.shutdownGraceMs} ms`})` : ''}`);
    arm(longDrain
      ? (req?.force === false ? null : Math.max(o.shutdownGraceMs, req?.graceMs ?? 0))
      : o.shutdownGraceMs);
    try {
      await o.run({
        reason,
        ...(req?.graceMs !== undefined && { graceMs: req.graceMs }),
        ...(req?.force !== undefined && { force: req.force }),
        signal: abort.signal,
      });
    } catch (error) {
      log.error(`[${o.kind}] drain failed: ${error}`);
    }
    arm(null);
    await o.done();
  };

  return { request, get started() { return started; } };
}

/** `SHUTDOWN_GRACE_MS` from a raw environment (the local child has no env schema). */
export function shutdownGraceFrom(env: Record<string, string | undefined>): number {
  const n = Number(env.SHUTDOWN_GRACE_MS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SHUTDOWN_GRACE_MS;
}
