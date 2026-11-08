/**
 * The AI firewall's tally of high-volume signals (docs/phases/55-ai-firewall/02 §2.6, 01 §1.4c).
 *
 * Some signals happen once per request under an attack: a rate-limit refusal, a refused refresh token, a CSP report. At 3 333 req/s one
 * signal per request would be one stream entry per request, so these producers never emit one per occurrence. They hand it to
 * `tallySecuritySignal`, which only counts: the occurrence is folded into this process's window, keyed by everything the signal says
 * (kind, tenant, lane, actor, subject, outcome, severity and its few code attributes). One timer per window (`TALLY_WINDOW_MS`) emits ONE
 * signal per key through `emitSecuritySignal` with the count (`count`) and the window (`windowSeconds`), so a flood of refusals from one
 * address is one signal every few seconds, and the stream write stays the intake's one bounded pipeline.
 *
 * Fails open (FWA-7): synchronous, never throws, never awaits, nothing on the request's path but a string join and a Map update (a few
 * microseconds; a micro-benchmark test bounds it). The attributes a producer passes are codes it chose (a scope, a reason, a directive
 * class), never a raw path, body or header value: they are part of the key.
 *
 * Bounded twice (D55-66, D55-67). A window holds at most `TALLY_KEYS_MAX` keys, one kind at most `TALLY_KEYS_PER_KIND_MAX` of them, and
 * the signals below `high` leave `TALLY_KEYS_HIGH_RESERVE` keys free for the rest, so anonymous low-severity reports (CSP, a busy bucket)
 * cannot crowd out a refused refresh token; an occurrence of a further key is dropped and counted by the budget that refused it
 * (`ai_firewall_signal_tally_overflow_total{budget}`), never retried. A flush hands the intake no more signals than its buffer takes
 * (`securitySignalBufferRoom`, the critical reserve left out), the `high` and `critical` ones first, and carries the rest, counts intact,
 * to a flush `TALLY_CARRY_RETRY_MS` later: a full window never spills into `buffer_full`, and a decoy touch still finds its reserve.
 *
 * Like the intake, the state lives on `globalThis` (the instrumentation hook and the route bundles can each load this file).
 */
import {
  emitSecuritySignal,
  securitySignalBufferRoom,
  signalAttr,
  type ActorRef,
  type FirewallSignalAttribute,
  type SignalLane,
  type SignalOutcome,
  type SignalSeverity,
  type SubjectRef,
} from './common.firewall-contracts';
import { registerDrainHook, registerMetricSource } from './process-hooks';
import { outsideProbeRun } from './common.firewall-probe-run';

/** How long one window counts before its keys are emitted. */
export const TALLY_WINDOW_MS = 10_000;
/** Distinct keys one window of this process holds (kept below the intake's room, so one flush fits the buffer: D55-66). */
export const TALLY_KEYS_MAX = 1_500;
/** Distinct keys one kind may hold in a window (D55-67). */
export const TALLY_KEYS_PER_KIND_MAX = 600;
/** Keys of a window that only a `high` or `critical` signal may take (D55-67). */
export const TALLY_KEYS_HIGH_RESERVE = 300;
/** How soon a flush that could not hand over every key tries again with the carried ones. */
export const TALLY_CARRY_RETRY_MS = 1_000;
/** Attributes one tallied signal may carry (they are part of the key, so they must be few and coded). */
export const TALLY_ATTRS_MAX = 8;
/** Longest attribute value kept in the key; a longer one is cut (a producer passes codes, so this never bites a real one). */
const TALLY_VALUE_MAX = 64;
/** The budgets that can refuse a new key. */
export const TALLY_BUDGETS = ['window', 'kind', 'high_reserve'] as const;
export type TallyBudget = (typeof TALLY_BUDGETS)[number];

/** The attributes every tallied signal carries, for the kind's `ai_firewall:signal` declaration. */
export const TALLY_SIGNAL_ATTRS: Readonly<Record<string, FirewallSignalAttribute>> = {
  count: signalAttr.number('none', 'occurrences in the window this signal stands for'),
  windowSeconds: signalAttr.number('none', 'the length of that window, seconds'),
};

