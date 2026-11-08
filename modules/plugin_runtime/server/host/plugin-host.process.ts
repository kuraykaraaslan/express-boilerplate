import http from 'node:http';
import { shouldSupervise } from '@kuraykaraaslan-labs/process_host/server/supervisor/policy';
import { startLocalSupervisor, type StartLocalSupervisorOptions } from '@kuraykaraaslan-labs/process_host/server/supervisor/local';
import { trackHttpDrain } from '@kuraykaraaslan-labs/process_host/server/supervisor/child';
import type { DrainInfo } from '@kuraykaraaslan-labs/process_host/server/supervisor/drain';
import { runLocalChild } from '@kuraykaraaslan-labs/process_host/server/supervisor/local-child';
import { WaitWindow } from '@kuraykaraaslan-labs/process_host/server/supervisor/wait-window';
import { LOCAL_SUPERVISOR_PORTS } from '@kuraykaraaslan-labs/process_host/server/supervisor/local-ports';
import { SandboxManager, SandboxBusyError, type CallCtx, type HostDispatch } from './isolate-pool';
import { sandboxViolationOf } from './isolate.types';
import { makeBrokerDispatch } from '../broker/broker-client';
import { tokensMatch, type RunRequest, type RunResult, type RuntimeConfig } from '../rpc/protocol';

/**
 * The standalone plugin-host process, supervised or not (docs/phases/14-docker/07 task 7, kind `plugin-host`). It holds no
 * database, storage or Redis credential (it reaches data only through the web-tier broker), so the supervisor is process_host's
 * credential-less local one.
 *
 * - `PROC_PLUGIN_HOST_ENABLED=true` (and not a child): the **supervisor**. It runs no plugin; it forks `node:cluster`
 *   children of the same entry that all serve `PLUGIN_HOST_PORT` (4500; `PLUGIN_HOST_URL` does not change), and serves its
 *   own `/healthz`, `/metrics` and `/supervisor` on `PLUGIN_HOST_SUPERVISOR_PORT` (4501). Scales by the wait for a free
 *   sandbox: up when its p95 holds above 50 ms for 30 s, down when it stays under 10 ms and the group's CPU under 30 % for
 *   10 min (policy `plugin-host`, env `PROC_PLUGIN_HOST_*`). Each child has its own sandbox pools, so a second child doubles
 *   the sandboxes a busy plugin version can use.
 * - otherwise: the host itself, as before (one process), plus, under a supervisor, the child wiring: the p95 of the sandbox
 *   wait over the last 10 s every 5 s, health and CPU every 5 s; a drain closes the listener (the child leaves the
 *   rotation), lets every request already received finish with `Connection: close` (a busy keep-alive connection takes
 *   no further request), waits for the last connection to end (cut only past the drain's grace or on escalation; process_host
 *   `trackHttpDrain`), then disposes the sandboxes and exits.
 */
export const PLUGIN_HOST_KIND = 'plugin-host';
export const PLUGIN_HOST_SUPERVISOR_PORT: number = LOCAL_SUPERVISOR_PORTS['plugin-host'];
export const WAIT_WINDOW_MS = 10_000;

export type PluginHostRole = 'supervisor' | 'child' | 'single';

export interface PluginHostProcessOptions {
  cfg: RuntimeConfig;
  env: Record<string, string | undefined>;
  entry: string;
  /** Default: the broker client (`makeBrokerDispatch(cfg)`). */
  dispatch?: HostDispatch;
  log?: (...a: unknown[]) => void;
  exit?: (code: number) => void;
  installSignalHandlers?: boolean;
  supervisor?: Partial<StartLocalSupervisorOptions>;
}

export interface PluginHostHandle {
  role: PluginHostRole;
  server?: http.Server;
  manager?: SandboxManager;
  waits?: WaitWindow;
  inflight?: () => number;
  drain?: () => Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 16_000_000) { reject(new Error('body too large')); req.destroy(); } data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** The HTTP face: `GET /healthz`, `POST /run` and `POST /evict` (both bearer `PLUGIN_HOST_TOKEN`). */
