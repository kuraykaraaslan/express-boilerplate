import type { MetricsRegistryLike } from '../process-host';
import type { Supervisor } from './supervisor.core';
import type { ChildState } from './supervisor.types';

/**
 * The supervisor's own series (07 "Observability"), registered on its per-process prom-client registry:
 *
 * | metric | type | labels |
 * |---|---|---|
 * | `process_children` | gauge | kind, state |
 * | `process_scale_signal` | gauge | kind (the smoothed signal; absent without a reading) |
 * | `process_scale_threshold` | gauge | kind, edge = up \| down (and cpu_down when the policy has a CPU condition) |
 * | `process_scale_cpu` | gauge | kind (the group's smoothed CPU, percent of one core; absent without a reading) |
 * | `process_scale_decisions_total` | counter | kind, action, reason |
 * | `process_child_restarts_total` | counter | kind |
 * | `process_crash_loop` | gauge | kind (1 while frozen) |
 */

// prom-client is optional and loaded lazily by process_host; these are the few calls used here
interface PromLike {
  Gauge: new (cfg: { name: string; help: string; labelNames?: string[]; registers?: unknown[]; collect?: (this: GaugeLike) => void }) => GaugeLike;
  Counter: new (cfg: { name: string; help: string; labelNames?: string[]; registers?: unknown[] }) => CounterLike;
  AggregatorRegistry: { aggregate: (metrics: unknown[][]) => MetricsRegistryLike };
}
interface GaugeLike { set(labels: Record<string, string>, value: number): void; reset(): void }
interface CounterLike { inc(labels: Record<string, string>, value?: number): void }

const STATES: ChildState[] = ['starting', 'running', 'draining', 'stopped'];

export function bindSupervisorMetrics(registry: MetricsRegistryLike, promModule: unknown, sup: Supervisor): void {
  const prom = promModule as PromLike;
  const registers = [registry];
  const kind = sup.kind;
  new prom.Gauge({
    name: 'process_children', help: 'Children of the supervised group per state', labelNames: ['kind', 'state'], registers,
    collect() {
      const by = sup.countByState();
      for (const state of STATES) this.set({ kind, state }, by[state]);
    },
  });
  new prom.Gauge({
    name: 'process_scale_signal', help: 'The smoothed scaling signal (30 s moving average)', labelNames: ['kind'], registers,
    collect() {
      this.reset();
      const v = sup.smoothedSignal();
      if (v !== null) this.set({ kind }, v);
    },
  });
  const policy = sup.publishedPolicy();
  new prom.Gauge({
    name: 'process_scale_threshold', help: 'Scaling thresholds of the kind', labelNames: ['kind', 'edge'], registers,
    collect() {
      this.set({ kind, edge: 'up' }, policy.upAt);
      this.set({ kind, edge: 'down' }, policy.downAt);
      if (policy.downCpuBelow !== undefined) this.set({ kind, edge: 'cpu_down' }, policy.downCpuBelow);
    },
  });
  new prom.Gauge({
    name: 'process_scale_cpu', help: 'The group CPU, average of the children, percent of one core (30 s moving average)', labelNames: ['kind'], registers,
    collect() {
      this.reset();
      const v = sup.smoothedCpu();
      if (v !== null) this.set({ kind }, v);
    },
  });
  new prom.Gauge({
    name: 'process_crash_loop', help: '1 while scale-up is frozen by a crash loop', labelNames: ['kind'], registers,
    collect() { this.set({ kind }, sup.frozen ? 1 : 0); },
  });
  const decisions = new prom.Counter({ name: 'process_scale_decisions_total', help: 'Scaling decisions', labelNames: ['kind', 'action', 'reason'], registers });
  const restarts = new prom.Counter({ name: 'process_child_restarts_total', help: 'Child restarts after a crash', labelNames: ['kind'], registers });
  restarts.inc({ kind }, 0);
  sup.onEvent((e) => {
    decisions.inc({ kind, action: e.action, reason: e.reason });
    if (e.action === 'restart') restarts.inc({ kind });
  });
}

/**
 * The body of the supervisor's `/metrics`: its own registry and every running child's, merged with prom-client's
 * `AggregatorRegistry` (counters and most gauges summed, as for a `cluster`). Series only the supervisor has appear once.
 */
export async function aggregatedMetrics(own: MetricsRegistryLike, promModule: unknown, sup: Supervisor): Promise<string> {
  const prom = promModule as PromLike;
  const mine = own.getMetricsAsJSON ? await own.getMetricsAsJSON() : null;
  const children = await sup.collectChildMetrics();
  if (!mine) return own.metrics();
  return prom.AggregatorRegistry.aggregate([mine, ...children]).metrics();
}
