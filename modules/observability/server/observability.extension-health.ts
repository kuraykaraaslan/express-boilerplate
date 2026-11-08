import Logger from '@kuraykaraaslan-labs/logger';
import redis, { createRedisConnection } from '@kuraykaraaslan-labs/redis';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantMember } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import { onContributionOutcome, type ContributionOutcome } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import {
  PLUGIN_VERSION_SCOPE, closeBreaker, holdBreaker, onBreakerTransition, openBreakers, type BreakerTransition,
} from '@kuraykaraaslan-labs/common/server/extensions/breaker';
import { extensionStateChannel } from '@kuraykaraaslan-labs/common/server/extensions/extension-state.channel';
import { getMetrics, getPromClient, registerGaugeSource } from './metrics';

/**
 * What the extension runtime reports, made visible (docs/phases/37-extensions/04).
 *
 * `common` keeps a breaker per process and announces its transitions; this subscriber, started in every process
 * that boots (`consumer` boot phase), turns them into: a counter and a latency histogram per contribution call, a
 * cross-process list of open breakers in Redis (what the operator and tenant views read), a gauge of the open ones,
 * a counter of openings and closings, an announcement on the extension state channel (so open admin pages reload),
 * and one in-app notice to the tenant's admins per opening. Community plugin versions (scope `plugin-version`, judged
 * in Redis across tenants) arrive through the same announcements and are listed the same way, with the plugin id as
 * the module and the call's target as the point; nobody is notified for them (no publisher notice exists yet).
 * Every step is best-effort: observing must never break the call that is being observed.
 *
 * It also listens on the breaker command channel, so an operator's "close now" / "keep open" reaches the in-process
 * breaker of every process that boots, not only the one that took the request.
 */

export const OPEN_BREAKERS_KEY = 'extensions:breakers:open';
/** Where "close now" / "keep open" is broadcast to every process (observability.breaker-actions.ts publishes). */
export const BREAKER_COMMANDS_CHANNEL = 'extensions:breakers:cmd';

export interface OpenBreakerRecord {
  scope: string;
  contributionId: string;
  point: string;
  moduleId: string;
  until: number;
  reason?: string;
  reopenings: number;
  openedAt: number;
  /** Failures that opened it (in the window), when the breaker said. */
  failures?: number;
  /** Kept open by an operator until `until`, with why. */
  held?: boolean;
  heldReason?: string;
}

export type BreakerCommand =
  | { action: 'close'; scope: string; contributionId: string }
  | { action: 'hold'; scope: string; contributionId: string; until: number; point: string; moduleId: string; reason?: string };

let started = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let counters: { calls: any; duration: any; transitions: any } | null = null;

function metricsFor(): typeof counters {
  if (counters) return counters;
  const prom = getPromClient();
  const bundle = getMetrics();
  if (!prom || !bundle) return null;
  counters = {
    calls: new prom.Counter({
      name: 'extension_contribution_calls_total',
      help: 'Extension contribution calls by point, contributing module and outcome (ok | load | threw | timeout | invalid)',
      labelNames: ['point', 'module', 'outcome'],
      registers: [bundle.registry],
    }),
    duration: new prom.Histogram({
      name: 'extension_contribution_duration_seconds',
      help: 'Extension contribution call latency',
      labelNames: ['point', 'module'],
      buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [bundle.registry],
    }),
    transitions: new prom.Counter({
      name: 'extension_breaker_transitions_total',
      help: 'Extension breaker openings and closings by scope kind (tenant | system | plugin-version), point, module (or plugin) and direction',
      labelNames: ['scope', 'point', 'module', 'to'],
      registers: [bundle.registry],
    }),
  };
  return counters;
}

function recordCall(o: ContributionOutcome): void {
  const m = metricsFor();
  if (!m) return;
  m.calls.inc({ point: o.contribution.point, module: o.contribution.moduleId, outcome: o.ok ? 'ok' : o.failure?.reason ?? 'threw' });
  m.duration.observe({ point: o.contribution.point, module: o.contribution.moduleId }, o.ms / 1000);
}

/** The field of a breaker in OPEN_BREAKERS_KEY. */
export const fieldOf = (t: { scope: string; contributionId: string }) => `${t.scope}|${t.contributionId}`;

