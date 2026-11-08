/**
 * Shared types of the process supervisor (docs/phases/14-docker/07-process-scaling.md).
 *
 * This file is the stable contract between the supervisor (which writes them to Redis) and any reader (the
 * observability Scaling view). It has no runtime imports, so a reader can depend on it without pulling the
 * supervisor in: import the types (`import type`) from the package path `@kuraykaraaslan-labs/process_host/server/supervisor/types`.
 *
 * A change to a published shape bumps `v`.
 */
import type { HealthReport, ProcessHealthStatus } from '../process-registry';

export type { HealthReport, ProcessHealthStatus };

/** The process kinds with a built-in default policy. Any other string is a valid kind with the generic defaults. */
export type KnownProcessKind =
  | 'ws'
  | 'telephony-gateway'
  | 'automation-worker'
  | 'script-host'
  | 'plugin-host'
  | 'worker';

/** How the per-child signal reports are combined into the kind's one signal. */
export type SignalAggregate = 'max' | 'avg' | 'sum';

/** The kind's drain rule as the supervisor sees it; what draining means is the child's own `onDrain`. */
export interface DrainRule {
  /** How long a child may take between `{ type: 'drain' }` and its exit before SIGTERM (then SIGKILL after the same again). */
  graceMs: number;
  /** Which child a scale-down drains. `newest` keeps the longest-running (warmest) children. */
  pick: 'newest' | 'oldest';
  /**
   * Whether a scale-down drain may be cut short when `graceMs` runs out (default true). False (telephony-gateway: a
   * child stops only with 0 active calls) makes `graceMs` a warning cadence: the supervisor logs and keeps waiting for
   * the child's `drained`, however long its last call lasts. A group shutdown (SIGTERM) always ends after `graceMs`.
   */
  force?: boolean;
}

/**
 * Why a child drains. `scale-down`: the supervisor shrinks the group, the child may take the kind's whole grace (ws keeps
 * its sockets up to 10 min; telephony waits for its last call). `shutdown`: the group stops (SIGTERM, deploy), the child
 * drains the way it always did on SIGTERM (bounded by `SHUTDOWN_GRACE_MS`). A `shutdown` arriving during a `scale-down`
 * escalates it.
 */
export type DrainReason = 'scale-down' | 'shutdown';

/**
 * The scaling policy of one kind, fully resolved (defaults + env + caller overrides).
 * Units of `upAt`/`downAt` are the kind's signal units (seconds of lag, ms of wait, a load ratio …).
 */
export interface ScalingPolicy {
  kind: string;
  /** Never fewer children (always granted, even over budget). */
  min: number;
  /** The kind's configured cap. The effective maximum is also limited by the budget and `naturalCeiling`. */
  max: number;
  /** The most children that can do useful work (automation: the partition count). Unset = no such limit. */
  naturalCeiling?: number;
  /** Memory estimate of one child, for the memory budget. */
  childMemoryMb: number;
  /** Scale up when the smoothed signal stays at or above this for `upForMs`. */
  upAt: number;
  /** Scale down when the smoothed signal stays below this for `downForMs`. Must be below `upAt` (hysteresis). */
  downAt: number;
  upForMs: number;
  downForMs: number;
  /**
   * Optional CPU condition of a scale-down, in percent of one core: the group's smoothed CPU (the average of the children's
   * reports, `{ type: 'cpu' }`) must also stay below it for `downForMs`. Without a CPU reading no signal-driven down happens.
   * Unset = the signal alone decides (automation-worker: 30, 07 "Per-kind policies").
   */
  downCpuBelow?: number;
  /** After a scale-up, no further scale-up for this long (default 60 s). */
  upCooldownMs: number;
  /**
   * Optional brake on scale-ups that do not help: how many consecutive signal-driven ups may be taken while the smoothed signal has
   * not fallen below its value at the previous up. Past it no further signal-driven up until the signal falls (below that value, or
   * under `upAt`) or the group scales down, or for `UP_STALL_HOLD_MS` (10 min, `supervisor.scaler.ts`) after the last up. Unset = no brake (automation-worker: 2, so lag that more processes do not shorten never
   * walks the group up to its budget).
   */
  upStallSteps?: number;
  /** After any change, no scale-down for this long (default 5 min). */
  downCooldownMs: number;
  /** Returns the current raw signal; NaN (or a throw) means "no reading", the sample is skipped. */
  signal: () => Promise<number>;
  drain: DrainRule;
}

/** A policy as it is published (no functions). */
export type PublishedPolicy = Omit<ScalingPolicy, 'signal'> & { aggregate: SignalAggregate; priority: number };

// ── IPC protocol ─────────────────────────────────────────────────────────────

