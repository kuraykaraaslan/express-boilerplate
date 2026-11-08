import { randomBytes } from 'node:crypto';
import Logger from '@kuraykaraaslan-labs/logger';
import { startProcessHost, type ProcessHost } from '../process-host';
import { BudgetLedger, childBudget, readMachineLimits, reserveFromEnv, type ChildBudget, type MachineLimits } from './supervisor.budget';
import { Supervisor, type LedgerLike, type SpawnChild } from './supervisor.core';
import { spawnChildren } from './supervisor.cluster';
import { aggregatedMetrics, bindSupervisorMetrics } from './supervisor.metrics';
import { resolvePolicy, type PolicyOverrides } from './supervisor.policy';
import { redisSupervisorPublisher, type SupervisorPublisher } from './supervisor.publisher';
import type { SupervisorEvent } from './supervisor.types';
import { procEnv, type EnvSource } from './supervisor.env';
import { setSupervisorLogger } from './supervisor.log';
import { shutdownGraceFrom, supervisorShutdownLimit } from './supervisor.drain';

export interface StartSupervisorOptions {
  /** The process kind (`automation-worker`, `worker`, `ws` …). */
  kind: string;
  /** The child entry file (usually the calling entry itself: it runs `runAsChild` when `PROC_CHILD=1`). */
  entry: string;
  args?: string[];
  /** Node flags of the children; defaults to this process's (so a `tsx` parent forks `tsx` children). */
  execArgv?: string[];
  /** Extra env for every child. */
  childEnv?: Record<string, string>;
  /**
   * Fork the children through Node's `cluster` module, with this supervisor as the cluster primary (ws, 07 task 7): a
   * child's `server.listen(port)` then shares one listening port with its siblings and the primary hands each new
   * connection to the next child (round-robin, `SCHED_RR`). The primary itself must not listen on that port, so `port`
   * (the supervisor's health/metrics port) has to be a different one. A child that drains closes its server: the primary
   * stops routing to it while its existing connections stay. Everything else (IPC, drain, restart, scaling) is the same.
   * The implementation is `clusterSpawn` (`supervisor.cluster.ts`), the same one the local supervisor uses.
   */
  cluster?: boolean;
  /** The supervisor's health/metrics port (the kind's usual health port; children open none). */
  port: number;
  version?: string;
  /** Code overrides of the kind's defaults; env (`PROC_<KIND>_*`) still wins. `signal` replaces the children's reports. */
  policy?: PolicyOverrides;
  /** Where `PROC_*` settings are read from (default `process.env`). */
  env?: EnvSource;
  onEvent?: (event: SupervisorEvent) => void;
  // seams (tests)
  spawn?: SpawnChild;
  limits?: MachineLimits;
  ledger?: LedgerLike;
  publisher?: SupervisorPublisher;
  installSignalHandlers?: boolean;
  exit?: (code: number) => void;
}

export interface RunningSupervisor {
  nodeId: string;
  supervisor: Supervisor;
  host: ProcessHost;
  budget: ChildBudget;
  /** Drains the children and exits (what SIGTERM does). */
  shutdown: (signal: string) => Promise<void>;
}

/**
 * Starts the supervisor of one kind on this machine (07 task 1): the parent process that runs no domain work, forks
 * `min` children of `entry` with `PROC_CHILD=1`, `PROC_CHILD_INDEX`, `PROC_KIND` and `PROC_SUPERVISOR_NODE`, scales
 * them by the kind's signal within the budget, restarts crashed ones, and serves one `/healthz` (worst child wins)
 * and one `/metrics` (its series + the children's, aggregated) through `startProcessHost` on `port`. Its state and
 * decisions go to `proc:sup:<kind>:<nodeId>` and `proc:sup:events:<kind>:<nodeId>`.
 *
 * SIGTERM drains every child (each through its own drain), then the supervisor exits.
 */
export async function startSupervisor(opts: StartSupervisorOptions): Promise<RunningSupervisor> {
  // the core logs through a seam (so the credential-less local supervisor can run it); here the platform logger
  setSupervisorLogger(Logger);
  const env = opts.env ?? procEnv();
  const nodeId = randomBytes(4).toString('hex');
  const resolved = resolvePolicy(opts.kind, opts.policy, env);
  const limits = opts.limits ?? readMachineLimits();
  const budget = childBudget(limits, reserveFromEnv(env));
  const shutdownGraceMs = shutdownGraceFrom(env);

  const childEnvOf = (index: number): Record<string, string | undefined> => ({
    ...opts.childEnv,
    PROC_CHILD: '1',
    PROC_CHILD_INDEX: String(index),
    PROC_KIND: opts.kind,
    PROC_SUPERVISOR_NODE: nodeId,
  });
  // the one spawn of process_host (`supervisor.cluster.ts`): cluster workers sharing the service port, or plain forks
  const spawn: SpawnChild = opts.spawn ?? spawnChildren({ entry: opts.entry, args: opts.args, execArgv: opts.execArgv, env: childEnvOf, cluster: opts.cluster === true });

  // eslint-disable-next-line prefer-const
  let sup: Supervisor;
  const supervisor = new Supervisor({
    policy: { ...resolved, signal: resolved.signal ?? (async () => sup.aggregatedSignal()) },
    spawn,
    budget,
    ledger: opts.ledger ?? new BudgetLedger(env.PROC_BUDGET_DIR || undefined),
    publisher: opts.publisher ?? redisSupervisorPublisher(),
    nodeId,
    shutdownGraceMs,
  });
  sup = supervisor;
  if (opts.onEvent) supervisor.onEvent(opts.onEvent);

  // children first, so the host's first beat and probe already see them starting
  supervisor.start();
  let prom: unknown = null;
  let host: ProcessHost;
  try {
    host = await startProcessHost({
      kind: opts.kind,
      nodeId,
      child: false,
      port: opts.port,
      version: opts.version,
      health: () => supervisor.health(),
      info: () => ({ role: 'supervisor', children: supervisor.count(), max: supervisor.max, status: supervisor.status(), ...(opts.cluster && { cluster: true }) }),
      metrics: (registry, p) => { prom = p; bindSupervisorMetrics(registry, p, supervisor); },
      metricsBody: (own) => aggregatedMetrics(own, prom, supervisor),
      onDrain: () => supervisor.stop(),
      // the children bound their shutdown drain by SHUTDOWN_GRACE_MS: the supervisor outlives them by a margin, and
      // drains them at once instead of after the registry withdrawal (which waits on Redis, possibly for an outage)
      shutdownGraceMs: supervisorShutdownLimit(shutdownGraceMs),
      withdrawFirst: false,
      installSignalHandlers: opts.installSignalHandlers,
      exit: opts.exit,
    });
  } catch (error) {
    await supervisor.stop();
    throw error;
  }

  Logger.info(`[process_host] ${opts.kind} supervisor ${nodeId}: budget ${budget.cpu} cpu / ${budget.memoryMb} MB (${budget.source}), min ${resolved.min}, max ${supervisor.max}`);
  return { nodeId, supervisor, host, budget, shutdown: host.shutdown };
}

