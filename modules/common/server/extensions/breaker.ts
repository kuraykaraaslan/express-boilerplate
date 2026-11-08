// Circuit breaker per contribution (docs/phases/37-extensions/04, EXT-7).
//
// A contribution that keeps failing for a tenant stops being called before it degrades its hosts, comes back by
// itself when it recovers, and every opening is announced (onBreakerTransition) so observability can count it and
// tell the people who can act. State is per process: each worker judges what it sees, which is what bounds the
// damage in that worker. The cross-process view for operators is observability's (it records the transitions), and
// an operator's "close now" / "keep open" reaches every process through observability's command channel.
//
// The judgement is a rolling window of calls, not a run of failures: it opens when the window holds at least
// `threshold` failures AND they are at least `minFailureRatio` of the window's calls. A success no longer wipes the
// slate, so a contributor that fails every other call opens too (it used to reset on each success and never did).
// Community plugin VERSIONS are judged across tenants and processes in Redis (plugin-version-breaker.ts); they share
// the thresholds and the announcements here.

/** Who a breaker is about: one tenant, or `system` work that belongs to no tenant. */
export type BreakerScope = string;

/** The scope a community plugin version is judged in (EXT-7): one breaker per version, shared by every tenant. */
export const PLUGIN_VERSION_SCOPE = 'plugin-version';

export interface BreakerConfig {
  /** Failures inside `windowMs` that may open the breaker… */
  threshold: number;
  /** …when they are also at least this share of the window's calls (0.5: every other call failed). */
  minFailureRatio: number;
  windowMs: number;
  /** First open period; each failed probe doubles it up to `maxCooldownMs`. */
  cooldownMs: number;
  maxCooldownMs: number;
  /**
   * How long a probe that was let through may stay unanswered before another call may probe. A host that selected an
   * implementation and never called it would otherwise keep the probe, and the contributor, out for good.
   */
  probeTimeoutMs: number;
}

export const DEFAULT_BREAKER: BreakerConfig = {
  threshold: 5, minFailureRatio: 0.5, windowMs: 60_000, cooldownMs: 5 * 60_000, maxCooldownMs: 60 * 60_000, probeTimeoutMs: 60_000,
};

export interface BreakerTransition {
  scope: BreakerScope;
  contributionId: string;
  point: string;
  moduleId: string;
  to: 'open' | 'closed';
  /** For `open`: when the next probe is allowed. */
  until?: number;
  /** For `open`: the last failure that counted. For `closed`: set when an operator closed it. */
  reason?: string;
  /** For `open`: how many times in a row it reopened after a failed probe (0 = first opening). */
  reopenings?: number;
  /** For `open`: the failures that opened it (the window's count, or 1 for a failed probe). */
  failures?: number;
}

/** Calls and failures of one slice of the window. */
interface Bucket {
  at: number;
  calls: number;
  failures: number;
}

interface Entry {
  point: string;
  moduleId: string;
  buckets: Bucket[];
  openUntil: number | null;
  /** When the probe in flight was let through; null when none is. */
  probeAt: number | null;
  cooldownMs: number;
  reopenings: number;
  /** An operator said "keep open": no probe before `openUntil`. */
  held: boolean;
  lastReason?: string;
}

/** The window is kept in this many slices, so memory per contribution stays fixed however many calls it gets. */
const BUCKETS = 12;

const entries = new Map<string, Entry>();
const listeners = new Set<(t: BreakerTransition) => void>();
let config: BreakerConfig = DEFAULT_BREAKER;
// Unit tests call hosts many times with the same failing fake; a live breaker would change their results halfway.
// eslint-disable-next-line no-restricted-syntax -- the test runner's marker, not configuration; common cannot import env
let enabled = !process.env.VITEST;
let lastSweep = 0;

const keyOf = (scope: BreakerScope, contributionId: string) => `${scope}|${contributionId}`;

/** Tests and deployments: thresholds, and whether the breaker acts at all. */
export function configureBreaker(next: Partial<BreakerConfig> & { enabled?: boolean } = {}): void {
  const { enabled: on, ...rest } = next;
  config = { ...DEFAULT_BREAKER, ...rest };
  if (on !== undefined) enabled = on;
}

/** The thresholds in force (the plugin-version breaker judges with the same ones). */
export function breakerConfig(): BreakerConfig {
  return config;
}

export function breakerEnabled(): boolean {
  return enabled;
}

export function resetBreakers(): void {
  entries.clear();
  lastSweep = 0;
}

export function onBreakerTransition(listener: (t: BreakerTransition) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tell every observer about a transition. Exported for the plugin-version breaker, which judges in Redis. */
export function announceBreakerTransition(t: BreakerTransition): void {
  for (const l of listeners) {
    try { l(t); } catch { /* an observer must never break a host */ }
  }
}

const probeLive = (e: Entry, now: number) => e.probeAt !== null && now - e.probeAt < config.probeTimeoutMs;

/**
 * True while the breaker keeps this contribution out: open and still cooling down, or a probe already in flight.
 * Pure — it does not claim the probe (listing contributions for a view must not spend it).
 */
export function isQuarantined(scope: BreakerScope, contributionId: string, now = Date.now()): boolean {
  if (!enabled) return false;
  const e = entries.get(keyOf(scope, contributionId));
  if (!e || e.openUntil === null) return false;
  return now < e.openUntil || probeLive(e, now);
}

/** Called right before a contribution runs: a cooled-down open breaker lets exactly this call through as the probe. */
export function beforeCall(scope: BreakerScope, contributionId: string, now = Date.now()): void {
  if (!enabled) return;
  const e = entries.get(keyOf(scope, contributionId));
  if (e && e.openUntil !== null && now >= e.openUntil && !probeLive(e, now)) e.probeAt = now;
}

type Contribution = { id: string; point: string; moduleId: string };

function entryFor(key: string, c: { point: string; moduleId: string }): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { point: c.point, moduleId: c.moduleId, buckets: [], openUntil: null, probeAt: null, cooldownMs: config.cooldownMs, reopenings: 0, held: false };
    entries.set(key, e);
  }
  return e;
}

