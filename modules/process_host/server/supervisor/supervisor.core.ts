import { hostname } from 'node:os';
import { supLog as Logger } from './supervisor.log';
import { BudgetLedger, claimKey, kindMax, priorityOf, splitBudget, type BudgetClaim, type ChildBudget } from './supervisor.budget';
import { aggregateSignal } from './supervisor.policy';
import {
  SAMPLE_MS, addSample, applied, cooling, decide, newScalerState, publishedSignal, smoothed, smoothedCpu, wantsMore, type ScalerState,
} from './supervisor.scaler';
import { CrashLoop, STABLE_MS, backoffMs } from './supervisor.restart';
import { isTagged, tag } from './supervisor.child-ipc';
import { DEFAULT_SHUTDOWN_GRACE_MS, supervisorShutdownLimit } from './supervisor.drain';
import type { SupervisorPublisher } from './supervisor.publisher';
import type {
  ChildState, ChildToParentMessage, DrainReason, GroupHealth, HealthReport, ParentToChildMessage, ProcessHealthStatus, PublishedChild,
  PublishedPolicy, ScaleAction, ScaleReason, ScalingPolicy, SignalAggregate, SupervisorEvent, SupervisorStateV1, SupervisorStatus,
} from './supervisor.types';

/**
 * The supervisor core (07 task 1): child slots, lifecycle, restart with back-off, crash-loop freeze, the scaling loop,
 * the drain protocol, aggregated health and the published state. Everything with a side effect is injected (how a
 * child is started, the budget ledger, the publisher, the clock), so it runs in unit tests with fake children and
 * vitest's fake timers. `startSupervisor` (supervisor.service.ts) wires the real ones.
 */

