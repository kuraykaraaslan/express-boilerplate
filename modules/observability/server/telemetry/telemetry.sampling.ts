/**
 * Tail sampling (phase 17.2): decided on the whole trace as it arrives, so the interesting ones survive.
 *
 * A trace is KEPT when any span is an error or the trace is slow; every other trace is kept with probability `baseRate`, decided by a
 * hash of the trace id so every batch of one trace (and every NB instance) reaches the same answer. The default policy keeps
 * everything (`baseRate: 1`): sampling is an opt-in cost control, not a default data loss.
 *
 * Limits, stated plainly: OTLP batches arrive in pieces, so the decision is made per batch. A `TraceDecisionStore` remembers the
 * traces already kept, so a later batch of a kept trace is kept even when it holds no error. A trace dropped by the base rate and
 * then followed by a batch with an error keeps only that batch. A real collector with a decision wait would do better; this is the
 * best that is possible without a second stateful service.
 */
import type { SpanRecord } from './telemetry.types';
import { durationMs, nsToMs } from './telemetry.util';

export interface TailSamplingPolicy {
  keepErrors: boolean;
  /** A span or a trace at least this long is slow. `0` turns the slow rule off. */
  slowMs: number;
  /** Probability (0..1) that an uninteresting trace is kept. */
  baseRate: number;
}

export const DEFAULT_SAMPLING: TailSamplingPolicy = { keepErrors: true, slowMs: 1000, baseRate: 1 };

export type Decision = { keep: true; reason: 'error' | 'slow' | 'sampled' | 'remembered' } | { keep: false; reason: 'dropped' };

export interface TraceDecisionStore {
  has(key: string): boolean;
  remember(key: string): void;
}

/** Bounded in-process memory of kept traces: oldest entries go first, entries expire after `ttlMs`. */
export class MemoryDecisionStore implements TraceDecisionStore {
  private readonly map = new Map<string, number>();

  constructor(private readonly maxEntries = 50_000, private readonly ttlMs = 5 * 60_000, private readonly now: () => number = Date.now) {}

  has(key: string): boolean {
    const at = this.map.get(key);
    if (at === undefined) return false;
    if (this.now() - at > this.ttlMs) { this.map.delete(key); return false; }
    return true;
  }

  remember(key: string): void {
    this.map.delete(key);
    this.map.set(key, this.now());
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value as string);
  }

  get size(): number { return this.map.size; }
}

/** Deterministic value in [0, 1) from a trace id. */
export function traceFraction(traceId: string): number {
  const n = parseInt(traceId.slice(-8), 16);
  return Number.isFinite(n) ? n / 0x1_0000_0000 : 0;
}

function isErrorSpan(s: SpanRecord): boolean {
  if (s.status === 'ERROR') return true;
  const code = s.attributes['http.response.status_code'] ?? s.attributes['http.status_code'];
  return typeof code === 'number' && code >= 500;
}

export function decideTrace(spans: SpanRecord[], policy: TailSamplingPolicy, remembered = false): Decision {
  if (remembered) return { keep: true, reason: 'remembered' };
  if (policy.keepErrors && spans.some(isErrorSpan)) return { keep: true, reason: 'error' };
  if (policy.slowMs > 0) {
    const start = Math.min(...spans.map((s) => nsToMs(s.startNs)));
    const end = Math.max(...spans.map((s) => nsToMs(s.endNs)));
    if (end - start >= policy.slowMs || spans.some((s) => durationMs(s.startNs, s.endNs) >= policy.slowMs)) return { keep: true, reason: 'slow' };
  }
  const rate = Math.min(1, Math.max(0, policy.baseRate));
  if (rate >= 1 || traceFraction(spans[0]!.traceId) < rate) return { keep: true, reason: 'sampled' };
  return { keep: false, reason: 'dropped' };
}

export interface SampleResult {
  kept: SpanRecord[];
  dropped: number;
  /** Per reason, how many traces. */
  traces: Record<string, number>;
}

/** Applies the policy to a batch. `scope` namespaces the store keys (the tenant id), so one tenant's traces never decide another's. */
export function sampleSpans(spans: SpanRecord[], policy: TailSamplingPolicy, scope: string, store?: TraceDecisionStore): SampleResult {
  const byTrace = new Map<string, SpanRecord[]>();
  for (const s of spans) {
    const list = byTrace.get(s.traceId);
    if (list) list.push(s); else byTrace.set(s.traceId, [s]);
  }
  const kept: SpanRecord[] = [];
  const traces: Record<string, number> = {};
  let dropped = 0;
  for (const [traceId, list] of byTrace) {
    const key = `${scope}:${traceId}`;
    const d = decideTrace(list, policy, store?.has(key) ?? false);
    traces[d.reason] = (traces[d.reason] ?? 0) + 1;
    if (d.keep) {
      kept.push(...list);
      if (d.reason !== 'sampled' || policy.baseRate < 1) store?.remember(key);
    } else dropped += list.length;
  }
  return { kept, dropped, traces };
}
