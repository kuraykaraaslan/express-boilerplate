import type { SecuritySignalInput } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

/**
 * Request-only patterns reach the detectors (docs/phases/55-ai-firewall/02 §2.3; D55-21 holds): enumeration through 404s, a bot on public
 * pages, injection probes leave no signal of their own, only request counters in the feature store, whose keys are keyed hashes the
 * worker cannot turn back into an actor. So the request fold, when it flushes (every 5 s, off the request path), looks at each actor's
 * counters of that flush and nominates the few that are worth a look with ONE `ai_firewall.request_pattern` signal: counts only (never a
 * path, a body or a header value), at most once per actor per HINT_COOLDOWN_MS and at most HINTS_PER_FLUSH per flush and process. The
 * worker's consumers store it (evidence for 2.4), fold it, and queue the actor for the detectors.
 *
 * Its registered weight is 0: the signal names the actor, the counters it summarises are already in the windows.
 */
export const REQUEST_PATTERN_KIND = 'ai_firewall.request_pattern';
export const HINTS_PER_FLUSH = 50;
export const HINT_COOLDOWN_MS = 30_000;

/** The bars of one flush's counters (≈ 5 s of one process) above which an actor is worth a look. */
export const HINT_BARS = {
  refusals: 10,
  sequential: 5,
  indicators: 1,
  authFailures: 3,
  headerAnomalies: 10,
  requests: 50,
  deepPages: 3,
  exportBytes: 5_000_000,
  adminWrites: 20,
  scripted: 20,
  regular: 10,
} as const;

const c = (counters: Readonly<Record<string, number>>, field: string): number => counters[field] ?? 0;

/** The summary a nomination carries (all counts of the flush). */
export function requestPatternCounts(counters: Readonly<Record<string, number>>): Record<string, number> {
  return {
    requests: c(counters, 'rq'),
    refusals: c(counters, 'st:401') + c(counters, 'st:403') + c(counters, 'st:404'),
    sequential: c(counters, 'seq'),
    indicators: c(counters, 'ix:sql') + c(counters, 'ix:script') + c(counters, 'ix:traversal') + c(counters, 'ix:template') + c(counters, 'ix:command'),
    authFailures: c(counters, 'ar:fail'),
    headerAnomalies: c(counters, 'hna'),
    deepPages: c(counters, 'pgd'),
    exportBytes: c(counters, 'xb'),
    adminWrites: c(counters, 'adm'),
    scripted: c(counters, 'ua:cli') + c(counters, 'ua:library') + c(counters, 'ua:empty') + c(counters, 'ua:bot'),
    regular: c(counters, 'tr'),
  };
}

/** Whether one flush's counters of an actor clear any bar. Pure. */
export function worthALook(counters: Readonly<Record<string, number>>): boolean {
  const s = requestPatternCounts(counters);
  return (Object.keys(HINT_BARS) as Array<keyof typeof HINT_BARS>).some((bar) => (s[bar] ?? 0) >= HINT_BARS[bar]);
}

export interface PatternActor {
  /** null = the platform (an address). */
  tenantId: string | null;
  kind: 'ip' | 'user' | 'apiKey';
  id: string;
  role: string | null;
}

/** The nomination signal of one actor. */
export function requestPatternSignal(actor: PatternActor, counters: Readonly<Record<string, number>>, atMs: number): SecuritySignalInput {
  return {
    at: new Date(atMs),
    tenantId: actor.tenantId,
    lane: actor.kind === 'apiKey' ? 'machine-apikey' : 'unknown',
    kind: REQUEST_PATTERN_KIND,
    actor: { kind: actor.kind, id: actor.id },
    outcome: 'info',
    severity: 'low',
    attrs: { ...requestPatternCounts(counters), ...(actor.role ? { role: actor.role } : {}) },
    source: 'ai_firewall',
  };
}