/** What a producer tallies: a signal without `id` and `at`, whose attributes are codes (string, number or boolean). */
export interface TallyInput {
  tenantId: string | null;
  lane?: SignalLane;
  kind: string;
  actor: ActorRef;
  subject?: SubjectRef | null;
  outcome: SignalOutcome;
  severity?: SignalSeverity;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  source: string;
}

interface Entry {
  key: string;
  input: TallyInput;
  count: number;
  firstAt: number;
  /** When the window this key was first counted in began (a carried key keeps it, so `windowSeconds` covers the whole wait). */
  since: number;
  high: boolean;
}

interface TallyState {
  entries: Map<string, Entry>;
  /** Keys per kind in the current window. */
  perKind: Map<string, number>;
  /** Keys below `high` in the current window. */
  belowHigh: number;
  timer: ReturnType<typeof setTimeout> | null;
  windowStart: number;
  tallied: number;
  emitted: number;
  carried: number;
  overflow: Record<TallyBudget, number>;
  hooksRegistered: boolean;
}

const STATE_KEY = Symbol.for('kuraykaraaslan-labs.common.firewallSignalTally');
const holder = globalThis as unknown as Record<symbol, TallyState | undefined>;
const fresh = (): TallyState => ({
  entries: new Map(), perKind: new Map(), belowHigh: 0, timer: null, windowStart: 0, tallied: 0, emitted: 0, carried: 0,
  overflow: { window: 0, kind: 0, high_reserve: 0 }, hooksRegistered: false,
});
const state = (): TallyState => (holder[STATE_KEY] ??= fresh());

const overflowTotal = (s: TallyState): number => s.overflow.window + s.overflow.kind + s.overflow.high_reserve;

function registerHooksOnce(s: TallyState): void {
  if (s.hooksRegistered) return;
  s.hooksRegistered = true;
  registerMetricSource({
    name: 'ai_firewall_signal_tally_overflow_total',
    help: 'Occurrences of tallied security signals this process dropped because a budget of the window was spent (window, kind, high_reserve; never retried; FWA-7).',
    labelNames: ['budget'],
    read: async () => TALLY_BUDGETS.map((budget) => ({ labels: { budget }, value: state().overflow[budget] })),
  });
  registerDrainHook('ai_firewall:signal-tally', () => { flushSecuritySignalTally(); });
}

const isHigh = (severity: SignalSeverity | undefined): boolean => severity === 'high' || severity === 'critical';

const cut = (v: string): string => (v.length > TALLY_VALUE_MAX ? v.slice(0, TALLY_VALUE_MAX) : v);

/** The attributes as they are counted: at most TALLY_ATTRS_MAX, codes only, strings cut. */
function codedAttrs(attrs: TallyInput['attrs']): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!attrs) return out;
  let n = 0;
  for (const name in attrs) {
    if (n >= TALLY_ATTRS_MAX) break;
    const v = attrs[name];
    if (v === undefined || name === 'count' || name === 'windowSeconds') continue;
    if (typeof v === 'string') out[name] = cut(v);
    else if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[name] = v;
    else continue;
    n += 1;
  }
  return out;
}

function keyOf(i: TallyInput, attrs: Record<string, string | number | boolean | null>): string {
  let k = `${i.kind}\u0000${i.source}\u0000${i.tenantId ?? ''}\u0000${i.lane ?? ''}\u0000${i.actor.kind}\u0000${i.actor.id}\u0000${i.outcome}\u0000${i.severity ?? ''}`;
  if (i.subject) k += `\u0000s${i.subject.type}\u0001${i.subject.id}`;
  for (const name in attrs) k += `\u0000${name}\u0001${String(attrs[name])}`;
  return k;
}

function schedule(s: TallyState, now: number, delayMs: number = TALLY_WINDOW_MS): void {
  if (s.timer) return;
  s.windowStart = now;
  // a window holds many requests' occurrences: its flush runs outside any probe-run stamp (03 §3.3, D55-83)
  s.timer = outsideProbeRun(() => setTimeout(() => {
    s.timer = null;
    outsideProbeRun(() => flushSecuritySignalTally());
  }, delayMs));
  (s.timer as { unref?: () => void }).unref?.();
}

/** Puts an entry into the current window and counts it against the budgets (the caller checked them, or carries it over). */
function admit(s: TallyState, e: Entry): void {
  s.entries.set(e.key, e);
  s.perKind.set(e.input.kind, (s.perKind.get(e.input.kind) ?? 0) + 1);
  if (!e.high) s.belowHigh += 1;
}

