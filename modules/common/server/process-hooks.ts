/**
 * Hooks of the worker process (phase 03 §3.9): modules that own long-running work register what must happen when the
 * process drains, and what their health looks like, without `process_host` or the worker importing them.
 *
 * `common` stays a dependency-free leaf, so this knows no logger: a failing hook is reported through the optional
 * `onError` callback of `runDrainHooks`, and one failing hook never stops the others.
 */
export type DrainHook = () => Promise<void> | void;

const drainHooks: Array<{ name: string; run: DrainHook; concurrent: boolean }> = [];
const infoProviders = new Map<string, () => Record<string, unknown>>();

/**
 * Registers a drain hook (stop reading, end or abandon in-flight work, release leases). A name registers once.
 * A `concurrent` hook is started in its turn but not awaited until every other hook has run (see `runDrainHooks`).
 */
export function registerDrainHook(name: string, run: DrainHook, opts: { concurrent?: boolean } = {}): void {
  if (drainHooks.some((h) => h.name === name)) return;
  drainHooks.push({ name, run, concurrent: opts.concurrent === true });
}

/**
 * Drains a BullMQ consumer: `close()` stops taking jobs and waits for the one in flight, so SIGTERM does not leave a
 * half-done job to be retried by the stalled-job check. A job still running after `SHUTDOWN_GRACE_MS` is abandoned by the host.
 */
export function registerWorkerDrain(worker: { name: string; close: () => Promise<unknown> }): void {
  if (!consumers.has(worker.name)) consumers.set(worker.name, consumerScope);
  registerDrainHook(`worker:${worker.name}`, async () => {
    await worker.close();
  }, { concurrent: true });
}

/**
 * Where a queue consumer runs (docs/phases/14-docker/07 task 7): `every` process of the kind (the delivery consumers, the
 * `parallel` boot tasks), or only the `leader` (a consumer a single-owner scheduler task starts). The `worker` kind's scaling
 * signal counts only the `every` queues: another child cannot help a queue only the leader consumes.
 */
export type ConsumerScope = 'every' | 'leader';
const consumers = new Map<string, ConsumerScope>();
let consumerScope: ConsumerScope = 'every';

/**
 * Runs `fn` with every consumer it registers (`registerWorkerDrain`, while `fn` runs) recorded under `scope`.
 * `startBackgroundJobs` runs the single-owner scheduler tasks inside `withConsumerScope('leader', …)`.
 */
export async function withConsumerScope<T>(scope: ConsumerScope, fn: () => Promise<T>): Promise<T> {
  const prev = consumerScope;
  consumerScope = scope;
  try {
    return await fn();
  } finally {
    consumerScope = prev;
  }
}

/** The queues this process consumes (registration order), all or those of one scope. */
export function consumedQueues(scope?: ConsumerScope): string[] {
  return [...consumers].filter(([, s]) => !scope || s === scope).map(([name]) => name);
}

/**
 * Runs every hook, last registered first (reverse of start order), each in its own try. A `concurrent` hook (a queue
 * consumer's `close()`, which waits for the job in flight) is started in its turn and awaited at the end, so every
 * consumer stops taking new jobs at once instead of one long job holding the others open until the grace period ends.
 */
export async function runDrainHooks(onError?: (name: string, error: unknown) => void): Promise<void> {
  const running: Array<Promise<void>> = [];
  for (const h of [...drainHooks].reverse()) {
    const run = async () => {
      try {
        await h.run();
      } catch (e) {
        onError?.(h.name, e);
      }
    };
    if (h.concurrent) running.push(run());
    else await run();
  }
  await Promise.all(running);
}

/** Registers a provider of facts for the operator screen (`process_host` `info`), read fresh on every beat. */
export function registerInfoProvider(name: string, fn: () => Record<string, unknown>): void {
  infoProviders.set(name, fn);
}

export function collectInfo(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of infoProviders) {
    try {
      out[name] = fn();
    } catch {
      out[name] = { error: true };
    }
  }
  return out;
}

