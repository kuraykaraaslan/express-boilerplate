import type { DrainRule, ScalingPolicy, SignalAggregate } from './supervisor.types';
import { procEnv, type EnvSource } from './supervisor.env';
import { supLog } from './supervisor.log';

/**
 * Per-kind scaling defaults (07 "Per-kind policies") and their env overrides.
 *
 * The thresholds other than D3 (automation up at 2 s of lag) are starting values; task 9's load test confirms or
 * corrects them. Each kind's signal unit:
 *
 * | kind | signal | unit |
 * |---|---|---|
 * | automation-worker | oldest waiting entry age (p95 of the child's partitions), worst child | seconds |
 * | worker | oldest waiting job age, worst child | seconds |
 * | ws | load ratio `max(connections / 5000, loopLagP99 / 50 ms)`, average per child | ratio |
 * | telephony-gateway | `max(active calls / per-child capacity, CPU / 100 %)`, average per child | ratio |
 * | script-host, plugin-host | scheduling / request wait p95, worst child | ms |
 */

export interface PolicyDefaults extends Omit<ScalingPolicy, 'kind' | 'signal'> {
  aggregate: SignalAggregate;
}

const S = 1_000;
const MIN = 60 * S;

const UP_COOLDOWN_MS = 60 * S;
const DOWN_COOLDOWN_MS = 5 * MIN;
const drain = (graceMs: number): DrainRule => ({ graceMs, pick: 'newest' });

const GENERIC: PolicyDefaults = {
  min: 1, max: 4, childMemoryMb: 512,
  upAt: 1, downAt: 0.5, upForMs: 60 * S, downForMs: 10 * MIN,
  upCooldownMs: UP_COOLDOWN_MS, downCooldownMs: DOWN_COOLDOWN_MS,
  drain: drain(60 * S), aggregate: 'max',
};

export const KIND_DEFAULTS: Record<string, PolicyDefaults> = {
  // D3: lag ≥ 2 s for 30 s; down below 0.5 s AND the group's CPU below 30 % of a core for 10 min. The signal is each
  // child's p95 partition lag, combined with `max` (the worst child; see the automation README "Scaling signal"). The
  // natural ceiling is the partition count, which the entry passes (`naturalCeiling`), since process_host does not know
  // automation. childMemoryMb, measured roughly (2026-10-17, hidden bundle on Node 24, the real generic host, no tenant
  // loaded): a child idles at ~270 MB RSS, the supervisor at ~175 MB. Loaded tenants (compiled flows, contexts, parked
  // windows) come on top, so 512 is the estimate until task 9 measures a child under load. upStallSteps: after two ups that did
  // not lower the lag, no further up until it falls (lag that comes from the work itself, not from too few processes).
  'automation-worker': { ...GENERIC, max: 64, childMemoryMb: 512, upAt: 2, downAt: 0.5, downCpuBelow: 30, upForMs: 30 * S, downForMs: 10 * MIN, upStallSteps: 2, drain: drain(60 * S) },
  // BullMQ: oldest waiting job ≥ 30 s for 2 min; down when queues are (nearly) empty for 15 min — every consumed queue's
  // oldest waiting job under 1 s, i.e. empty or picked at once; default cap 4. Signal per child: the worst of the queues it
  // consumes in every process (the leader's single-owner queues do not count: more children cannot help them).
  worker: { ...GENERIC, max: 4, upAt: 30, downAt: 1, upForMs: 2 * MIN, downForMs: 15 * MIN, drain: drain(60 * S) },
  // ws (07 task 7): the signal is each child's load ratio `max(connections / 5 000, loop-lag p99 / 50 ms)` (websocket
  // `websocket.scaling.ts`), averaged over the children: up when it holds at ≥ 1 for 60 s (> 5 000 connections or > 50 ms
  // of lag per child), down below half for 30 min. Children share the port through `cluster` (`startSupervisor({ cluster:
  // true })`). A scale-down keeps the drained child's sockets up to 10 min (the grace minus a margin, see the websocket
  // README "Scaling"), then sends the reconnect hint; the supervisor's grace is 11 min. No natural ceiling: the CPU budget.
  ws: { ...GENERIC, max: 64, childMemoryMb: 256, upAt: 1, downAt: 0.5, upForMs: 60 * S, downForMs: 30 * MIN, drain: drain(11 * MIN), aggregate: 'avg' },
  // telephony-gateway (07 task 7): the signal is each child's `max(active calls / per-child capacity, CPU / 100 %)`: up at
  // > 80 % for 30 s, down below 30 % for 20 min. The natural ceiling is 1 per IP: SIP registration and inbound INVITEs share
  // one UDP socket on 5060 (a carrier sends calls to the address and port a REGISTER came from), which two processes cannot
  // share without datagrams landing on the wrong one (see the telephony README "Scaling"). A drained child stops only with 0
  // active calls: `force: false`, the 30 min grace is only how often the supervisor logs that it is still waiting.
  'telephony-gateway': { ...GENERIC, max: 64, naturalCeiling: 1, childMemoryMb: 256, upAt: 0.8, downAt: 0.3, upForMs: 30 * S, downForMs: 20 * MIN, drain: { graceMs: 30 * MIN, pick: 'newest', force: false }, aggregate: 'avg' },
  // FairGate scheduling wait p95 > 50 ms for 30 s; down when the wait stays < 10 ms AND the group's CPU < 30 % of a core
  // for 10 min (07 task 7: "wait p95 + CPU busy"; a CPU-bound child shows up as wait, since its gate admits no more batches
  // than it has cores). Natural ceiling: the CPU budget (no `naturalCeiling`). A drained child finishes its batch in flight.
  'script-host': { ...GENERIC, max: 64, upAt: 50, downAt: 10, downCpuBelow: 30, upForMs: 30 * S, downForMs: 10 * MIN, drain: drain(60 * S) },
  // Wait for a free sandbox p95 > 50 ms for 30 s; down < 10 ms AND CPU < 30 % for 10 min; a drained child finishes its
  // requests in flight (a plugin call waits at most PLUGIN_BORROW_TIMEOUT_MS plus its own timeout).
  'plugin-host': { ...GENERIC, max: 64, upAt: 50, downAt: 10, downCpuBelow: 30, upForMs: 30 * S, downForMs: 10 * MIN, drain: drain(60 * S) },
};

