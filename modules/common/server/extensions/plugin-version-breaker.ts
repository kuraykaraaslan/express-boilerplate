// The breaker for community plugin VERSIONS (docs/phases/37-extensions/04, EXT-7).
//
// A plugin version is the same code for every tenant that installed it, so its failures are shared evidence: one
// breaker per `pluginVersionId`, across tenants and processes, kept in Redis. A published version gets a new id, so a
// fixed release starts closed, and pinning a tenant back to a paused version finds it paused.
//
//   …:calls:<window>, …:fails:<window>  INCR per fixed window, expiring after two windows
//   …:open                              present while paused (PX = the cooldown, or an operator's "keep open")
//   …:state                             the reopen count and why, from the opening until it closes
//   …:probe                             SET NX PX: the one call, across every process, that tests a cooled-down version
//
// The thresholds are the in-tree breaker's (breaker.ts), and so are the announcements, so observability lists and
// counts plugin versions like contributions. Only what the isolate did counts — the plugin threw, or ran out of
// time. A full sandbox pool (503 back-pressure), a plugin-host that cannot be reached or refuses the request, or a
// bundle that could not be fetched say nothing about the plugin: counting them would pause every plugin whenever the
// host is down. Redis being unavailable lets the call through and is logged once: the breaker is protection, not a
// duty.

import { AppError, ErrorCode } from '../app-error';
import { PLUGIN_VERSION_SCOPE, announceBreakerTransition, breakerConfig, breakerEnabled } from './breaker';

export interface PluginVersionRef {
  pluginId: string;
  pluginVersionId: string;
}

/** What admission handed a call: whether it is the probe, and whether the breaker is judging it at all. */
export interface VersionTicket extends PluginVersionRef {
  probe: boolean;
  /** False when the breaker is off or Redis could not be asked: the outcome is not recorded either. */
  tracked: boolean;
}

/** What the isolate did with the call; `not-judged` is everything that says nothing about the plugin. */
export type IsolateOutcome = 'ok' | 'error' | 'timeout' | 'not-judged';

/** A plugin version paused by its breaker. Hosts map it to `quarantined`; the plugin HTTP proxy answers 503 with it. */
export class PluginVersionQuarantinedError extends AppError {
  readonly reason = 'quarantined' as const;

  constructor(readonly plugin: PluginVersionRef, readonly until: number | null, readonly lastFailure?: string) {
    const retryAfter = until ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 5;
    super(
      until
        ? `The plugin ${plugin.pluginId} is paused after repeated errors; it is tried again after ${new Date(until).toISOString()}`
        : `The plugin ${plugin.pluginId} is paused after repeated errors; it is being tried again now`,
      503, ErrorCode.PROVIDER_UNAVAILABLE,
      {
        retryable: true,
        headers: { 'Retry-After': String(retryAfter) },
        details: { pluginId: plugin.pluginId, reason: 'quarantined', ...(until ? { until: new Date(until).toISOString() } : {}) },
      },
    );
    this.name = 'PluginVersionQuarantinedError';
  }
}

interface VersionState {
  reopenings: number;
  reason?: string;
  target?: string;
  openedAt?: number;
  held?: boolean;
}

/** How long a call may wait for the breaker's answer before it goes through unjudged. */
const ADMIT_DEADLINE_MS = 250;
/** How long the half-open state outlives the pause before the version counts as closed again with nobody calling it. */
const stateGraceMs = () => 2 * breakerConfig().maxCooldownMs;

const PREFIX = 'extensions:breaker:pv:';
const keysOf = (pluginVersionId: string) => ({
  open: `${PREFIX}${pluginVersionId}:open`,
  state: `${PREFIX}${pluginVersionId}:state`,
  probe: `${PREFIX}${pluginVersionId}:probe`,
  calls: (w: number) => `${PREFIX}${pluginVersionId}:calls:${w}`,
  fails: (w: number) => `${PREFIX}${pluginVersionId}:fails:${w}`,
});

type RedisClient = (typeof import('@kuraykaraaslan-labs/redis'))['default'];

