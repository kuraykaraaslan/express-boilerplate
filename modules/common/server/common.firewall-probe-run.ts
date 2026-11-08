import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The probe-run stamp of the AI firewall's label collector (docs/phases/55-ai-firewall/03 §3.3, §3.4; D55-82 to D55-86).
 *
 * The probe runner (`scripts/fw-probe`) and the benign-traffic sources (e2e tester runs, the siege server's normal scenarios, the demo's
 * scripted traffic) mark their requests with a run id and the label class the request produces. Whether that mark is believed is decided
 * ONCE per request, at the tenant API dispatcher, by `common.firewall-probe-gate.ts` (a staging or demo install AND the runner's own
 * credential); only a request it accepted runs inside `runWithProbeRun`. Every security signal emitted inside that request then carries
 * the run (`probe.run`) and the class (`probe.class`), stamped by `emitSecuritySignal` (common.firewall-contracts.ts) from this context;
 * the label collector of ai_firewall (labels/ai_firewall.probe-labels.ts) turns the stored events into `synthetic` or `benign_traffic`
 * labels, and checks the install role again before it does (FWA-10).
 *
 * The stamp is NEVER taken from the signal's input: `emitSecuritySignal` removes every `probe.*` attribute a producer passed, so a request
 * string, an audit row's metadata (which travels as `m.*` anyway) or a contributor cannot forge one.
 *
 * Bounded in time: the stamp applies while the request runs and for `PROBE_STAMP_GRACE_MS` after it ended (the audit sinks are told
 * after the row committed, detached, and may run just after the answer), never longer than `PROBE_STAMP_MAX_MS` after it started. A
 * timer that some batching producer happened to arm inside a probe request and that fires later therefore stamps nothing; the firewall's
 * own batched emitters (the tally) run their flush outside any stamp (`outsideProbeRun`).
 *
 * No I/O, no env, no imports but node:async_hooks: `common.firewall-contracts.ts` (imported everywhere) reads it.
 */

/** A request's accepted mark. `source` follows the class: `benign` is benign traffic, anything else a synthetic attack. */
export interface ProbeStamp {
  /** The runner's run id (PROBE_RUN_ID_RE). */
  runId: string;
  /** The label class the request declares (a class of ai_firewall's LABEL_CLASSES; checked again by the collector). */
  labelClass: string;
  source: 'synthetic' | 'benign_traffic';
  /** Epoch ms the request started; set by `runWithProbeRun`. */
  startedAt: number;
  /** Epoch ms the request ended, null while it runs; set by `runWithProbeRun`. */
  endedAt: number | null;
}

/** The attributes a stamped signal carries (reserved: a producer's own `probe.*` attributes are dropped). */
export const PROBE_RUN_ATTR = 'probe.run';
export const PROBE_CLASS_ATTR = 'probe.class';
export const PROBE_ATTR_PREFIX = 'probe.';

/** How long after its request ended a stamp still applies (detached audit sinks), and the longest a stamp lives at all. */
export const PROBE_STAMP_GRACE_MS = 5_000;
export const PROBE_STAMP_MAX_MS = 6 * 60_000;

/** A run id: 8 to 64 of [A-Za-z0-9_.:-], starting with a letter or digit. */
export const PROBE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$/;
/** A declared class: a lower-case slug of at most 32 characters (the closed list is ai_firewall's). */
export const PROBE_CLASS_RE = /^[a-z][a-z_]{0,31}$/;

const STORE_KEY = Symbol.for('kuraykaraaslan-labs.common.firewallProbeRun');
const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<ProbeStamp> | undefined>;
/** One store per process (the instrumentation hook and the route bundles can each load this file). */
const store = (): AsyncLocalStorage<ProbeStamp> => (holder[STORE_KEY] ??= new AsyncLocalStorage<ProbeStamp>());

/**
 * Runs `fn` with `stamp` as the request's accepted mark (null: runs it as it is). The stamp's end is recorded when `fn` settles. Only the
 * dispatcher calls this, with what the gate accepted.
 */
export async function runWithProbeRun<T>(stamp: Omit<ProbeStamp, 'startedAt' | 'endedAt'> | null, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  if (!stamp) return fn();
  const live: ProbeStamp = { ...stamp, startedAt: now(), endedAt: null };
  try {
    return await store().run(live, fn);
  } finally {
    live.endedAt = now();
  }
}

/** The stamp that applies now, or null (no probe request, or its time is over). Never throws. */
export function currentProbeRun(now: number = Date.now()): ProbeStamp | null {
  try {
    const s = store().getStore();
    if (!s) return null;
    if (now - s.startedAt > PROBE_STAMP_MAX_MS) return null;
    if (s.endedAt !== null && now - s.endedAt > PROBE_STAMP_GRACE_MS) return null;
    return s;
  } catch {
    return null;
  }
}

/** Runs `fn` with no stamp at all (a batched emitter's flush serves many requests and is none of them). */
export function outsideProbeRun<T>(fn: () => T): T {
  return store().exit(fn);
}

/**
 * The attributes a signal is written with: the producer's own without any `probe.*` key, plus the stamp's two when one applies. Pure
 * apart from reading the context (`stamp` defaults to `currentProbeRun()`).
 */
export function withProbeAttrs<V>(attrs: Record<string, V> | undefined, stamp: ProbeStamp | null = currentProbeRun()): Record<string, V | string> | undefined {
  let out: Record<string, V | string> | undefined = attrs;
  if (attrs && Object.keys(attrs).some((k) => k.startsWith(PROBE_ATTR_PREFIX))) {
    out = Object.fromEntries(Object.entries(attrs).filter(([k]) => !k.startsWith(PROBE_ATTR_PREFIX)));
  }
  if (!stamp) return out;
  // first, so the contract's attribute cap (SIGNAL_ATTRS_MAX) cuts a producer's last attribute rather than the stamp
  return { [PROBE_RUN_ATTR]: stamp.runId, [PROBE_CLASS_ATTR]: stamp.labelClass, ...(out ?? {}) };
}