async function notifyTenantAdmins(t: BreakerTransition): Promise<void> {
  const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
  const admins = await withTenantRepositoryFor(t.scope, TenantMember, (repo) => repo.find({
    where: { tenantId: t.scope, memberRole: 'ADMIN', memberStatus: 'ACTIVE' },
    select: { userId: true },
  }));
  if (!admins.length) return;
  const minutes = t.until ? Math.max(1, Math.round((t.until - Date.now()) / 60000)) : null;
  await NotificationService.notify(
    t.scope,
    admins.map((a) => ({ userId: a.userId })),
    {
      event: 'extensions.contribution.paused',
      category: 'workspace',
      title: `${t.moduleId} paused after repeated errors`,
      body: `What ${t.moduleId} adds to ${t.point} kept failing (${t.reason ?? 'error'}) and is paused${minutes ? ` for about ${minutes} minutes` : ''}. It is tried again automatically; everything else keeps working.`,
    },
    { urgency: 'NORMAL', idempotencyKey: `extensions.paused:${fieldOf(t)}:${t.until ?? 0}` },
  );
}

/** tenant: one workspace's; system: work for no tenant; plugin-version: one community plugin version, every tenant's. */
const kindOf = (scope: string): 'tenant' | 'system' | 'plugin-version' =>
  (scope === 'system' ? 'system' : scope === PLUGIN_VERSION_SCOPE ? 'plugin-version' : 'tenant');

/** Open admin pages reload what the change shapes; the system scope and a plugin version concern every tenant. */
export async function announceExtensionState(scope: string): Promise<void> {
  const channel = extensionStateChannel(kindOf(scope) === 'tenant' ? scope : '*');
  try { await redis.publish(channel, JSON.stringify({ at: Date.now() })); } catch { /* a lost announcement costs a live refresh only */ }
}