// Imported on first use: hosts that never call a plugin do not open a Redis connection for this, and a unit test that
// leaves the breaker off never reaches it.
let clientImport: Promise<RedisClient> | null = null;
async function client(): Promise<RedisClient> {
  clientImport ??= import('@kuraykaraaslan-labs/redis').then((m) => m.default).catch((error: unknown) => {
    clientImport = null;
    throw error;
  });
  const redis = await clientImport;
  // ioredis queues commands while it reconnects; a breaker check must not wait for that, nor pile up behind it.
  const status = (redis as { status?: string }).status;
  if (status && status !== 'ready') throw new Error(`Redis is ${status}`);
  return redis;
}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Redis gave no answer within ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

let degraded = false;

async function log(level: 'warn' | 'info', message: string): Promise<void> {
  try {
    const { default: Logger } = await import('@kuraykaraaslan-labs/logger');
    Logger[level](message);
  } catch { /* logging must not break a plugin call */ }
}

/** Fail open, and say so once per outage. */
function unavailable(error: unknown): void {
  if (degraded) return;
  degraded = true;
  void log('warn', `[extensions] the plugin version breaker cannot reach Redis, so plugin calls go through unjudged: ${error instanceof Error ? error.message : String(error)}`);
}

function available(): void {
  if (!degraded) return;
  degraded = false;
  void log('info', '[extensions] the plugin version breaker reaches Redis again');
}

function parseState(raw: string | null | undefined): VersionState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<VersionState>;
    return { ...s, reopenings: typeof s.reopenings === 'number' ? s.reopenings : 0 };
  } catch {
    return { reopenings: 0 };
  }
}

/**
 * Before a call into the plugin-host: throws PluginVersionQuarantinedError while the version is paused (or another
 * process is testing it), lets exactly one call through as the probe once it cooled down, and lets every call through
 * unjudged when Redis cannot answer in time.
 */
export async function admitPluginVersion(ref: PluginVersionRef, now = Date.now()): Promise<VersionTicket> {
  const unjudged: VersionTicket = { ...ref, probe: false, tracked: false };
  if (!breakerEnabled()) return unjudged;
  const k = keysOf(ref.pluginVersionId);
  type Verdict = { paused: false; probe: boolean } | { paused: true; until: number | null; reason?: string };
  let verdict: Verdict;
  try {
    verdict = await within((async (): Promise<Verdict> => {
      const r = await client();
      const [openMs, rawState] = await Promise.all([r.pttl(k.open), r.get(k.state)]);
      const state = parseState(rawState);
      if (openMs > 0 || openMs === -1) return { paused: true, until: openMs > 0 ? now + openMs : null, reason: state?.reason };
      if (!state) return { paused: false, probe: false };
      // Cooled down: exactly one call, across every process, tests it; the others stay out until it answers.
      const claimed = await r.set(k.probe, String(now), 'PX', breakerConfig().probeTimeoutMs, 'NX');
      return claimed === 'OK' ? { paused: false, probe: true } : { paused: true, until: null, reason: state.reason };
    })(), ADMIT_DEADLINE_MS);
  } catch (error) {
    unavailable(error);
    return unjudged;
  }
  available();
  if (verdict.paused) throw new PluginVersionQuarantinedError(ref, verdict.until, verdict.reason);
  return { ...ref, probe: verdict.probe, tracked: true };
}

/**
 * After the call: count it in the window (opening the breaker when the failures are enough of the calls), or decide
 * the probe. `target` is what the call ran (`<point>#<op>`, `GET /path`); the operator's view shows the one that
 * opened it. Never throws.
 */