/** What the supervisor needs from a started child (a `ChildProcess` satisfies it). */
export interface ChildHandle {
  readonly pid?: number;
  send(message: unknown): boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'message', listener: (m: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnChild = (index: number) => ChildHandle;

export interface LedgerLike {
  /** The PID namespace claims are written under (`BudgetLedger.ns`); none in a test ledger. */
  readonly ns?: string;
  write(claim: BudgetClaim): void;
  read(now?: number): BudgetClaim[];
  remove(kind: string): void;
}

export interface SupervisorDeps {
  policy: ScalingPolicy & { aggregate: SignalAggregate };
  spawn: SpawnChild;
  budget: ChildBudget;
  ledger?: LedgerLike;
  publisher?: SupervisorPublisher;
  nodeId: string;
  now?: () => number;
  /** A starting child that sends nothing for this long is killed and counted as a crash. */
  startTimeoutMs?: number;
  /** The children's shutdown bound (`SHUTDOWN_GRACE_MS`, default 10 s). */
  shutdownGraceMs?: number;
  /**
   * After SIGTERM, SIGKILL follows after this long. Default `SHUTDOWN_GRACE_MS` + a margin: a SIGTERM during a drain
   * gives the child its shutdown grace to finish, so killing it sooner would abandon the job it was allowed to finish.
   */
  killAfterMs?: number;
  /** A child report older than this is stale (no signal, degraded health). */
  reportTtlMs?: number;
}

interface Slot {
  index: number;
  child: ChildHandle | null;
  pid: number | null;
  startedAt: number;
  state: ChildState;
  health: HealthReport | null;
  healthAt: number;
  signal: number | null;
  signalAt: number;
  /** Last CPU report (percent of one core). */
  cpu: number | null;
  cpuAt: number;
  restarts: number;
  /** Consecutive restart attempt, for the back-off. */
  attempt: number;
  restartAt?: number;
  /** Why the slot drains (set with `state: 'draining'`). */
  drainReason?: DrainReason;
  timers: Set<ReturnType<typeof setTimeout>>;
  exited?: Promise<void>;
  resolveExit?: () => void;
}

const RANK: Record<ProcessHealthStatus, number> = { ok: 0, degraded: 1, fail: 2 };
const worst = (a: ProcessHealthStatus, b: ProcessHealthStatus): ProcessHealthStatus => (RANK[b] > RANK[a] ? b : a);

export class Supervisor {
  readonly kind: string;
  readonly nodeId: string;
  readonly startedAt: number;
  private readonly policy: SupervisorDeps['policy'];
  private readonly spawnChild: SpawnChild;
  private readonly budget: ChildBudget;
  private readonly ledger: LedgerLike;
  private readonly publisher?: SupervisorPublisher;
  private readonly now: () => number;
  private readonly startTimeoutMs: number;
  private readonly killAfterMs: number;
  private readonly reportTtlMs: number;
  private readonly slots = new Map<number, Slot>();
  private readonly scaler: ScalerState = newScalerState();
  private readonly crashes = new CrashLoop();
  private readonly listeners = new Set<(e: SupervisorEvent) => void>();
  private readonly metricWaiters = new Map<number, { pending: Set<number>; out: unknown[][]; done: () => void }>();
  private metricSeq = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopping = false;
  private allocation: number;
  private lastDecision?: SupervisorEvent;
  private lastSignal: number | null = null;

  constructor(deps: SupervisorDeps) {
    this.policy = deps.policy;
    this.kind = deps.policy.kind;
    this.spawnChild = deps.spawn;
    this.budget = deps.budget;
    this.ledger = deps.ledger ?? new BudgetLedger();
    this.publisher = deps.publisher;
    this.nodeId = deps.nodeId;
    this.now = deps.now ?? Date.now;
    this.startTimeoutMs = deps.startTimeoutMs ?? 60_000;
    this.killAfterMs = deps.killAfterMs ?? supervisorShutdownLimit(deps.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS);
    this.reportTtlMs = deps.reportTtlMs ?? 15_000;
    this.startedAt = this.now();
    this.allocation = this.max;
  }

  /** The effective maximum: `kindMax` over this machine's child budget. */
  get max(): number {
    return kindMax(this.policy, this.budget);
  }

  get frozen(): boolean {
    return this.crashes.frozen;
  }

  /** Starts `min` children and the scaling loop (every 5 s). */
  start(): void {
    for (let i = 0; i < this.policy.min; i++) this.spawn(this.freeIndex());
    this.tickTimer = setInterval(() => { void this.tick(); }, SAMPLE_MS);
    this.tickTimer.unref?.();
    void this.publish();
  }

  onEvent(listener: (e: SupervisorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Children that count toward the size of the group: starting, running, or waiting out a restart back-off. */
  count(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.state !== 'draining') n += 1;
    return n;
  }

  countByState(): Record<ChildState, number> {
    const out: Record<ChildState, number> = { starting: 0, running: 0, draining: 0, stopped: 0 };
    for (const s of this.slots.values()) out[s.state] += 1;
    return out;
  }

  /** The children's fresh raw signal reports. */
  childSignals(): number[] {
    const now = this.now();
    const out: number[] = [];
    for (const s of this.slots.values()) {
      if (s.state === 'running' && s.signal !== null && now - s.signalAt <= this.reportTtlMs) out.push(s.signal);
    }
    return out;
  }

  /**
   * The group's CPU: the average of the running children's fresh CPU reports (percent of one core), NaN without one. The
   * average, not the worst child: a scale-down hands the drained child's share to the others, so the group's load is
   * what decides whether they can take it.
   */
  groupCpu(): number {
    const now = this.now();
    const v: number[] = [];
    for (const s of this.slots.values()) {
      if (s.state === 'running' && s.cpu !== null && now - s.cpuAt <= this.reportTtlMs) v.push(s.cpu);
    }
    return v.length === 0 ? NaN : v.reduce((a, b) => a + b, 0) / v.length;
  }

  smoothedCpu(): number | null {
    return smoothedCpu(this.scaler);
  }

  /** The default signal: the fresh child reports combined by the policy's `aggregate`. */
  aggregatedSignal(): number {
    return aggregateSignal(this.childSignals(), this.policy.aggregate);
  }

  smoothedSignal(): number | null {
    return smoothed(this.scaler);
  }

  /** One scaling step: sample, unfreeze check, budget, decide, act, publish. Called every 5 s; exposed for tests. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      let raw = NaN;
      try { raw = await this.policy.signal(); } catch { raw = NaN; }
      const now = this.now();
      this.lastSignal = addSample(this.scaler, this.policy, now, raw, this.groupCpu());
      // the last-hour history for the Scaling view (07 task 6): one smoothed sample per tick, best-effort
      if (this.publisher?.signal) void this.publisher.signal(this.kind, this.nodeId, { ts: now, value: this.lastSignal });
      if (this.crashes.check(now)) {
        Logger.info(`[process_host] ${this.kind}: crash loop cleared, scale-up unfrozen`);
        this.emit('unfreeze', this.count(), this.count(), 'quiet');
      }
      this.allocation = this.computeAllocation(now);
      const states = this.countByState();
      const d = decide(this.scaler, this.policy, {
        now, count: this.count(), max: this.max, allocation: this.allocation, frozen: this.frozen,
        busy: states.starting > 0, draining: states.draining,
      });
      if (d.action === 'up') this.scaleUp(d.reason);
      else if (d.action === 'down') this.scaleDown(d.reason);
      await this.publish();
    } finally {
      this.ticking = false;
    }
  }

  /**
   * This kind's share of the budget. The claim says what the group wants: its size, plus one while the up condition
   * holds and scale-up is not frozen (a frozen group cannot take the extra child, so claiming it would only shrink the
   * other kinds' shares). Only claims drawing from the same pool are split: the whole host when this budget is the host's
   * (containers without limits sharing a ledger), this container alone when it has its own limits.
   */
  private computeAllocation(now: number): number {
    const max = this.max;
    const ns = this.ledger.ns;
    const pool = this.budget.limited && ns ? ns : 'host';
    const more = !this.frozen && wantsMore(this.scaler, this.policy, now);
    const claim: BudgetClaim = {
      kind: this.kind, pid: process.pid, ...(ns && { ns }), pool, priority: priorityOf(this.kind), min: this.policy.min, max,
      childMemoryMb: this.policy.childMemoryMb, wants: this.count() + (more ? 1 : 0), updatedAt: now,
    };
    this.ledger.write(claim);
    const own = claimKey(claim);
    const claims = this.ledger.read(now).filter((c) => claimKey(c) !== own && (c.pool ?? 'host') === pool);
    claims.push(claim);
    return splitBudget(claims, this.budget).get(own) ?? max;
  }

  private scaleUp(reason: ScaleReason): void {
    const from = this.count();
    this.spawn(this.freeIndex());
    applied(this.scaler, 'up', this.now(), reason);
    this.emit('up', from, from + 1, reason);
  }

  private scaleDown(reason: ScaleReason): void {
    const candidates = [...this.slots.values()].filter((s) => s.state === 'running');
    // a slot waiting out a back-off is the cheapest to give up
    const waiting = [...this.slots.values()].find((s) => s.state === 'stopped');
    const from = this.count();
    if (waiting) {
      this.clearTimers(waiting);
      this.slots.delete(waiting.index);
      applied(this.scaler, 'down', this.now());
      this.emit('down', from, from - 1, reason, waiting.index);
      return;
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.startedAt - b.startedAt || a.index - b.index);
    const slot = this.policy.drain.pick === 'oldest' ? candidates[0] : candidates[candidates.length - 1];
    this.drain(slot, 'scale-down');
    applied(this.scaler, 'down', this.now());
    this.emit('down', from, from - 1, reason, slot.index);
  }

  private freeIndex(): number {
    let i = 0;
    while (this.slots.has(i)) i += 1;
    return i;
  }

  private spawn(index: number, prev?: Slot): Slot {
    const slot: Slot = prev ?? {
      index, child: null, pid: null, startedAt: this.now(), state: 'starting', health: null, healthAt: 0,
      signal: null, signalAt: 0, cpu: null, cpuAt: 0, restarts: 0, attempt: 0, timers: new Set(),
    };
    this.slots.set(index, slot);
    slot.state = 'starting';
    slot.startedAt = this.now();
    slot.restartAt = undefined;
    slot.health = null;
    slot.signal = null;
    slot.cpu = null;
    slot.exited = new Promise<void>((resolve) => { slot.resolveExit = resolve; });
    let child: ChildHandle;
    try {
      child = this.spawnChild(index);
    } catch (e) {
      Logger.error(`[process_host] ${this.kind}: child ${index} could not start: ${e instanceof Error ? e.message : String(e)}`);
      slot.child = null;
      this.onExit(slot, null, 1, null);
      return slot;
    }
    slot.child = child;
    slot.pid = child.pid ?? null;
    child.on('message', (m: unknown) => this.onMessage(slot, child, m));
    child.on('exit', (code, signal) => this.onExit(slot, child, code, signal));
    this.later(slot, () => {
      if (slot.child === child && slot.state === 'starting') {
        Logger.warn(`[process_host] ${this.kind}: child ${index} sent nothing within ${this.startTimeoutMs} ms, killing it`);
        child.kill('SIGKILL');
      }
    }, this.startTimeoutMs);
    return slot;
  }

  private later(slot: Slot, fn: () => void, ms: number): void {
    const t = setTimeout(() => { slot.timers.delete(t); fn(); }, ms);
    t.unref?.();
    slot.timers.add(t);
  }

  private clearTimers(slot: Slot): void {
    for (const t of slot.timers) clearTimeout(t);
    slot.timers.clear();
  }

  private onMessage(slot: Slot, child: ChildHandle, raw: unknown): void {
    if (slot.child !== child || !isTagged(raw)) return;
    const m = raw as unknown as ChildToParentMessage;
    const now = this.now();
    if (slot.state === 'starting') slot.state = 'running';
    switch (m.type) {
      case 'signal':
        if (typeof m.value === 'number') { slot.signal = m.value; slot.signalAt = now; }
        break;
      case 'cpu':
        if (typeof m.value === 'number' && Number.isFinite(m.value) && m.value >= 0) { slot.cpu = m.value; slot.cpuAt = now; }
        break;
      case 'health':
        slot.health = m.report;
        slot.healthAt = now;
        break;
      case 'drained':
        // the child finished its drain: stop it (it usually exits on its own first)
        if (slot.state === 'draining') this.terminate(slot, child);
        break;
      case 'metrics': {
        const w = this.metricWaiters.get(m.id);
        if (w && w.pending.delete(slot.index)) {
          if (Array.isArray(m.metrics)) w.out.push(m.metrics);
          if (w.pending.size === 0) w.done();
        }
        break;
      }
      default:
        break;
    }
  }

  private terminate(slot: Slot, child: ChildHandle): void {
    child.kill('SIGTERM');
    this.later(slot, () => { if (slot.child === child) child.kill('SIGKILL'); }, this.killAfterMs);
  }

  /**
   * The drain protocol: `drain` (with its reason and grace) → the child acknowledges with `drained` → SIGTERM; SIGTERM
   * anyway after the grace. A scale-down of a kind whose rule says `force: false` is never cut short: when the grace runs
   * out the supervisor logs and waits another grace (telephony: the child stops with its last call). Draining a slot that
   * already drains for a scale-down with `shutdown` escalates it (the child cuts its long drain short).
   */
  private drain(slot: Slot, reason: DrainReason): void {
    const child = slot.child;
    slot.state = 'draining';
    slot.drainReason = reason;
    if (!child) { this.slots.delete(slot.index); slot.resolveExit?.(); return; }
    const { graceMs } = this.policy.drain;
    const force = reason === 'shutdown' || this.policy.drain.force !== false;
    let sent = false;
    try { sent = child.send(tag({ type: 'drain', reason, graceMs, force } satisfies ParentToChildMessage)); } catch { sent = false; }
    if (!sent) { this.terminate(slot, child); return; }
    const arm = (waited: number): void => this.later(slot, () => {
      if (slot.child !== child) return;
      if (slot.drainReason === 'scale-down' && this.policy.drain.force === false) {
        Logger.warn(`[process_host] ${this.kind}: child ${slot.index} still draining after ${Math.round((waited + graceMs) / 1000)} s; never forced, waiting for it to finish`);
        arm(waited + graceMs);
        return;
      }
      Logger.warn(`[process_host] ${this.kind}: child ${slot.index} did not drain within ${graceMs} ms, sending SIGTERM`);
      this.terminate(slot, child);
    }, graceMs);
    arm(0);
  }

  private onExit(slot: Slot, child: ChildHandle | null, code: number | null, signal: NodeJS.Signals | null): void {
    if (child && slot.child !== child) return;
    const now = this.now();
    const ranMs = now - slot.startedAt;
    this.clearTimers(slot);
    slot.child = null;
    slot.pid = null;
    const intentional = slot.state === 'draining' || this.stopping;
    for (const [id, w] of this.metricWaiters) if (w.pending.delete(slot.index) && w.pending.size === 0) { w.done(); this.metricWaiters.delete(id); }
    if (intentional) {
      slot.state = 'stopped';
      this.slots.delete(slot.index);
      slot.resolveExit?.();
      return;
    }
    // a crash: restart with back-off, count it toward the crash loop
    slot.state = 'stopped';
    slot.health = null;
    slot.signal = null;
    slot.cpu = null;
    if (ranMs >= STABLE_MS) slot.attempt = 0;
    slot.attempt += 1;
    slot.restarts += 1;
    const wait = backoffMs(slot.attempt);
    slot.restartAt = now + wait;
    slot.resolveExit?.();
    Logger.warn(`[process_host] ${this.kind}: child ${slot.index} exited (code ${code ?? '-'}, signal ${signal ?? '-'}), restarting in ${wait} ms`);
    const n = this.count();
    this.emit('restart', n, n, 'crash', slot.index);
    if (this.crashes.crash(now)) {
      Logger.error(`[process_host] process_crash_loop: ${this.kind} crashed ${this.crashes.recent(now)} times in 5 min, scale-up frozen`);
      this.emit('freeze', n, n, 'crash_loop');
    }
    this.later(slot, () => {
      if (this.stopping || this.slots.get(slot.index) !== slot || slot.state !== 'stopped') return;
      this.spawn(slot.index, slot);
    }, wait);
    void this.publish();
  }

  private emit(action: ScaleAction, from: number, to: number, reason: ScaleReason, index?: number): void {
    const event: SupervisorEvent = { ts: this.now(), action, from, to, reason, signal: this.lastSignal, ...(index !== undefined && { index }) };
    this.lastDecision = event;
    if (action === 'up' || action === 'down') Logger.info(`[process_host] ${this.kind}: scale ${action} ${from} → ${to} (${reason}, signal ${this.lastSignal ?? '-'})`);
    for (const l of this.listeners) { try { l(event); } catch { /* a listener never stops scaling */ } }
    void this.publisher?.event(this.kind, this.nodeId, event);
  }

  /** Worst child wins; a stale or missing report is degraded; no running child while `min > 0` fails. */
  health(): GroupHealth {
    const now = this.now();
    let status: ProcessHealthStatus = 'ok';
    const checks: NonNullable<HealthReport['checks']> = {};
    let running = 0;
    for (const s of [...this.slots.values()].sort((a, b) => a.index - b.index)) {
      let st: ProcessHealthStatus = 'ok';
      let detail: string | undefined;
      if (s.state === 'running') {
        running += 1;
        if (!s.health || now - s.healthAt > this.reportTtlMs) { st = 'degraded'; detail = 'no fresh health report'; }
        else { st = s.health.status; detail = s.health.detail; }
      } else if (s.state === 'stopped') { st = 'degraded'; detail = 'restarting'; }
      else detail = s.state;
      checks[`child-${s.index}`] = { status: st, ...(detail && { detail }) };
      status = worst(status, st);
    }
    if (this.frozen) status = worst(status, 'degraded');
    if (this.policy.min > 0 && running === 0 && !this.stopping) status = worst(status, [...this.slots.values()].some((s) => s.state === 'starting') ? 'degraded' : 'fail');
    return { status, checks, children: running, ...(this.frozen && { detail: 'crash loop: scale-up frozen' }) };
  }

  status(): SupervisorStatus {
    if (this.frozen) return 'frozen';
    if ([...this.slots.values()].some((s) => s.state === 'starting' || s.state === 'draining')) return 'scaling';
    if (cooling(this.scaler, this.policy, this.now())) return 'cooling';
    return 'steady';
  }

  publishedPolicy(): PublishedPolicy {
    const rest: Partial<SupervisorDeps['policy']> = { ...this.policy };
    delete rest.signal;
    return { ...(rest as Omit<SupervisorDeps['policy'], 'signal'>), priority: priorityOf(this.kind) };
  }

  state(): SupervisorStateV1 {
    const now = this.now();
    const children: PublishedChild[] = [...this.slots.values()].sort((a, b) => a.index - b.index).map((s) => ({
      index: s.index, pid: s.pid, startedAt: s.startedAt, state: s.state, health: s.health, restarts: s.restarts,
      signal: s.signal, cpu: s.cpu, ...(s.restartAt !== undefined && { restartAt: s.restartAt }),
    }));
    const frozenSince = this.crashes.frozenSince;
    return {
      v: 1, kind: this.kind, nodeId: this.nodeId, hostname: hostname(), pid: process.pid, startedAt: this.startedAt, updatedAt: now,
      policy: this.publishedPolicy(),
      budget: { cpu: this.budget.cpu, memoryMb: this.budget.memoryMb, max: this.max, allocation: this.allocation, source: this.budget.source },
      children,
      signal: publishedSignal(this.scaler, this.policy),
      ...(frozenSince !== null && { frozen: { since: frozenSince, crashes: this.crashes.recent(now), clearsAt: this.crashes.clearsAt() ?? now } }),
      status: this.status(),
      ...(this.lastDecision && { lastDecision: this.lastDecision }),
    };
  }

  async publish(): Promise<void> {
    if (this.publisher && !this.stopping) await this.publisher.state(this.state());
  }

  /** Asks every running child for its prom-client JSON (`getMetricsAsJSON`), waiting at most `timeoutMs`. */
  collectChildMetrics(timeoutMs = 2_000): Promise<unknown[][]> {
    const running = [...this.slots.values()].filter((s) => s.state === 'running' && s.child);
    if (running.length === 0) return Promise.resolve([]);
    const id = ++this.metricSeq;
    return new Promise((resolve) => {
      const out: unknown[][] = [];
      const pending = new Set<number>();
      const finish = () => { clearTimeout(t); this.metricWaiters.delete(id); resolve(out); };
      const t = setTimeout(finish, timeoutMs);
      t.unref?.();
      this.metricWaiters.set(id, { pending, out, done: finish });
      for (const s of running) {
        try {
          if (s.child!.send(tag({ type: 'metrics?', id } satisfies ParentToChildMessage))) pending.add(s.index);
        } catch { /* skip it */ }
      }
      if (pending.size === 0) finish();
    });
  }

  /** Drains every child (concurrently) and stops the loop. Resolves when all have exited. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    const waits: Array<Promise<void>> = [];
    for (const s of [...this.slots.values()]) {
      if (s.state === 'stopped' && !s.child) { this.clearTimers(s); this.slots.delete(s.index); continue; }
      waits.push(s.exited ?? Promise.resolve());
      // a slot already draining for a scale-down is escalated: a group shutdown is bounded by the grace
      if (s.drainReason !== 'shutdown') this.drain(s, 'shutdown');
    }
    await Promise.all(waits);
    this.ledger.remove(this.kind);
    await this.publisher?.clear(this.kind, this.nodeId);
  }
}
