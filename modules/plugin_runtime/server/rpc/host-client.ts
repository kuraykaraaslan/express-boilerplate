// Web-tier client to the plugin-host. Sends a run request; if the host reports a
// cold cache (`needBundle`), lazily fetches the approved bundle and retries once.
// Safe to import from the Next/web tier — pulls in no isolated-vm.

import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import {
  admitPluginVersion, settlePluginVersion, type IsolateOutcome,
} from '@kuraykaraaslan-labs/common/server/extensions/plugin-version-breaker';
import { reportRefusal } from '@kuraykaraaslan-labs/common/server/refusal-sink';
import { loadRuntimeConfig, type RunRequest, type RunResult, type SandboxConfig } from './protocol';
import { isSandboxViolation, type SandboxViolation } from './sandbox-violations';

const DEFAULT_BORROW_TIMEOUT_MS = 10_000;

/**
 * The deadline for one /run request. Unless PLUGIN_HOST_REQUEST_TIMEOUT_MS pins
 * it, it is the longest a live call can take on the host: the borrow wait, a
 * cold sandbox create (bootstrap and bundle each get the run timeout) and the
 * run itself, plus slack. So it only cuts off a host that stopped answering,
 * never a slow plugin that its own isolate timeout would still stop.
 */
function requestTimeoutMs(cfg: { hostRequestTimeoutMs?: number; borrowTimeoutMs?: number }, sandbox: SandboxConfig): number {
  if (cfg.hostRequestTimeoutMs && cfg.hostRequestTimeoutMs > 0) return cfg.hostRequestTimeoutMs;
  const borrow = cfg.borrowTimeoutMs && cfg.borrowTimeoutMs > 0 ? cfg.borrowTimeoutMs : DEFAULT_BORROW_TIMEOUT_MS;
  const run = sandbox.limits?.timeoutMs > 0 ? sandbox.limits.timeoutMs : 5_000;
  return borrow + 3 * run + 5_000;
}

/** The plugin-host took longer than the request timeout to answer a /run. */
class HostTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`plugin-host at ${url} timed out after ${timeoutMs} ms`);
    this.name = 'HostTimeoutError';
  }
}

async function post(url: string, token: string, body: RunRequest, timeoutMs: number): Promise<RunResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      // Without a deadline a stalled host (or a dropped loopback packet) held
      // the web request, and the upload or provider call behind it, forever.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if ((e as { name?: string } | undefined)?.name === 'TimeoutError') throw new HostTimeoutError(url, timeoutMs);
    // Connection-level failure (host process not running / wrong PLUGIN_HOST_URL).
    const err = e as { cause?: { code?: string; message?: string }; message?: string } | undefined;
    const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'fetch failed';
    throw new Error(
      `plugin-host unreachable at ${url} (${cause}). Start it with \`npm run plugin-host:dev\` (or set PLUGIN_HOST_URL).`,
    );
  }
  if (res.status === 401) throw new Error('plugin-host auth failed');
  if (res.status === 503) {
    // Every sandbox of this plugin version stayed busy past the borrow timeout:
    // a retryable overload, so it surfaces as 503 rather than a plugin failure.
    throw new AppError('Plugin is busy, try again shortly', 503, ErrorCode.INTERNAL_ERROR, {
      retryable: true,
      headers: { 'Retry-After': '1' },
    });
  }
  // Only a 200 carries what the isolate did; anything else is the host refusing the request (a malformed or oversized
  // body, an unknown path), which says nothing about the plugin.
  if (res.status !== 200) throw new Error(`plugin-host refused the run (HTTP ${res.status})`);
  return (await res.json()) as RunResult;
}

export interface RunOnHostArgs {
  tenantId: string;
  /**
   * Phase 53.4: the tenant whose plugin secrets and plugin config (`plugin_secret:` / `plugin:` keys) the call reads, when it
   * is not `tenantId`: the root tenant's install serving a tenant at the `platform` setting level. Absent = `tenantId`.
   */
  configTenantId?: string;
  sandbox: SandboxConfig;
  kind: 'http' | 'event' | 'provider';
  target: string;
  payloadJson: string;
  /** Loads the approved bundle code; called only on a host cache miss. */
  getBundle: () => Promise<string>;
}

/**
 * Marketplace §6D wiring: every plugin execution — this is the ONE web-tier
 * funnel — reports latency + outcome to the platform's own observability
 * (Prometheus + Sentry, tagged pluginId/versionId). Dynamic import + fire-and-
 * forget: telemetry being down must never fail or slow a plugin call, and
 * `plugin_runtime` takes no hard edge on `observability` (it is
 * `dependencies.optional`, EXT-14, and not gated on a tenant's state: it is
 * the platform's own telemetry, not a tenant feature).
 */
function report(
  args: RunOnHostArgs,
  startedAt: number,
  outcome: 'ok' | 'error' | 'timeout',
  error?: Error,
): void {
  void import('@kuraykaraaslan-labs/observability/server/observability.service')
    .then(({ default: ObservabilityService }) => {
      ObservabilityService.recordPluginExecution({
        tenantId: args.tenantId,
        pluginId: args.sandbox.pluginId,
        pluginVersionId: args.sandbox.pluginVersionId,
        kind: args.kind,
        target: args.target,
        durationMs: Date.now() - startedAt,
        outcome,
        error,
      });
    })
    .catch(() => { /* observability absent/broken → the plugin call is unaffected */ });
}

