import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import {
  NODE_HEARTBEAT_MS, announceNode, procNodeIndex, procNodeKey, registerKind, withdrawNode,
  type HealthReport, type ProcessNodeInfo,
} from './process-registry';
import { childIpc, type DrainRequest } from './supervisor/supervisor.child-ipc';
import { procEnv } from './supervisor/supervisor.env';
import { createDrainSequence, type DrainInfo } from './supervisor/supervisor.drain';
import { bearerMatches } from './supervisor/supervisor.bearer';

/**
 * The one way a non-Next process starts (the sidecar contract, docs/phases/14-docker/02):
 *
 *  1. serves `GET /healthz` on its own port,
 *  2. drains on SIGTERM/SIGINT within `SHUTDOWN_GRACE_MS`,
 *  3. heartbeats into the process registry (`proc:nodes:<kind>`),
 *  4. (optionally) serves `GET /metrics` from a per-process prom-client registry.
 *
 * Pure Node: never import `next/*`, `observability`, `websocket` or a domain
 * module from here (enforced by `process-host.boundary.test.ts`).
 *
 * ## Child mode (docs/phases/14-docker/07, a process started by a supervisor)
 *
 * With `PROC_CHILD=1` (or `child: true`) the process is one of a supervised group. It opens no health port of its
 * own (the supervisor serves one `/healthz` and `/metrics` for the group): the HTTP server is created but not
 * listened on unless the caller passed its own `server`. Its health goes to the supervisor over IPC on every beat,
 * its metrics are answered over IPC (`getMetricsAsJSON`), a `drain` request runs the same drain sequence as SIGTERM
 * and is acknowledged with `drained`, and losing the parent channel drains too (an orphan never lingers; watched from
 * the start, so a supervisor that dies while the child is still starting counts). A `node:cluster` child (a shared port)
 * is exited by Node itself on an unexpected disconnect instead, at once: its connections came through the primary. It still
 * heartbeats into `proc:nodes:<kind>` with `info.role = 'child'`, so the operator screen sees every process.
 *
 * A child that shares a listening server with its siblings (ws through `cluster`, `server` passed) still answers
 * `/healthz` there (its own health: a liveness probe through the shared port reaches whichever child the primary picks)
 * but not `/metrics` (404): the group's metrics are the supervisor's, aggregated, on its own port.
 *
 * ## Drains (07 task 7)
 *
 * `onDrain` gets a `DrainInfo`. A SIGTERM, a lost supervisor or a supervisor `shutdown` drains as always, bounded by
 * `SHUTDOWN_GRACE_MS`. A supervisor `scale-down` may take the kind's grace instead (`graceMs`, or no bound at all with
 * `force: false`): ws keeps its sockets for up to 10 min, telephony waits for its last call. A SIGTERM or a `shutdown`
 * during such a drain escalates it: `info.signal` aborts and the `SHUTDOWN_GRACE_MS` bound starts. The sequence is
 * `createDrainSequence` (`supervisor/supervisor.drain.ts`), the same one `runLocalChild` runs for the credential-less kinds.
 */

// the drain protocol's child half is shared with the local child (`supervisor.drain.ts`); its types are re-exported here
export type { DrainInfo, HostDrainReason } from './supervisor/supervisor.drain';

/** Loose runtime type: `prom-client` is loaded lazily and is optional. */
export interface MetricsRegistryLike {
  contentType: string;
  metrics: () => Promise<string>;
  /** prom-client's JSON form, used to aggregate a supervised group's metrics. */
  getMetricsAsJSON?: () => Promise<unknown[]>;
}

