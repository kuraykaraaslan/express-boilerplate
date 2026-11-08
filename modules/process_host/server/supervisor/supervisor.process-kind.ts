import { startProcessHost, type ProcessHostOptions } from '../process-host';
import { runAsChild, type ChildContext } from './supervisor.child';
import { procEnv, type EnvSource } from './supervisor.env';
import { supLog } from './supervisor.log';
import { shouldSupervise, type PolicyOverrides } from './supervisor.policy';
import { startSupervisor, type StartSupervisorOptions } from './supervisor.service';

/**
 * One entry, supervised or not (07 task 7), for a kind that starts through `startProcessHost` (it holds Redis): the
 * pattern the automation worker introduced, generic, so `scripts/worker.ts` (and later kinds) need only their wiring.
 *
 * - `PROC_<KIND>_ENABLED=true` and not a child: this process becomes the supervisor (`startSupervisor`): it runs none of
 *   the kind's work, forks `entry` and scales the children by the kind's policy; its `/healthz` and `/metrics` on `port`
 *   cover the group. `start` is never called here, so the supervisor loads none of the kind's modules if `start` imports
 *   them lazily.
 * - otherwise (a supervised child, or supervision off): `startProcessHost` (child mode under a supervisor: no port, IPC
 *   health, metrics and drain), then `start`, then the signal report every `signal.everyMs` (only under a supervisor).
 * - `perNode` runs once per node: in the supervisor when supervised, in the single process otherwise, never in a child
 *   (the worker relays the node's local supervisors into the Scaling view there, `supervisor.relay.ts`).
 */
export type ProcessKindRole = 'supervisor' | 'child' | 'single';

export interface ProcessKindOptions {
  kind: string;
  port: number;
  /** The file the supervisor forks: the entry itself (`process.argv[1]`, `run-sidecar.mjs` in an image). */
  entry: string;
  version?: string;
  env?: EnvSource;
  /** Code overrides of the kind's policy (env still wins). */
  policy?: PolicyOverrides;
  /** The process host of the kind's process (health, metrics, info, the drain). */
  host: Omit<ProcessHostOptions, 'kind' | 'port' | 'version'>;
  /** The kind's work, after the host is up. */
  start: (ctx: ChildContext) => Promise<void>;
  /** The child's raw scaling signal (the policy's unit); NaN or a throw skips a sample. */
  signal?: { everyMs?: number; read: () => number | Promise<number> };
  /**
   * Duties of the node rather than of a child (once per node: the supervisor, or the single process), after it started.
   * A failure is logged and does not stop the process.
   */
  perNode?: (role: 'supervisor' | 'single') => Promise<void> | void;
  /** Extra options of the supervisor (seams, child env). */
  supervisor?: Partial<Omit<StartSupervisorOptions, 'kind' | 'entry' | 'port' | 'policy'>>;
}

export const SIGNAL_REPORT_MS = 5_000;

export async function runProcessKind(o: ProcessKindOptions): Promise<ProcessKindRole> {
  const env = o.env ?? procEnv();
  if (shouldSupervise(o.kind, env)) {
    await startSupervisor({ ...o.supervisor, kind: o.kind, entry: o.entry, port: o.port, version: o.version, env, policy: o.policy });
    await runPerNode(o, 'supervisor');
    return 'supervisor';
  }
  return runAsChild(o.kind, async (ctx) => {
    await startProcessHost({ ...o.host, kind: o.kind, port: o.port, version: o.version });
    await o.start(ctx);
    if (o.signal) ctx.reportSignalEvery(o.signal.everyMs ?? SIGNAL_REPORT_MS, o.signal.read);
    if (!ctx.isChild) await runPerNode(o, 'single');
    return ctx.isChild ? 'child' : 'single';
  });
}

async function runPerNode(o: ProcessKindOptions, role: 'supervisor' | 'single'): Promise<void> {
  if (!o.perNode) return;
  try {
    await o.perNode(role);
  } catch (error) {
    supLog.warn(`[process_host] ${o.kind}: per-node duties failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
