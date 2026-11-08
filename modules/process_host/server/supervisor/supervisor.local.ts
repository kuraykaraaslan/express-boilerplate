import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { BudgetLedger, childBudget, readMachineLimits, reserveFromEnv, type ChildBudget, type MachineLimits } from './supervisor.budget';
import { spawnChildren } from './supervisor.cluster';
import { Supervisor, type LedgerLike, type SpawnChild } from './supervisor.core';
import { procEnv, type EnvSource } from './supervisor.env';
import { supLog } from './supervisor.log';
import { bearerMatches } from './supervisor.bearer';
import { shutdownGraceFrom } from './supervisor.drain';
import { aggregatedMetrics, bindSupervisorMetrics } from './supervisor.metrics';
import { resolvePolicy, type PolicyOverrides } from './supervisor.policy';
import type { SupervisorPublisher } from './supervisor.publisher';
import type { MetricsRegistryLike } from '../process-host';
import type { SignalSample, SupervisorEvent, SupervisorStateV1 } from './supervisor.types';

/**
 * The **local** supervisor (07 task 7): the same core as `startSupervisor` (fork, scale, restart, drain) for a process kind
 * that must stay credential-less — the automation script host and the plugin host hold no `REDIS_URL` and no
 * `DATABASE_URL` on purpose (a script or plugin that escaped its isolate finds nothing to use). So this file loads neither
 * the env schema, the logger nor Redis (only Node built-ins and the pure supervisor files):
 *
 * - its children are `node:cluster` workers by default (`cluster`, the same `clusterSpawn` as `startSupervisor({ cluster: true })`
 *   for ws), so they all serve the kind's one port (4012, 4500);
 * - it serves `GET /healthz` (group health, worst child wins), `GET /metrics` (`METRICS_ENABLED=true` and prom-client
 *   installed; bearer `METRICS_SECRET` when set) and `GET /supervisor` on its own port;
 * - its state, decision log and last-hour signal stay in memory (a `SupervisorPublisher` that writes nowhere else) and are
 *   served as JSON on `GET /supervisor`: `{ state: SupervisorStateV1, events: SupervisorEvent[], signal: SignalSample[],
 *   health, port, version }`, lists newest first, the same shapes the Redis-backed supervisor writes to `proc:sup:*`. The
 *   Scaling view reads Redis: the worker on the same node relays this JSON into `proc:sup:*` and `proc:nodes:<kind>`
 *   (`supervisor.relay.ts`), so these kinds appear there like every other supervisor.
 *
 * SIGTERM drains every child and exits.
 */

export const MEMORY_EVENTS_MAX = 200;
export const MEMORY_SIGNAL_MAX = 720;

export interface SupervisorSnapshot {
  state: SupervisorStateV1 | null;
  /** Newest first. */
  events: SupervisorEvent[];
  /** Newest first. */
  signal: SignalSample[];
}

export interface MemorySupervisorPublisher extends SupervisorPublisher {
  snapshot(): SupervisorSnapshot;
}

/** A publisher that keeps the state, the last 200 decisions and the last-hour signal in memory. */
export function memorySupervisorPublisher(): MemorySupervisorPublisher {
  let state: SupervisorStateV1 | null = null;
  const events: SupervisorEvent[] = [];
  const signal: SignalSample[] = [];
  return {
    async state(s) { state = s; },
    async event(_kind, _nodeId, e) {
      events.unshift(e);
      if (events.length > MEMORY_EVENTS_MAX) events.length = MEMORY_EVENTS_MAX;
    },
    async signal(_kind, _nodeId, sample) {
      signal.unshift(sample);
      if (signal.length > MEMORY_SIGNAL_MAX) signal.length = MEMORY_SIGNAL_MAX;
    },
    async clear() { state = null; },
    snapshot: () => ({ state, events: [...events], signal: [...signal] }),
  };
}

export interface StartLocalSupervisorOptions {
  kind: string;
  /** The child entry (the calling entry itself: it runs the kind's body when `PROC_CHILD=1`). */
  entry: string;
  args?: string[];
  execArgv?: string[];
  childEnv?: Record<string, string>;
  /** The supervisor's own port (`/healthz`, `/metrics`, `/supervisor`); never the kind's service port. */
  port: number;
  /** Interface of that port (default all). */
  bind?: string;
  version?: string;
  /**
   * Children share the kind's listening port through `node:cluster`, this supervisor being the cluster primary (default true,
   * unlike `startSupervisor`); false forks plain children. Same implementation as `startSupervisor({ cluster: true })`.
   */
  cluster?: boolean;
  policy?: PolicyOverrides;
  env?: EnvSource;
  onEvent?: (event: SupervisorEvent) => void;
  // seams (tests)
  spawn?: SpawnChild;
  limits?: MachineLimits;
  ledger?: LedgerLike;
  installSignalHandlers?: boolean;
  exit?: (code: number) => void;
}

export interface RunningLocalSupervisor {
  nodeId: string;
  supervisor: Supervisor;
  server: Server;
  budget: ChildBudget;
  snapshot: () => SupervisorSnapshot;
  /** Drains the children, closes the port and exits (what SIGTERM does). */
  shutdown: (signal: string) => Promise<void>;
}