export interface ProcessHostOptions {
  /** Registry kind, e.g. `ws`, `telephony-gateway`, `worker`, `iot-gateway`. */
  kind: string;
  version?: string;
  port: number;
  /** Called on every beat and every `/healthz`. Throwing counts as `fail`. */
  health?: () => Promise<HealthReport> | HealthReport;
  /**
   * Register process-specific metrics on the per-process registry. Only called
   * when `METRICS_ENABLED=true` and `prom-client` is installed.
   */
  metrics?: (registry: MetricsRegistryLike, prom: unknown) => void;
  /**
   * Close what the process owns (sockets, queues, connections). Runs after the node is withdrawn (or alongside, with
   * `withdrawFirst: false`); a withdrawal that Redis does not answer within `WITHDRAW_TIMEOUT_MS` does not hold it up.
   */
  onDrain: (info: DrainInfo) => Promise<void>;
  /**
   * The bound of a signal / shutdown drain (default `SHUTDOWN_GRACE_MS`). A supervisor passes more: its children bound
   * theirs by `SHUTDOWN_GRACE_MS`, and it must outlive them.
   */
  shutdownGraceMs?: number;
  /**
   * Default true: withdraw from the registry, then drain (a status screen stops advertising the node first). A
   * supervisor passes false: its drain tells the children to drain, which must not wait on Redis.
   */
  withdrawFirst?: boolean;
  /** Extra facts for the operator screen, read fresh on every beat. */
  info?: () => Record<string, unknown>;
  /**
   * Dual-write for one release: also announce under an older index/key with a
   * process-specific payload (`ws:nodes`, `tel:nodes`).
   */
  legacy?: { index: string; key: (nodeId: string) => string; payload: (node: ProcessNodeInfo) => object };
  /** Extra `/healthz` JSON fields (kept for back-compat with older probes). */
  healthzExtra?: () => Record<string, unknown>;
  /**
   * Reuse a server the process already owns (e.g. the one Socket.IO is attached
   * to). The host prepends its `/healthz` and `/metrics` handlers and answers
   * only those paths; with `listen: false` the caller listens itself.
   */
  server?: Server;
  listen?: boolean;
  /** Exit code path is `process.exit(0)` unless tests inject their own. */
  exit?: (code: number) => void;
  /** Install SIGTERM/SIGINT handlers (default true). */
  installSignalHandlers?: boolean;
  /** Use this node id instead of a random one (the supervisor publishes its state under the same id). */
  nodeId?: string;
  /** Child mode (see above). Defaults to `PROC_CHILD === '1'`. */
  child?: boolean;
  /**
   * Replaces the body of `/metrics` (the registry still has to be on). The supervisor uses it to serve its own series
   * merged with its children's.
   */
  metricsBody?: (own: MetricsRegistryLike) => Promise<string>;
}

/** How long the drain waits for the registry withdrawal before going on (the node's TTL removes it anyway). */
export const WITHDRAW_TIMEOUT_MS = 2_000;

export interface ProcessHost {
  nodeId: string;
  kind: string;
  /** The HTTP server serving `/healthz` and `/metrics`; a process may attach to it (e.g. Socket.IO). */
  server: Server;
  /** Run the drain sequence once (what SIGTERM triggers); `request` is a supervisor's drain (default: a plain shutdown). */
  shutdown: (signal: string, request?: DrainRequest) => Promise<void>;
}