/** A health status as `process_host` reports it (`ProcessHealthStatus`; `common` stays a leaf, so the shape is repeated here). */
export type HealthStatus = 'ok' | 'degraded' | 'fail';
export interface HealthCheck {
  status: HealthStatus;
  detail?: string;
}
const healthChecks = new Map<string, () => HealthCheck>();
const RANK: Record<HealthStatus, number> = { ok: 0, degraded: 1, fail: 2 };

/**
 * Registers a module's health check for the process (`process_host` `health()`, read on every beat and every `/healthz`). A name
 * registers once; the latest registration replaces it. Keep it synchronous and cheap: it answers from state the module already has.
 */
export function registerHealthCheck(name: string, fn: () => HealthCheck): void {
  healthChecks.set(name, fn);
}

export function unregisterHealthCheck(name: string): void {
  healthChecks.delete(name);
}

/**
 * The process health from every registered check (`ProcessHostOptions.health`): the worst status wins, each check is listed under
 * its name. A check that throws counts as `fail`. With no check registered the process is `ok`.
 */
export function collectHealth(): { status: HealthStatus; checks: Record<string, HealthCheck>; detail?: string } {
  const checks: Record<string, HealthCheck> = {};
  let status: HealthStatus = 'ok';
  for (const [name, fn] of healthChecks) {
    let c: HealthCheck;
    try {
      c = fn();
    } catch (e) {
      c = { status: 'fail', detail: e instanceof Error ? e.message : String(e) };
    }
    checks[name] = c;
    if (RANK[c.status] > RANK[status]) status = c.status;
  }
  const bad = Object.entries(checks).filter(([, c]) => c.status !== 'ok').map(([n]) => n);
  return { status, checks, ...(bad.length && { detail: `not ok: ${bad.join(', ')}` }) };
}

/**
 * A gauge a module wants on the process's `/metrics`, read at scrape time. A module in a process that serves `/metrics` through
 * `process_host` (the worker) registers its series here without importing the host; the entry script binds the host's registry once
 * (`bindMetricRegistry`), and a source registered before or after that is attached exactly once. Labels are the module's closed sets.
 */
export interface MetricSource {
  name: string;
  help: string;
  labelNames: string[];
  read(): Promise<Array<{ labels: Record<string, string>; value: number }>>;
}

const metricSources = new Map<string, MetricSource>();
const attachedSources = new Set<string>();
let metricSink: ((s: MetricSource) => void) | null = null;

export function registerMetricSource(source: MetricSource): void {
  metricSources.set(source.name, source);
  if (metricSink && !attachedSources.has(source.name)) {
    attachedSources.add(source.name);
    metricSink(source);
  }
}

/**
 * Binds the process registry (`ProcessHostOptions.metrics`): every source registered so far, and every later one, becomes a
 * collect-time gauge on it. A source whose read fails reports nothing for that scrape (`onError`), never a failed scrape.
 */
export function bindMetricRegistry(registry: unknown, prom: unknown, onError?: (name: string, error: unknown) => void): void {
  const p = prom as { Gauge: new (cfg: Record<string, unknown>) => unknown };
  metricSink = (s) => {
    new p.Gauge({
      name: s.name, help: s.help, labelNames: s.labelNames, registers: [registry],
      async collect(this: { reset(): void; set(l: Record<string, string>, v: number): void }) {
        this.reset();
        try {
          for (const r of await s.read()) this.set(r.labels, r.value);
        } catch (e) {
          onError?.(s.name, e);
        }
      },
    });
  };
  for (const s of metricSources.values()) {
    if (attachedSources.has(s.name)) continue;
    attachedSources.add(s.name);
    metricSink(s);
  }
}

/** Test seam. */
export function resetProcessHooks(): void {
  drainHooks.length = 0;
  consumers.clear();
  consumerScope = 'every';
  infoProviders.clear();
  healthChecks.clear();
  metricSources.clear();
  attachedSources.clear();
  metricSink = null;
}