export function createPluginHostServer(
  cfg: RuntimeConfig,
  mgr: SandboxManager,
  log: (...a: unknown[]) => void = (...a) => console.log('[plugin-host]', ...a),
): http.Server {
  async function handleRun(body: RunRequest): Promise<RunResult> {
    const { sandbox } = body;
    if (!mgr.isRegistered(sandbox.pluginVersionId)) {
      if (!body.bundleCode) return { ok: false, needBundle: true };
      mgr.register(sandbox.pluginVersionId, sandbox.pluginId, sandbox.capabilities, body.bundleCode, {
        memoryMb: sandbox.limits.memoryMb,
        timeoutMs: sandbox.limits.timeoutMs,
      });
    }
    const ctx: CallCtx = {
      tenantId: body.tenantId,
      ...(typeof body.configTenantId === 'string' ? { configTenantId: body.configTenantId } : {}),
      pluginId: sandbox.pluginId,
      capabilities: sandbox.capabilities,
      httpAllowlist: sandbox.httpAllowlist,
      limits: { httpTimeoutMs: sandbox.limits.httpTimeoutMs, httpMaxBytes: sandbox.limits.httpMaxBytes },
      protectedSettingKeys: sandbox.protectedSettingKeys ?? [],
      // phase 55 00 §0.3: the bounds this call hits, returned with the answer so the web tier can put them on the record
      violations: [],
    };
    const noted = () => (ctx.violations?.length ? { violations: [...ctx.violations] } : {});
    try {
      let resultJson: string;
      if (body.kind === 'http') {
        resultJson = await mgr.runHttp(sandbox.pluginVersionId, ctx, body.target, body.payloadJson);
      } else if (body.kind === 'provider') {
        const [point, op] = body.target.split('#');
        resultJson = await mgr.runProvider(sandbox.pluginVersionId, ctx, point, op, body.payloadJson);
      } else {
        await mgr.runEvent(sandbox.pluginVersionId, ctx, body.target, body.payloadJson);
        resultJson = '{}';
      }
      return { ok: true, resultJson, ...noted() };
    } catch (e: unknown) {
      if (e instanceof SandboxBusyError) return { ok: false, error: e.message, busy: true };
      const violation = sandboxViolationOf(e);
      if (violation && !ctx.violations!.includes(violation)) ctx.violations!.push(violation);
      return { ok: false, error: (e as { message?: string })?.message ?? 'plugin execution failed', ...noted() };
    }
  }

  return http.createServer(async (req, res) => {
    const json = (status: number, obj: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && req.url === '/healthz') return json(200, { status: 'alive' });
      if (req.method === 'POST' && req.url === '/run') {
        const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!tokensMatch(auth, cfg.hostToken)) return json(401, { ok: false, error: 'unauthorized' });
        const body = JSON.parse(await readBody(req)) as RunRequest;
        const result = await handleRun(body);
        // A full pool is back-pressure, not a plugin failure: 503 tells the web
        // tier to answer "try again" rather than report a crashed plugin.
        return json('busy' in result && result.busy ? 503 : 200, result);
      }
      if (req.method === 'POST' && req.url === '/evict') {
        // A revoked version (takedown, operator withdrawal, publisher suspension) leaves at once: disposing its
        // sandboxes ends any run still inside them, and nothing re-registers it because the web tier refuses to
        // resolve a revoked version (docs/phases/37-extensions/07). Under supervision each child has its own pools and
        // the request reaches one of them: a sibling keeps its warm sandboxes of the version until it is drained or
        // restarted, but receives no new run for it (the web tier refuses to resolve the version).
        const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!tokensMatch(auth, cfg.hostToken)) return json(401, { ok: false, error: 'unauthorized' });
        const { pluginVersionIds } = JSON.parse(await readBody(req)) as { pluginVersionIds?: unknown };
        const ids = Array.isArray(pluginVersionIds) ? pluginVersionIds.filter((x): x is string => typeof x === 'string') : [];
        let evicted = 0;
        for (const id of ids) {
          if (mgr.isRegistered(id)) { mgr.unregister(id); evicted += 1; }
        }
        if (evicted) log(`evicted ${evicted} revoked plugin version(s)`);
        return json(200, { ok: true, evicted });
      }
      json(404, { ok: false, error: 'not found' });
    } catch (e: unknown) {
      json(400, { ok: false, error: (e as { message?: string })?.message ?? 'bad request' });
    }
  });
}