/**
 * Phase 55 00 §0.3 (P-3): the bounds a run hit, on the tenant's record as `plugin.sandbox_violation`, counted per plugin VERSION and minute (a
 * plugin is a machine actor: acted on per version through its breaker, never per address). The plugin-host names them (`RunResult.violations`); a
 * host that names none but answered a timeout still counts as one. Only names: no payload, no result.
 */
function reportViolations(args: RunOnHostArgs, named: unknown, timedOut: boolean): void {
  const list: SandboxViolation[] = (Array.isArray(named) ? named : []).filter(isSandboxViolation);
  if (timedOut && !list.includes('timeout')) list.push('timeout');
  for (const violation of new Set(list)) {
    void reportRefusal({
      action: 'plugin.sandbox_violation',
      tenantId: args.tenantId,
      key: `${args.sandbox.pluginVersionId}:${violation}`,
      resourceType: 'plugin_version',
      resourceId: args.sandbox.pluginVersionId,
      metadata: { pluginId: args.sandbox.pluginId, violation, kind: args.kind, target: args.target.slice(0, 120) },
    });
  }
}

/**
 * Run a plugin handler on the host; returns the handler's JSON result string.
 *
 * The version's breaker (EXT-7, common/server/extensions/plugin-version-breaker) is asked first: while the version is
 * paused the call fails fast with PluginVersionQuarantinedError and never reaches the host. Afterwards only what the
 * isolate did is recorded — the plugin answered, threw or ran out of time; back-pressure, an unreachable host and a
 * bundle that could not be fetched are not the plugin's doing.
 */
export async function runOnHost(args: RunOnHostArgs): Promise<string> {
  const ticket = await admitPluginVersion({ pluginId: args.sandbox.pluginId, pluginVersionId: args.sandbox.pluginVersionId });
  let judged: IsolateOutcome = 'not-judged';
  try {
    return await run(args, (outcome) => { judged = outcome; });
  } finally {
    void settlePluginVersion(ticket, judged, args.target);
  }
}

async function run(args: RunOnHostArgs, isolateSaid: (outcome: 'ok' | 'error' | 'timeout') => void): Promise<string> {
  const cfg = loadRuntimeConfig();
  const url = `${cfg.hostUrl}/run`;
  const base: RunRequest = {
    tenantId: args.tenantId,
    ...(args.configTenantId && args.configTenantId !== args.tenantId ? { configTenantId: args.configTenantId } : {}),
    sandbox: args.sandbox,
    kind: args.kind,
    target: args.target,
    payloadJson: args.payloadJson,
  };
  const timeoutMs = requestTimeoutMs(cfg, args.sandbox);
  const startedAt = Date.now();
  let reported = false;
  try {
    let result = await post(url, cfg.hostToken, base, timeoutMs);
    if (!result.ok && 'needBundle' in result && result.needBundle) {
      result = await post(url, cfg.hostToken, { ...base, bundleCode: await args.getBundle() }, timeoutMs);
    }
    if (result.ok) {
      reported = true;
      isolateSaid('ok');
      report(args, startedAt, 'ok');
      if (result.violations?.length) reportViolations(args, result.violations, false);
      return result.resultJson;
    }
    const message = ('error' in result && result.error) || 'plugin run failed';
    // isolated-vm reports a wall-clock kill as "Script execution timed out" —
    // the ANR/unresponsive signal 6D asks for, distinct from a plain crash.
    const outcome = /timed?[ -]?out/i.test(message) ? 'timeout' : 'error';
    // a busy pool or a second needBundle is not the plugin's doing; everything else the isolate did is
    if ('error' in result && !result.busy) reportViolations(args, result.violations, outcome === 'timeout');
    // A second `needBundle` is the host's confusion, not the plugin's failure.
    if ('error' in result) isolateSaid(outcome);
    const error = new Error(message);
    reported = true;
    report(args, startedAt, outcome, error);
    throw error;
  } catch (e) {
    // Anything not reported above is a connection-level failure (host
    // unreachable / auth) — infra trouble, but the developer's crash rate
    // must still see the call fail rather than silently vanish.
    if (!reported && e instanceof Error) report(args, startedAt, e instanceof HostTimeoutError ? 'timeout' : 'error', e);
    throw e;
  }
}

/**
 * Tell the plugin-host to drop revoked versions now: their warm sandboxes are disposed and any run still inside them
 * ends (docs/phases/37-extensions/07). Best-effort — an unreachable host has nothing running to stop, and the web
 * tier already refuses to resolve a revoked version, so the next dispatch cannot bring it back.
 */
export async function evictPluginVersions(pluginVersionIds: string[]): Promise<number | null> {
  if (!pluginVersionIds.length) return 0;
  const cfg = loadRuntimeConfig();
  try {
    const res = await fetch(`${cfg.hostUrl}/evict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.hostToken}` },
      body: JSON.stringify({ pluginVersionIds }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { evicted?: number }).evicted ?? 0;
  } catch {
    return null;
  }
}