export const defaultsFor = (kind: string): PolicyDefaults => KIND_DEFAULTS[kind] ?? GENERIC;

/** `automation-worker` → `AUTOMATION_WORKER`. */
export const envKind = (kind: string): string => kind.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

/** `PROC_<KIND>_ENABLED=true` turns supervision on; anything else (the default) runs one process as today. */
export function supervisionEnabled(kind: string, env: EnvSource = procEnv()): boolean {
  return env[`PROC_${envKind(kind)}_ENABLED`] === 'true';
}

/** True in a process the supervisor started (`PROC_CHILD=1`). */
export const isChildProcess = (env: EnvSource = procEnv()): boolean => env.PROC_CHILD === '1';

/** Should this process become the supervisor of `kind`? (enabled and not itself a child) */
export const shouldSupervise = (kind: string, env: EnvSource = procEnv()): boolean =>
  supervisionEnabled(kind, env) && !isChildProcess(env);

export type PolicyOverrides = Partial<Omit<ScalingPolicy, 'kind'>> & { aggregate?: SignalAggregate };

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Resolves the policy: code defaults for the kind ← the caller's overrides ← env (`PROC_<KIND>_MIN`, `_MAX`, `_UP_AT`,
 * `_DOWN_AT`, `_UP_FOR` and `_DOWN_FOR` in ms, `_CHILD_MB`, `_DOWN_CPU` in percent of one core, `_DRAIN_MS` the drain grace). Env wins so an operator can change a running deploy's
 * policy without a code change. Throws on an inconsistent policy (min > max, downAt ≥ upAt, downFor < upFor is
 * allowed but warned by the caller).
 */
export function resolvePolicy(
  kind: string,
  overrides: PolicyOverrides = {},
  env: EnvSource = procEnv(),
): Omit<ScalingPolicy, 'signal'> & { aggregate: SignalAggregate; signal?: ScalingPolicy['signal'] } {
  const k = envKind(kind);
  const d = defaultsFor(kind);
  const e = (name: string) => num(env[`PROC_${k}_${name}`]);
  const p = {
    ...d,
    ...stripUndefined(overrides),
    kind,
  };
  const fromEnv = stripUndefined({
    min: e('MIN'), max: e('MAX'), upAt: e('UP_AT'), downAt: e('DOWN_AT'),
    upForMs: e('UP_FOR'), downForMs: e('DOWN_FOR'), childMemoryMb: e('CHILD_MB'), downCpuBelow: e('DOWN_CPU'),
  });
  const out = { ...p, ...fromEnv };
  const drainMs = e('DRAIN_MS');
  if (drainMs !== undefined && drainMs > 0) out.drain = { ...out.drain, graceMs: Math.floor(drainMs) };
  out.min = Math.max(0, Math.floor(out.min));
  // a kind with a natural ceiling cannot run more children than it, whatever the minimum says: a second telephony gateway
  // would fail to bind the one SIP port (EADDRINUSE) and crash-loop. `kindMax` honours `min` above everything else, so
  // the clamp belongs here.
  if (out.naturalCeiling !== undefined && out.min > out.naturalCeiling) {
    supLog.warn(`[process_host] ${kind}: min ${out.min} is above the natural ceiling ${out.naturalCeiling} (PROC_${k}_MIN); running ${out.naturalCeiling}`);
    out.min = out.naturalCeiling;
  }
  out.max = Math.max(out.min, Math.floor(out.max));
  if (!(out.downAt < out.upAt)) throw new Error(`[process_host] ${kind}: downAt (${out.downAt}) must be below upAt (${out.upAt})`);
  if (out.downCpuBelow !== undefined && !(out.downCpuBelow > 0)) throw new Error(`[process_host] ${kind}: downCpuBelow must be positive`);
  if (out.childMemoryMb <= 0) throw new Error(`[process_host] ${kind}: childMemoryMb must be positive`);
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Combines the children's fresh signal reports. Empty → NaN ("no reading"). */
export function aggregateSignal(values: readonly number[], how: SignalAggregate): number {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return NaN;
  if (how === 'sum') return v.reduce((a, b) => a + b, 0);
  if (how === 'avg') return v.reduce((a, b) => a + b, 0) / v.length;
  return Math.max(...v);
}