async function onTransition(t: BreakerTransition): Promise<void> {
  const kind = kindOf(t.scope);
  try {
    metricsFor()?.transitions.inc({ scope: kind, point: t.point, module: t.moduleId, to: t.to });
    if (t.to === 'open') {
      // A reopening is the same incident going on: it keeps the time it began.
      const prev = t.reopenings ? await redis.hget(OPEN_BREAKERS_KEY, fieldOf(t)) : null;
      const openedAt = prev ? (JSON.parse(prev) as Partial<OpenBreakerRecord>).openedAt ?? Date.now() : Date.now();
      const record: OpenBreakerRecord = {
        scope: t.scope, contributionId: t.contributionId, point: t.point, moduleId: t.moduleId,
        until: t.until ?? Date.now(), reason: t.reason, reopenings: t.reopenings ?? 0, openedAt,
        ...(t.failures !== undefined ? { failures: t.failures } : {}),
      };
      await redis.hset(OPEN_BREAKERS_KEY, fieldOf(t), JSON.stringify(record));
      Logger.error(`[extensions] ${t.point} <- ${t.contributionId} paused for ${t.scope} after repeated errors (${t.reason ?? 'error'})`);
    } else {
      await redis.hdel(OPEN_BREAKERS_KEY, fieldOf(t));
      Logger.info(`[extensions] ${t.point} <- ${t.contributionId} ${t.reason ? `closed for ${t.scope} (${t.reason})` : `recovered for ${t.scope}`}`);
    }
  } catch (error) {
    Logger.warn(`[extensions] could not record a breaker change: ${error instanceof Error ? error.message : String(error)}`);
  }
  await announceExtensionState(t.scope);
  // Once per opening, not per failed probe: a reopening is the same incident going on. Only a workspace's own
  // contributions have admins to tell; a plugin version's publisher would be told here once marketplace_developer
  // has a way to reach a publisher.
  if (t.to === 'open' && kind === 'tenant' && !t.reopenings) {
    try {
      await notifyTenantAdmins(t);
    } catch (error) {
      Logger.warn(`[extensions] could not tell the admins of ${t.scope} about a paused contribution: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Apply an operator's command to this process's breaker (every process gets it through the command channel). */
export function applyBreakerCommand(cmd: BreakerCommand): void {
  if (cmd.action === 'close') closeBreaker(cmd.scope, cmd.contributionId);
  else holdBreaker(cmd.scope, cmd.contributionId, cmd.until, { point: cmd.point, moduleId: cmd.moduleId, reason: cmd.reason });
}

function parseCommand(raw: string): BreakerCommand | null {
  try {
    const c = JSON.parse(raw) as Partial<BreakerCommand> & Record<string, unknown>;
    if (typeof c.scope !== 'string' || typeof c.contributionId !== 'string') return null;
    if (c.action === 'close') return { action: 'close', scope: c.scope, contributionId: c.contributionId };
    if (c.action === 'hold' && typeof c.until === 'number' && typeof c.point === 'string' && typeof c.moduleId === 'string') {
      return { action: 'hold', scope: c.scope, contributionId: c.contributionId, until: c.until, point: c.point, moduleId: c.moduleId, ...(typeof c.reason === 'string' ? { reason: c.reason } : {}) };
    }
    return null;
  } catch {
    return null;
  }
}

/** A subscriber needs its own connection (a subscribed client can run nothing else). */
function listenForCommands(): void {
  try {
    const subscriber = createRedisConnection();
    subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== BREAKER_COMMANDS_CHANNEL) return;
      const cmd = parseCommand(raw);
      if (cmd) applyBreakerCommand(cmd);
      else Logger.warn('[extensions] ignored a malformed breaker command');
    });
    void Promise.resolve(subscriber.subscribe(BREAKER_COMMANDS_CHANNEL)).catch((error: unknown) => {
      Logger.warn(`[extensions] breaker commands are not received by this process: ${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    Logger.warn(`[extensions] breaker commands are not received by this process: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * A process that boots after an operator's "keep open" never heard the command: it applies the holds the shared list
 * still records, once, at boot. (Plugin versions are held in Redis itself and need nothing here.)
 */
export async function replayHolds(now = Date.now()): Promise<void> {
  try {
    for (const r of await listOpenBreakers()) {
      if (!r.held || r.until <= now || r.scope === PLUGIN_VERSION_SCOPE) continue;
      applyBreakerCommand({ action: 'hold', scope: r.scope, contributionId: r.contributionId, until: r.until, point: r.point, moduleId: r.moduleId, ...(r.heldReason ? { reason: r.heldReason } : {}) });
    }
  } catch (error) {
    Logger.warn(`[extensions] could not apply the operators' holds at boot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Open breakers across processes, for one tenant or all; entries past their probe time are dropped from the view. */
export async function listOpenBreakers(scope?: string): Promise<OpenBreakerRecord[]> {
  const raw = (await redis.hgetall(OPEN_BREAKERS_KEY)) ?? {};
  const now = Date.now();
  const out: OpenBreakerRecord[] = [];
  for (const value of Object.values(raw)) {
    try {
      const r = JSON.parse(value) as OpenBreakerRecord;
      // A breaker past its probe time with no news is stale (the probing process died or recovered silently).
      if (r.until + 60 * 60_000 < now) continue;
      if (!scope || r.scope === scope) out.push(r);
    } catch { /* skip a malformed entry */ }
  }
  return out.sort((a, b) => b.openedAt - a.openedAt);
}

/** Boot task (`common:boot_task`, phase `consumer`, so it runs in every process that boots). Idempotent. */
export async function startExtensionHealth(): Promise<void> {
  if (started) return;
  started = true;
  onContributionOutcome(recordCall);
  onBreakerTransition((t) => { void onTransition(t); });
  listenForCommands();
  void replayHolds();
  registerGaugeSource({
    name: 'extension_breakers_open',
    help: 'Contributions currently paused by the extension breaker in this process',
    labelNames: ['point', 'module'],
    async read() {
      const counts = new Map<string, { point: string; module: string; n: number }>();
      for (const b of openBreakers()) {
        const key = `${b.point}|${b.moduleId}`;
        const c = counts.get(key) ?? { point: b.point, module: b.moduleId, n: 0 };
        c.n += 1;
        counts.set(key, c);
      }
      return [...counts.values()].map((c) => ({ labels: { point: c.point, module: c.module }, value: c.n }));
    },
  });
}

/**
 * A contribution that failed to render in a browser (docs/phases/37-extensions/05): counted with the contribution's
 * server-side outcomes (`outcome="client_error"`) and logged. `where` is the slot or point, `component` the contributed
 * component or block type; the module is the first path segment of a component id when there is one.
 */
export function recordClientError(tenantId: string, report: { where: string; component: string; message?: string }): void {
  const moduleId = report.component.includes('/') ? report.component.split('/')[0] : 'unknown';
  metricsFor()?.calls.inc({ point: report.where, module: moduleId, outcome: 'client_error' });
  Logger.warn(`[extensions] ${report.where} <- ${report.component}: failed to render in a browser (tenant ${tenantId})${report.message ? `: ${report.message}` : ''}`);
}