async function runHealth(opts: ProcessHostOptions): Promise<HealthReport> {
  if (!opts.health) return { status: 'ok' };
  try {
    return await opts.health();
  } catch (error) {
    return { status: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
}

async function loadPromRegistry(kind: string, setup?: ProcessHostOptions['metrics']): Promise<MetricsRegistryLike | null> {
  if (!env.METRICS_ENABLED) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prom: any = await import('prom-client' as string);
    const registry = new prom.Registry();
    registry.setDefaultLabels({ process_kind: kind });
    prom.collectDefaultMetrics({ register: registry, prefix: 'app_' });
    setup?.(registry, prom);
    return registry;
  } catch (error) {
    Logger.warn(`[process_host] metrics unavailable (install prom-client): ${error}`);
    return null;
  }
}

function authorised(req: IncomingMessage): boolean {
  if (!env.METRICS_SECRET) return true;
  return bearerMatches(req.headers.authorization, env.METRICS_SECRET);
}

export async function startProcessHost(opts: ProcessHostOptions): Promise<ProcessHost> {
  const nodeId = opts.nodeId ?? randomBytes(4).toString('hex');
  const penv = procEnv();
  const child = opts.child ?? penv.PROC_CHILD === '1';
  const ipc = child ? childIpc() : null;
  const childIndex = child ? Number(penv.PROC_CHILD_INDEX ?? 0) : undefined;
  const startedAt = Date.now();
  const version = opts.version ?? env.RELEASE_VERSION;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const registry = await loadPromRegistry(opts.kind, opts.metrics);
  let draining = false;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/healthz') {
      const report = await runHealth(opts);
      // `degraded` still serves traffic; only `fail` (or draining) fails the probe.
      const ok = report.status !== 'fail' && !draining;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: draining ? 'draining' : report.status === 'fail' ? 'fail' : 'ok',
        kind: opts.kind,
        node: nodeId,
        health: report,
        ...(opts.healthzExtra?.() ?? {}),
      }));
      return;
    }
    if (path === '/metrics') {
      // a child on a port it shares with its siblings: one random child's series would mislead a scraper
      if (!registry || (child && !ownsServer)) { res.writeHead(404); res.end(); return; }
      if (!authorised(req)) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'content-type': registry.contentType, 'cache-control': 'no-store' });
      res.end(opts.metricsBody ? await opts.metricsBody(registry) : await registry.metrics());
      return;
    }
    res.writeHead(404);
    res.end();
  };

  const ownsServer = !opts.server;
  const server = opts.server ?? createServer();
  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/healthz' && path !== '/metrics') {
      if (ownsServer) { res.writeHead(404); res.end(); }
      return;
    }
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  };
  server.prependListener('request', onRequest);

  const index = procNodeIndex(opts.kind);
  const key = procNodeKey(opts.kind, nodeId);

  const beat = async (): Promise<void> => {
    const node: ProcessNodeInfo = {
      v: 1,
      kind: opts.kind,
      nodeId,
      version,
      port: child && !listening ? 0 : opts.port,
      startedAt,
      lastBeatAt: Date.now(),
      health: await runHealth(opts),
      info: child
        ? { ...(opts.info?.() ?? {}), role: 'child', childIndex, supervisor: penv.PROC_SUPERVISOR_NODE ?? null }
        : (opts.info?.() ?? {}),
    };
    ipc?.send({ type: 'health', report: node.health });
    await registerKind(opts.kind);
    await announceNode(index, key, nodeId, node);
    if (opts.legacy) {
      await announceNode(opts.legacy.index, opts.legacy.key(nodeId), nodeId, opts.legacy.payload(node));
    }
  };

  // a child opens no port of its own unless it brought a server it shares with its siblings (ws through `cluster`)
  const listening = opts.listen !== false && !(child && ownsServer);
  if (listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.port, () => { server.off('error', reject); resolve(); });
    });
  }
  if (child) Logger.info(`[process_host] ${opts.kind} child ${childIndex} (node ${nodeId}) reporting to its supervisor over IPC`);
  else Logger.info(`[process_host] ${opts.kind} node ${nodeId} serving /healthz on :${opts.port}`);
  if (ipc && registry?.getMetricsAsJSON) ipc.onMetricsRequest(() => registry.getMetricsAsJSON!());

  await beat();
  const heartbeat = setInterval(() => { void beat(); }, NODE_HEARTBEAT_MS);
  heartbeat.unref?.();

  // the one drain protocol (`supervisor.drain.ts`, shared with `runLocalChild`): reason, grace, `force`, escalation
  const sequence = createDrainSequence({
    kind: opts.kind,
    shutdownGraceMs: opts.shutdownGraceMs ?? env.SHUTDOWN_GRACE_MS,
    log: Logger,
    run: async (info: DrainInfo) => {
      draining = true;
      clearInterval(heartbeat);
      // Withdrawn BEFORE draining, so a status screen stops advertising this node while it is still saying goodbye to
      // its clients; bounded, because the shared client queues commands through a Redis outage and would never answer.
      // The registry TTL removes the node anyway: the drain itself must run.
      const withdrawal = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer within ${WITHDRAW_TIMEOUT_MS} ms`)), WITHDRAW_TIMEOUT_MS);
          timer.unref?.();
        });
        try {
          await Promise.race([
            (async () => {
              await withdrawNode(index, key, nodeId);
              if (opts.legacy) await withdrawNode(opts.legacy.index, opts.legacy.key(nodeId), nodeId);
            })(),
            timeout,
          ]);
        } catch (error) {
          Logger.warn(`[${opts.kind}] node not withdrawn: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          clearTimeout(timer);
        }
      })();
      if (opts.withdrawFirst !== false) await withdrawal;
      await opts.onDrain(info);
      await withdrawal;
    },
    done: async () => {
      await new Promise<void>((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
        // `close` on an already-closed server calls back with an error; nothing to wait for.
        server.closeAllConnections?.();
      });
      Logger.info(`[${opts.kind}] drained — exiting`);
      // the supervisor waits for this acknowledgement before it stops the child
      if (ipc) await ipc.sendAsync({ type: 'drained' });
      exit(0);
    },
    expired: () => exit(0),
  });
  const shutdown = (signal: string, request?: DrainRequest): Promise<void> => sequence.request(signal, request);

  if (ipc) {
    ipc.onDrain((request) => shutdown('drain', request));
    ipc.onDisconnect(() => { void shutdown('supervisor gone'); });
  }

  if (opts.installSignalHandlers !== false) {
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
  }

  return { nodeId, kind: opts.kind, server, shutdown };
}