/** The budget a new key of `kind` would overspend, or null when it fits. */
function spentBudget(s: TallyState, kind: string, high: boolean): TallyBudget | null {
  if (s.entries.size >= TALLY_KEYS_MAX) return 'window';
  if ((s.perKind.get(kind) ?? 0) >= TALLY_KEYS_PER_KIND_MAX) return 'kind';
  if (!high && s.belowHigh >= TALLY_KEYS_MAX - TALLY_KEYS_HIGH_RESERVE) return 'high_reserve';
  return null;
}

/**
 * Counts one occurrence of a high-volume signal (see the header). Synchronous, never throws, never waits. Answers whether it was
 * counted (false: an input that is no signal, or a budget of the window that is spent).
 */
export function tallySecuritySignal(input: TallyInput, now: number = Date.now()): boolean {
  try {
    if (!input || typeof input.kind !== 'string' || !input.actor || typeof input.actor.id !== 'string') return false;
    const s = state();
    registerHooksOnce(s);
    const attrs = codedAttrs(input.attrs);
    const key = keyOf(input, attrs);
    const entry = s.entries.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      const high = isHigh(input.severity);
      const spent = spentBudget(s, input.kind, high);
      if (spent) { s.overflow[spent] += 1; return false; }
      schedule(s, now);
      admit(s, { key, input: { ...input, attrs }, count: 1, firstAt: now, since: s.windowStart, high });
    }
    s.tallied += 1;
    return true;
  } catch {
    return false;
  }
}

/**
 * Emits one signal per key of the window, as many as the intake's buffer takes now (`high` and `critical` first), and starts the next
 * window with the keys that did not fit (carried, counts intact, retried `TALLY_CARRY_RETRY_MS` later). Called by the window's timer, by
 * the drain hook and by tests. Never throws. Answers how many signals were handed to the intake.
 */
export function flushSecuritySignalTally(now: number = Date.now()): number {
  const s = state();
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (s.entries.size === 0) return 0;
  // the high ones first; Array.prototype.sort is stable, so within a class the older keys (the carried ones) go first
  const entries = [...s.entries.values()].sort((a, b) => Number(b.high) - Number(a.high));
  s.entries = new Map();
  s.perKind = new Map();
  s.belowHigh = 0;
  let room = securitySignalBufferRoom();
  let emitted = 0;
  let carried = 0;
  for (const e of entries) {
    if (room <= 0) { admit(s, e); carried += 1; continue; }
    room -= 1;
    try {
      const accepted = emitSecuritySignal({
        tenantId: e.input.tenantId,
        lane: e.input.lane,
        kind: e.input.kind,
        actor: e.input.actor,
        subject: e.input.subject ?? null,
        outcome: e.input.outcome,
        severity: e.input.severity,
        at: new Date(e.firstAt),
        attrs: { ...e.input.attrs, count: e.count, windowSeconds: Math.max(1, Math.round((now - e.since) / 1000)) },
        source: e.input.source,
      });
      if (accepted) emitted += 1;
    } catch {
      // emitSecuritySignal never throws; nothing reaches a caller either way
    }
  }
  s.emitted += emitted;
  s.carried += carried;
  if (carried > 0) {
    // the carried keys keep their own `since`; the retry window starts now for keys counted from here on
    schedule(s, now, TALLY_CARRY_RETRY_MS);
  }
  return emitted;
}

/**
 * This process's tally since it started: occurrences counted, signals emitted, keys carried to a later flush, occurrences dropped over a
 * budget (in all and by budget), and the keys of the current window.
 */
export function securitySignalTallyStats(): {
  tallied: number; emitted: number; carried: number; overflow: number; overflowBy: Record<TallyBudget, number>; keys: number;
} {
  const s = state();
  return { tallied: s.tallied, emitted: s.emitted, carried: s.carried, overflow: overflowTotal(s), overflowBy: { ...s.overflow }, keys: s.entries.size };
}

/** Test seam: forget the window and the counts. */
export function resetSecuritySignalTally(): void {
  const s = holder[STATE_KEY];
  if (s?.timer) clearTimeout(s.timer);
  holder[STATE_KEY] = fresh();
}