/** Count one call (and maybe a failure) in the window; returns the window's totals. */
function count(e: Entry, failed: boolean, now: number): { calls: number; failures: number } {
  const slice = Math.max(1, Math.floor(config.windowMs / BUCKETS));
  const at = now - (now % slice);
  e.buckets = e.buckets.filter((b) => now - b.at < config.windowMs);
  let b = e.buckets.at(-1);
  if (!b || b.at !== at) {
    b = { at, calls: 0, failures: 0 };
    e.buckets.push(b);
  }
  b.calls += 1;
  if (failed) b.failures += 1;
  let calls = 0;
  let failures = 0;
  for (const x of e.buckets) { calls += x.calls; failures += x.failures; }
  return { calls, failures };
}

/** Drop the closed entries whose window has emptied (there would be one per contribution and scope ever called). */
function sweep(now: number): void {
  if (now - lastSweep < config.windowMs) return;
  lastSweep = now;
  for (const [key, e] of entries) {
    if (e.openUntil === null && e.probeAt === null && e.buckets.every((b) => now - b.at >= config.windowMs)) entries.delete(key);
  }
}

/** A call that answered (a value, or a typed refusal the contribution chose). A probe that answers closes the breaker. */
export function recordSuccess(scope: BreakerScope, contribution: Contribution, now = Date.now()): void {
  if (!enabled) return;
  sweep(now);
  const key = keyOf(scope, contribution.id);
  const e = entryFor(key, contribution);
  if (e.openUntil !== null) {
    // Only the probe speaks for a paused contributor; a straggler that started before it opened does not.
    if (e.probeAt === null) return;
    entries.delete(key);
    announceBreakerTransition({ scope, contributionId: contribution.id, point: e.point, moduleId: e.moduleId, to: 'closed' });
    return;
  }
  count(e, false, now);
}

/** A failure that counts: a throw, a timeout, a load error or an answer that broke the contract. */
export function recordFailure(scope: BreakerScope, contribution: Contribution, reason: string, now = Date.now()): void {
  if (!enabled) return;
  sweep(now);
  const e = entryFor(keyOf(scope, contribution.id), contribution);
  e.lastReason = reason;
  if (e.openUntil !== null) {
    if (e.probeAt === null) return; // already open; a straggler from before it opened
    // The probe failed: stay out for twice as long.
    e.probeAt = null;
    e.held = false;
    e.reopenings += 1;
    e.cooldownMs = Math.min(e.cooldownMs * 2, config.maxCooldownMs);
    e.openUntil = now + e.cooldownMs;
    announceBreakerTransition({ scope, contributionId: contribution.id, point: e.point, moduleId: e.moduleId, to: 'open', until: e.openUntil, reason, reopenings: e.reopenings, failures: 1 });
    return;
  }
  const { calls, failures } = count(e, true, now);
  if (failures >= config.threshold && failures / calls >= config.minFailureRatio) {
    e.buckets = [];
    e.openUntil = now + e.cooldownMs;
    announceBreakerTransition({ scope, contributionId: contribution.id, point: e.point, moduleId: e.moduleId, to: 'open', until: e.openUntil, reason, reopenings: e.reopenings, failures });
  }
}

/**
 * An operator's "close now": the contribution runs again at once, with a clean window and the first cooldown. Announced
 * (to `closed`) only by a process where it was open. Returns whether it was.
 */
export function closeBreaker(scope: BreakerScope, contributionId: string, reason = 'closed by an operator'): boolean {
  const key = keyOf(scope, contributionId);
  const e = entries.get(key);
  if (!e) return false;
  entries.delete(key);
  if (e.openUntil === null) return false;
  announceBreakerTransition({ scope, contributionId, point: e.point, moduleId: e.moduleId, to: 'closed', reason });
  return true;
}

/**
 * An operator's "keep open": the contribution stays out until `until`, with no probe before then. It need not be open
 * in this process yet (the command reaches every process), hence `point` and `moduleId`. Not announced: the operator's
 * view is written once by the process that took the command, not by every process that applies it.
 */
export function holdBreaker(
  scope: BreakerScope, contributionId: string, until: number, info: { point: string; moduleId: string; reason?: string },
): void {
  if (!enabled) return;
  const e = entryFor(keyOf(scope, contributionId), info);
  e.openUntil = until;
  e.probeAt = null;
  e.held = true;
  e.buckets = [];
  if (info.reason) e.lastReason = info.reason;
}

/** Open breakers in this process, for a scope or all (admin views, health endpoints). */
export function openBreakers(scope?: BreakerScope, now = Date.now()): Array<{ scope: BreakerScope; contributionId: string; point: string; moduleId: string; until: number; probing: boolean; held: boolean; reason?: string }> {
  const out = [];
  for (const [key, e] of entries) {
    if (e.openUntil === null) continue;
    const [s, ...rest] = key.split('|');
    if (scope && s !== scope) continue;
    out.push({ scope: s, contributionId: rest.join('|'), point: e.point, moduleId: e.moduleId, until: e.openUntil, probing: probeLive(e, now) && now >= e.openUntil, held: e.held, reason: e.lastReason });
  }
  return out;
}