async function loadRegistry(kind: string, env: EnvSource, sup: Supervisor): Promise<{ registry: MetricsRegistryLike; prom: unknown } | null> {
  if (env.METRICS_ENABLED !== 'true') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prom: any = await import('prom-client' as string);
    const registry = new prom.Registry();
    registry.setDefaultLabels({ process_kind: kind });
    prom.collectDefaultMetrics({ register: registry, prefix: 'app_' });
    bindSupervisorMetrics(registry, prom, sup);
    return { registry, prom };
  } catch (error) {
    supLog.warn(`[process_host] ${kind} supervisor: metrics unavailable (install prom-client): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function startLocalSupervisor(opts: StartLocalSupervisorOptions): Promise<RunningLocalSupervisor> {
  const env = opts.env ?? procEnv();
  const nodeId = randomBytes(4).toString('hex');
  const resolved = resolvePolicy(opts.kind, opts.policy, env);
  const limits = opts.limits ?? readMachineLimits();
  const budget = childBudget(limits, reserveFromEnv(env));
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  const childEnvOf = (index: number): Record<string, string | undefined> => ({
    ...opts.childEnv,
    PROC_CHILD: '1',
    PROC_CHILD_INDEX: String(index),
    PROC_KIND: opts.kind,
    PROC_SUPERVISOR_NODE: nodeId,
  });
  const spawn: SpawnChild = opts.spawn ?? spawnChildren({ entry: opts.entry, args: opts.args, execArgv: opts.execArgv, env: childEnvOf, cluster: opts.cluster !== false });

  const publisher = memorySupervisorPublisher();
  // eslint-disable-next-line prefer-const
  let sup: Supervisor;
  const supervisor = new Supervisor({
    policy: { ...resolved, signal: resolved.signal ?? (async () => sup.aggregatedSignal()) },
    spawn,
    budget,
    ledger: opts.ledger ?? new BudgetLedger(env.PROC_BUDGET_DIR || undefined),
    publisher,
    nodeId,
    shutdownGraceMs: shutdownGraceFrom(env),
  });
  sup = supervisor;
  if (opts.onEvent) supervisor.onEvent(opts.onEvent);
  supervisor.start();

  const metrics = await loadRegistry(opts.kind, env, supervisor);
  let draining = false;
  // a dedicated token (what the relaying worker sends, `*_SUPERVISOR_TOKEN` there), else the metrics secret, else open
  const secret = env.PROC_SUPERVISOR_TOKEN || env.METRICS_SECRET || '';
  const authorised = (req: IncomingMessage): boolean => !secret || bearerMatches(req.headers.authorization, secret);
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
      if (path === '/healthz') {
        const health = supervisor.health();
        const ok = health.status !== 'fail' && !draining;
        return json(res, ok ? 200 : 503, {
          status: draining ? 'draining' : health.status === 'fail' ? 'fail' : 'ok', kind: opts.kind, node: nodeId, role: 'supervisor', health,
        });
      }
      if (path === '/supervisor') {
        if (!authorised(req)) return json(res, 401, { error: 'unauthorized' });
        // the live state (the published one is up to one tick old), the logs from the publisher
        const snap = publisher.snapshot();
        return json(res, 200, { ...snap, state: supervisor.state(), health: supervisor.health(), port: (server.address() as { port?: number } | null)?.port ?? opts.port, version: opts.version ?? env.RELEASE_VERSION ?? '' });
      }
      if (path === '/metrics') {
        if (!metrics) { res.writeHead(404); res.end(); return; }
        if (!authorised(req)) { res.writeHead(401); res.end(); return; }
        const body = await aggregatedMetrics(metrics.registry, metrics.prom, supervisor);
        res.writeHead(200, { 'content-type': metrics.registry.contentType, 'cache-control': 'no-store' });
        res.end(body);
        return;
      }
      res.writeHead(404);
      res.end();
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.port, opts.bind, () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    await supervisor.stop();
    throw error;
  }

  let stopping: Promise<void> | null = null;
  const shutdown = (signal: string): Promise<void> => {
    stopping ??= (async () => {
      draining = true;
      supLog.info(`[${opts.kind}] ${signal} received: draining ${supervisor.count()} children`);
      await supervisor.stop();
      await new Promise<void>((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
        server.closeAllConnections?.();
      });
      supLog.info(`[${opts.kind}] supervisor drained, exiting`);
      exit(0);
    })();
    return stopping;
  };
  if (opts.installSignalHandlers !== false) {
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
  }

  supLog.info(`[process_host] ${opts.kind} local supervisor ${nodeId} on :${opts.port}: budget ${budget.cpu} cpu / ${budget.memoryMb} MB (${budget.source}), min ${resolved.min}, max ${supervisor.max}${opts.cluster === false ? '' : ', children share the service port'}`);
  return { nodeId, supervisor, server, budget, snapshot: () => publisher.snapshot(), shutdown };
}