/** Child → parent. */
export type ChildToParentMessage =
  | { type: 'ready' }
  | { type: 'signal'; value: number }
  /** The child's CPU use since its last report, in percent of one core (sent by `runAsChild` every 5 s). */
  | { type: 'cpu'; value: number }
  | { type: 'health'; report: HealthReport }
  | { type: 'drained' }
  /** Reply to `metrics?`: the child's prom-client `getMetricsAsJSON()` (null when metrics are off). */
  | { type: 'metrics'; id: number; metrics: unknown[] | null };

/** Parent → child. */
export type ParentToChildMessage =
  /** `reason`, `graceMs` and `force` are absent from supervisors before 07 task 7 (read as a shutdown). */
  | { type: 'drain'; reason?: DrainReason; graceMs?: number; force?: boolean }
  | { type: 'metrics?'; id: number };

/** Every message carries this marker so foreign IPC traffic (a library using the channel) is never misread. */
export const IPC_TAG = '__procsup' as const;
export type Tagged<T> = T & { [IPC_TAG]: 1 };

// ── Published state (Redis + /metrics) ───────────────────────────────────────

export type ChildState = 'starting' | 'running' | 'draining' | 'stopped';

export interface PublishedChild {
  /** Stable slot number, passed to the child as `PROC_CHILD_INDEX`. */
  index: number;
  /** Null while the slot waits for a restart. */
  pid: number | null;
  startedAt: number;
  state: ChildState;
  /** The child's last health report; null before the first one. */
  health: HealthReport | null;
  /** Restarts of this slot since the supervisor started. */
  restarts: number;
  /** The child's last raw signal report. */
  signal: number | null;
  /** The child's last CPU report (percent of one core); absent from supervisors before task 5. */
  cpu?: number | null;
  /** When the slot restarts next (a crashed child waiting out its back-off). */
  restartAt?: number;
}

export type BudgetSource = 'cgroup-v2' | 'cgroup-v1' | 'host';

export interface PublishedBudget {
  /** CPU cores available to children (quota − reserved cores). */
  cpu: number;
  /** Memory available to children in MB (limit − reserved MB). */
  memoryMb: number;
  /** This kind's effective maximum: min(policy.max, cpu, memory / childMemoryMb, naturalCeiling), never below min. */
  max: number;
  /** This kind's share of the machine budget right now (priority split across the kinds on the machine). */
  allocation: number;
  source: BudgetSource;
}

export type ScaleAction = 'up' | 'down' | 'restart' | 'freeze' | 'unfreeze';
export type ScaleReason = 'signal' | 'min' | 'max' | 'budget' | 'crash' | 'crash_loop' | 'quiet';

/** One entry of `proc:sup:events:<kind>:<nodeId>`. `from`/`to` are child counts. */
export interface SupervisorEvent {
  ts: number;
  action: ScaleAction;
  from: number;
  to: number;
  reason: ScaleReason;
  /** The smoothed signal at that moment (null without a reading). */
  signal: number | null;
  /** The child slot concerned (restart, down). */
  index?: number;
}

export type SupervisorStatus = 'steady' | 'scaling' | 'cooling' | 'frozen';

export interface PublishedSignal {
  /** Smoothed (30 s moving average); null without a reading. */
  value: number | null;
  upAt: number;
  downAt: number;
  /** Which side of the thresholds the signal is on, and since when. */
  edge: 'above' | 'below' | 'between' | null;
  since: number | null;
  /** The group's smoothed CPU (average of the children's reports, percent of one core); null without a reading. */
  cpu?: number | null;
  /** The policy's CPU condition of a scale-down, when it has one. */
  downCpuBelow?: number;
}

/** The value of `proc:sup:<kind>:<nodeId>` (TTL 15 s). */
export interface SupervisorStateV1 {
  v: 1;
  kind: string;
  nodeId: string;
  hostname: string;
  pid: number;
  startedAt: number;
  updatedAt: number;
  policy: PublishedPolicy;
  budget: PublishedBudget;
  children: PublishedChild[];
  signal: PublishedSignal;
  frozen?: { since: number; crashes: number; clearsAt: number };
  status: SupervisorStatus;
  lastDecision?: SupervisorEvent;
}

/**
 * One entry of `proc:sup:signal:<kind>:<nodeId>` (list, newest first, last 720 = one hour at 5 s, TTL 1 h): the
 * smoothed signal at each sample, so a reader can draw the last hour against the thresholds (the state holds only the
 * current value). `value` is null for a sample without a reading.
 */
export interface SignalSample {
  ts: number;
  value: number | null;
}

/** Health of the group as the supervisor's `/healthz` reports it: worst child wins. */
export type GroupHealth = HealthReport & { children: number };