export async function settlePluginVersion(ticket: VersionTicket, outcome: IsolateOutcome, target: string, now = Date.now()): Promise<void> {
  if (!ticket.tracked) return;
  const k = keysOf(ticket.pluginVersionId);
  const cfg = breakerConfig();
  const base = { scope: PLUGIN_VERSION_SCOPE, contributionId: ticket.pluginVersionId, moduleId: ticket.pluginId, point: target };
  try {
    const r = await client();
    if (outcome === 'not-judged') {
      // A probe that says nothing about the plugin is handed to the next call.
      if (ticket.probe) await r.del(k.probe);
      return;
    }
    if (ticket.probe) {
      if (outcome === 'ok') {
        await r.del(k.open, k.state, k.probe);
        announceBreakerTransition({ ...base, to: 'closed' });
        return;
      }
      // The probe failed: stay out for twice as long (up to the cap).
      const prev = parseState(await r.get(k.state));
      const reopenings = (prev?.reopenings ?? 0) + 1;
      const cooldown = Math.min(cfg.cooldownMs * 2 ** reopenings, cfg.maxCooldownMs);
      await r.set(k.open, JSON.stringify({ until: now + cooldown, reason: outcome }), 'PX', cooldown);
      await r.set(k.state, JSON.stringify({ reopenings, reason: outcome, target, openedAt: prev?.openedAt ?? now } satisfies VersionState), 'PX', cooldown + stateGraceMs());
      await r.del(k.probe);
      announceBreakerTransition({ ...base, to: 'open', until: now + cooldown, reason: outcome, reopenings, failures: 1 });
      return;
    }
    const w = Math.floor(now / cfg.windowMs);
    const tx = r.multi().incr(k.calls(w)).pexpire(k.calls(w), 2 * cfg.windowMs);
    if (outcome !== 'ok') tx.incr(k.fails(w)).pexpire(k.fails(w), 2 * cfg.windowMs);
    const replies = await tx.exec();
    if (outcome === 'ok') return;
    const calls = Number(replies?.[0]?.[1]);
    const failures = Number(replies?.[2]?.[1]);
    if (!(failures >= cfg.threshold && failures / calls >= cfg.minFailureRatio)) return;
    // Paused or being tested already: a straggler admitted before that does not open it afresh.
    if (await r.get(k.state)) return;
    // Every process that sees the threshold crossed tries; NX lets exactly one of them open it and say so. The open
    // key goes first, so admission never sees the state without it (which would read as "cooled down").
    const opened = await r.set(k.open, JSON.stringify({ until: now + cfg.cooldownMs, reason: outcome }), 'PX', cfg.cooldownMs, 'NX');
    if (opened !== 'OK') return;
    await r.set(k.state, JSON.stringify({ reopenings: 0, reason: outcome, target, openedAt: now } satisfies VersionState), 'PX', cfg.cooldownMs + stateGraceMs());
    await r.del(k.calls(w), k.fails(w));
    announceBreakerTransition({ ...base, to: 'open', until: now + cfg.cooldownMs, reason: outcome, reopenings: 0, failures });
  } catch (error) {
    unavailable(error);
  }
}

/** An operator's "close now": the version is called again at once, with a clean window. Redis errors reach the caller. */
export async function closePluginVersionBreaker(pluginVersionId: string, now = Date.now()): Promise<void> {
  const r = await client();
  const k = keysOf(pluginVersionId);
  const w = Math.floor(now / breakerConfig().windowMs);
  await r.del(k.open, k.state, k.probe, k.calls(w), k.fails(w), k.calls(w - 1), k.fails(w - 1));
}

/**
 * An operator's "keep open": paused until `until`, with no probe before then; afterwards one probe as usual, its
 * reopen count kept. Redis errors reach the caller.
 */
export async function holdPluginVersionBreaker(pluginVersionId: string, until: number, reason: string, now = Date.now()): Promise<void> {
  const r = await client();
  const k = keysOf(pluginVersionId);
  const ms = Math.max(1, until - now);
  const prev = parseState(await r.get(k.state));
  await r.set(k.open, JSON.stringify({ until, reason, held: true }), 'PX', ms);
  await r.set(k.state, JSON.stringify({ ...prev, reopenings: prev?.reopenings ?? 0, openedAt: prev?.openedAt ?? now, held: true } satisfies VersionState), 'PX', ms + stateGraceMs());
  await r.del(k.probe);
}