export async function runPluginHostProcess(o: PluginHostProcessOptions): Promise<PluginHostHandle> {
  const { cfg, env } = o;
  const log = o.log ?? ((...a: unknown[]) => console.log('[plugin-host]', ...a));
  if (shouldSupervise(PLUGIN_HOST_KIND, env)) {
    await startLocalSupervisor({
      kind: PLUGIN_HOST_KIND,
      entry: o.entry,
      port: Number(env.PLUGIN_HOST_SUPERVISOR_PORT ?? PLUGIN_HOST_SUPERVISOR_PORT),
      env,
      installSignalHandlers: o.installSignalHandlers,
      exit: o.exit,
      ...o.supervisor,
    });
    return { role: 'supervisor' };
  }

  // Sandboxes per (tenant, plugin VERSION): tenants never share an isolate (plugin_runtime.10). A call
  // holds its sandbox through all of its broker round trips (a storage upload makes
  // ~16), so the isolate mostly sits idle waiting on I/O; 2 capped a tenant at two
  // concurrent uploads per storage plugin. Sandboxes are created lazily, so a quiet
  // pool still costs one; a pool's ceiling under load is PLUGIN_POOL_SIZE x the
  // version's memoryMb (4 x 128 MB by default), and the process keeps at most
  // MAX_POOLED_ISOLATES isolates in all (idle ones evicted least recently used first).
  const poolSize = Number(env.PLUGIN_POOL_SIZE ?? 4);
  const waits = new WaitWindow(WAIT_WINDOW_MS);
  const mgr = new SandboxManager(o.dispatch ?? makeBrokerDispatch(cfg), poolSize, cfg.borrowTimeoutMs, { onWait: (ms) => waits.record(ms) });
  const server = createPluginHostServer(cfg, mgr, log);
  // the listener closes, every answer from now on says `Connection: close`, the drain resolves once the last
  // connection ended (process_host `trackHttpDrain`); the connections still open are cut only past the grace
  const httpDrain = trackHttpDrain(server);
  let draining: Promise<void> | null = null;
  const drain = (info?: DrainInfo): Promise<void> => {
    draining ??= (async () => {
      await httpDrain.drain({ isIdle: () => mgr.inflight === 0, maxMs: info?.graceMs, signal: info?.signal });
      mgr.disposeAll();
    })();
    return draining;
  };

  const ctx = await runLocalChild({
    kind: PLUGIN_HOST_KIND,
    start: () => new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(cfg.hostPort, () => {
        server.off('error', reject);
        log(`listening on :${cfg.hostPort} (pool=${poolSize})`);
        resolve();
      });
    }),
    drain,
    health: () => ({ status: 'ok', detail: `${mgr.inflight} calls in flight` }),
    signal: { read: () => waits.p95() },
    exit: o.exit,
    env,
  });

  if (!ctx.isChild && o.installSignalHandlers !== false) {
    const exit = o.exit ?? ((code: number) => process.exit(code));
    const shutdown = () => { log('shutting down'); mgr.disposeAll(); server.close(() => exit(0)); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return { role: ctx.isChild ? 'child' : 'single', server, manager: mgr, waits, inflight: () => httpDrain.inflight(), drain };
}
