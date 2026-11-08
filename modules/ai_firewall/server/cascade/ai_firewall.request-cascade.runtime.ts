/**
 * The request cascade's runtime in the web process (docs/phases/55-ai-firewall/04-tree-models.md 4.8): a `common:boot_task` (runtime
 * phase) that loads the shipped models, builds the snapshot cache, the recorder and the gate, keeps the cascade's mode and each tenant's
 * state fresh OFF the request path, registers the gate with the limiter's seam (common/server/request-gate.ts) and puts the series on
 * `/metrics`.
 *
 * With no model loaded (today: none is shipped yet) no gate is registered: the limiter skips the seam and no request pays anything.
 * The state the gate reads, each refreshed by its own timer and failing to the safe side (FWA-7):
 *
 *   mode     every MODE_REFRESH_MS: the promotion store (`promotedStages` for the files this process loaded: promoted, not held, re-checked
 *            by the gate within PROMOTION_FRESH_MS, the pair measured together, D55-128, D55-130) and the platform's kill switch
 *            (`getFirewallActionPolicy(null)`: the platform's, ROOT's own, or unreadable, D55-113). Before the first read, or when the
 *            store cannot be read: nothing promoted (shadow).
 *   tenant   per tenant the gate has seen, its own kill switch every TENANT_POLICY_MS and its calibration (`detectorVerdictCounts`,
 *            `calibrationOf`, `tenantThresholds`) every TENANT_CALIBRATION_MS; at most TENANT_REFRESH_PER_ROUND tenants per round, at most
 *            TENANTS_MAX kept. A tenant not read yet is shadow for its requests; a switch that cannot be read counts as on; a switch read
 *            longer than TENANT_POLICY_STALE_MS ago counts as unknown, so shadow (D55-127). Tenants already known are refreshed before
 *            new ones, from their own queue: ids nobody has seen (a flood of random tenant paths) can never starve a known tenant's
 *            switch.
 */
import Logger from '@kuraykaraaslan-labs/logger';
import type { MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { ActorFeatures } from '../features/ai_firewall.feature-store';
import { rowOf, vectorMatches } from '../shadow/ai_firewall.shadow-score';
import { SHADOW_MODELS } from '../detect/ai_firewall.risk';
import type { CascadeThresholds } from './cascade';
import { SnapshotCache, snapshotKey } from './ai_firewall.cascade-cache';
import { CascadeRecorder, DECISION_MODES, DECISION_VERDICTS, SKIP_REASONS } from './ai_firewall.cascade-recorder';
import { calibrationOf, platformThresholds, tenantThresholds, NO_CALIBRATION, type TenantCalibration } from './ai_firewall.cascade-thresholds';
import {
  RequestCascade, TIMED_STAGES, TIME_BUCKETS_US, defaultSessionTag, type CascadeModels, type ModeState, type TenantState,
} from './ai_firewall.request-cascade';

export const MODE_REFRESH_MS = 30_000;
export const TENANT_POLICY_MS = 30_000;
export const TENANT_CALIBRATION_MS = 10 * 60_000;
export const TENANT_REFRESH_MS = 2_000;
export const TENANT_REFRESH_PER_ROUND = 50;
export const TENANTS_MAX = 10_000;
/** A tenant's switch older than this is not trusted to be off (D55-127): its requests run in shadow until it is read again. */
export const TENANT_POLICY_STALE_MS = 2 * TENANT_POLICY_MS;
/** How long a step-up this process saw spares that session a new one (the fold's `sup:<session tag>` counter carries it to the other processes, D55-125). */
export const STEP_UP_SPARE_MS = 60 * 60_000;

/** The models' rows of an actor's vectors (null for a model not loaded or a vector of another catalogue or hash). Pure. */
export function rowsFor(models: CascadeModels, features: Pick<ActorFeatures, 'behaviour' | 'attack'>): { behaviour: Float64Array | null; attack: Float64Array | null } {
  const row = (name: 'behaviour' | 'attack') => {
    const m = models[name];
    const v = features[name];
    return m && v && vectorMatches(m.meta, v) ? rowOf(v.values) : null;
  };
  return { behaviour: row('behaviour'), attack: row('attack') };
}

/* ──────────────────────────────── The tenant states ──────────────────────────────── */

export interface TenantStateDeps {
  /** The tenant's own kill switch is on (or cannot be read). */
  killed: (tenantId: string) => Promise<boolean>;
  calibration: (tenantId: string) => Promise<TenantCalibration>;
  now?: () => number;
}

interface TenantEntry {
  killed: boolean | null;
  policyAt: number;
  calibration: TenantCalibration;
  calibrationAt: number;
}

/** Each tenant's state the gate reads synchronously, refreshed off the path. */
export class TenantStates {
  private readonly entries = new Map<string, TenantEntry>();
  /** Due refreshes of tenants already known (bounded by the entries) and of tenants not read yet (bounded by TENANTS_MAX). */
  private readonly dueKnown = new Set<string>();
  private readonly queue = new Set<string>();
  private refreshing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly stats = { refreshed: 0, failed: 0, dropped: 0, stale: 0 };

  constructor(private readonly platform: CascadeThresholds | null, private readonly deps: TenantStateDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** The tenant's state, or null while it is not known (synchronous; queues a refresh when due). */
  lookup = (tenantId: string | null): TenantState | null => {
    const id = (tenantId ?? ROOT_TENANT_ID).toLowerCase();
    const e = this.entries.get(id);
    const now = this.now();
    if (!e || now - e.policyAt > TENANT_POLICY_MS || now - e.calibrationAt > TENANT_CALIBRATION_MS) this.want(id, !!e);
    if (!e || e.killed === null || !this.platform) return null;
    // D55-127: a switch not re-read within the bound is not known to be off any more (fail open: shadow).
    if (now - e.policyAt > TENANT_POLICY_STALE_MS) { this.stats.stale += 1; return null; }
    return { killed: e.killed, thresholds: tenantThresholds(this.platform, e.calibration) };
  };

  private want(id: string, known: boolean): void {
    if (known) {
      if (!this.dueKnown.has(id) && this.dueKnown.size >= TENANTS_MAX) { this.stats.dropped += 1; return; }
      this.dueKnown.add(id);
      return;
    }
    if (this.queue.has(id)) return;
    if (this.queue.size >= TENANTS_MAX) { this.stats.dropped += 1; return; }
    this.queue.add(id);
  }

  /** Refreshes waiting: known tenants and new ones (for the tests and the gauge). */
  get waiting(): { known: number; new: number } {
    return { known: this.dueKnown.size, new: this.queue.size };
  }

  private async refreshOne(id: string): Promise<void> {
    const now = this.now();
    const prev = this.entries.get(id);
    const entry: TenantEntry = prev ? { ...prev } : { killed: null, policyAt: 0, calibration: NO_CALIBRATION, calibrationAt: 0 };
    try {
      if (now - entry.policyAt > TENANT_POLICY_MS || entry.killed === null) {
        entry.killed = await this.deps.killed(id).catch(() => true);
        entry.policyAt = now;
      }
      if (now - entry.calibrationAt > TENANT_CALIBRATION_MS) {
        entry.calibration = await this.deps.calibration(id).catch(() => NO_CALIBRATION);
        entry.calibrationAt = now;
      }
      if (!prev && this.entries.size >= TENANTS_MAX) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      // the least recently refreshed goes first when the map is full, never a tenant that keeps being read
      this.entries.delete(id);
      this.entries.set(id, entry);
      this.stats.refreshed += 1;
    } catch {
      this.stats.failed += 1;
    }
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        // Known tenants first (their switch must stay fresh), then new ones with what is left of the round.
        const batch: string[] = [];
        for (const id of this.dueKnown) { if (batch.length >= TENANT_REFRESH_PER_ROUND) break; batch.push(id); }
        for (const id of batch) this.dueKnown.delete(id);
        for (const id of this.queue) { if (batch.length >= TENANT_REFRESH_PER_ROUND) break; if (!batch.includes(id)) batch.push(id); }
        for (const id of batch) this.queue.delete(id);
        for (const id of batch) await this.refreshOne(id);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  start(intervalMs: number = TENANT_REFRESH_MS): this {
    if (this.timer) return this;
    this.timer = setInterval(() => { void this.refresh(); }, intervalMs);
    this.timer.unref?.();
    return this;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.refreshing;
  }
}

/* ──────────────────────────────── The series ──────────────────────────────── */

export interface CascadeRuntimeView {
  cascade: RequestCascade;
  recorder: CascadeRecorder;
  cache: SnapshotCache;
}

export function cascadeMetricSources(read: () => CascadeRuntimeView | undefined): MetricSource[] {
  return [
    {
      name: 'ai_firewall_cascade_decisions_total',
      help: 'Requests the AI firewall\'s request cascade decided in this process (04.8), by how the decision applied (enforced, shadow, alerts only on a machine or device lane) and verdict.',
      labelNames: ['mode', 'verdict'],
      read: async () => DECISION_MODES.flatMap((mode) => DECISION_VERDICTS.map((verdict) => ({ labels: { mode, verdict }, value: read()?.recorder.stats.decisions[mode][verdict] ?? 0 }))),
    },
    {
      name: 'ai_firewall_cascade_applied_total',
      help: 'What the request cascade did to requests in this process: allowed, asked the session to step up, delayed, blocked.',
      labelNames: ['action'],
      read: async () => (['allow', 'step_up', 'delay', 'block'] as const).map((action) => ({ labels: { action }, value: read()?.recorder.stats.applied[action] ?? 0 })),
    },
    {
      name: 'ai_firewall_cascade_skipped_total',
      help: 'Requests the request cascade allowed without a decision (FWA-7), by reason: no actor, features not cached yet, no windows, no thresholds, no model, over budget, breaker open, a step-up already proved, an exempt path, an error.',
      labelNames: ['reason'],
      read: async () => SKIP_REASONS.map((reason) => ({ labels: { reason }, value: read()?.recorder.stats.skipped[reason] ?? 0 })),
    },
    {
      name: 'ai_firewall_cascade_audit_total',
      help: 'The stage-1 audit sample (1 % of the requests stage 1 called normal, scored by stage 2 in shadow): scored, and misses (stage 2 would have challenged them).',
      labelNames: ['result'],
      read: async () => [
        { labels: { result: 'scored' }, value: read()?.recorder.stats.audit.scored ?? 0 },
        { labels: { result: 'miss' }, value: read()?.recorder.stats.audit.misses ?? 0 },
      ],
    },
    {
      name: 'ai_firewall_cascade_stage_time_total',
      help: 'The request cascade\'s CPU time per request in this process, by stage and upper bound in microseconds (inf: above the last).',
      labelNames: ['stage', 'le_us'],
      read: async () => TIMED_STAGES.flatMap((stage) => [...TIME_BUCKETS_US.map(String), 'inf'].map((le, i) => ({ labels: { stage, le_us: le }, value: read()?.cascade.timings.counts[stage][i] ?? 0 }))),
    },
    {
      name: 'ai_firewall_cascade_over_budget_total',
      help: 'Request cascade stages over their CPU budget (stage 1 0.5 ms, stage 2 1 ms, total 2 ms), and breaker openings (the cascade stood aside for 30 s).',
      labelNames: ['stage'],
      read: async () => [
        ...TIMED_STAGES.map((stage) => ({ labels: { stage }, value: read()?.cascade.timings.overBudget[stage] ?? 0 })),
        { labels: { stage: 'breaker_opened' }, value: read()?.cascade.breakerOpenings ?? 0 },
      ],
    },
    {
      name: 'ai_firewall_cascade_cache',
      help: 'The request cascade\'s actor cache in this process: lookups fresh, stale and missed, refreshes done and failed, refreshes dropped (queue full), entries evicted, entries held, actors waiting.',
      labelNames: ['state'],
      read: async () => {
        const v = read();
        const s = v?.cache.stats;
        return [
          { labels: { state: 'fresh' }, value: s?.fresh ?? 0 },
          { labels: { state: 'stale' }, value: s?.stale ?? 0 },
          { labels: { state: 'miss' }, value: s?.miss ?? 0 },
          { labels: { state: 'refreshed' }, value: s?.refreshed ?? 0 },
          { labels: { state: 'refresh_failed' }, value: s?.refreshFailed ?? 0 },
          { labels: { state: 'queue_dropped' }, value: s?.queueDropped ?? 0 },
          { labels: { state: 'evicted' }, value: s?.evicted ?? 0 },
          { labels: { state: 'entries' }, value: v?.cache.size ?? 0 },
          { labels: { state: 'waiting' }, value: v?.cache.waiting ?? 0 },
        ];
      },
    },
    {
      name: 'ai_firewall_cascade_signals_total',
      help: 'The request cascade\'s per-actor decision signals (ai_firewall.cascade_decision, one per actor per 5 s flush), hovering actors seen, and proposals to the responder by result.',
      labelNames: ['result'],
      read: async () => {
        const s = read()?.recorder.stats;
        return [
          { labels: { result: 'signal_emitted' }, value: s?.signals.emitted ?? 0 },
          { labels: { result: 'signal_capped' }, value: (s?.signals.capped ?? 0) + (s?.signals.actorCap ?? 0) },
          { labels: { result: 'hovering' }, value: s?.hovering ?? 0 },
          { labels: { result: 'proposal_written' }, value: s?.proposals.written ?? 0 },
          { labels: { result: 'proposal_deduped' }, value: s?.proposals.deduped ?? 0 },
          { labels: { result: 'proposal_dropped' }, value: (s?.proposals.dropped ?? 0) + (s?.proposals.failed ?? 0) },
          { labels: { result: 'proposal_not_registered' }, value: s?.proposals.notRegistered ?? 0 },
        ];
      },
    },
  ];
}

/* ──────────────────────────────── The boot task ──────────────────────────────── */

const CURRENT_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.requestCascade');
const holder = globalThis as unknown as Record<symbol, (CascadeRuntimeView & { stop(): Promise<void> }) | undefined>;

/**
 * `common:boot_task` (runtime phase, every web process): see the header. Idempotent; with no model loaded it registers nothing and
 * answers a no-op stop.
 */
export async function startRequestCascade(): Promise<{ stop(): Promise<void> }> {
  const running = holder[CURRENT_KEY];
  if (running) return { stop: () => running.stop() };

  const { loadShippedModel } = await import('../models/shipped-models');
  const loads = Object.fromEntries(SHADOW_MODELS.map((name) => [name, loadShippedModel(name)])) as Record<'behaviour' | 'attack', ReturnType<typeof loadShippedModel>>;
  const models: CascadeModels = {
    behaviour: loads.behaviour.ok ? { ensemble: loads.behaviour.ensemble, meta: loads.behaviour.meta } : null,
    attack: loads.attack.ok ? { ensemble: loads.attack.ensemble, meta: loads.attack.meta } : null,
  };
  if (!models.behaviour && !models.attack) return { stop: async () => undefined };

  const [
    { setRequestGate }, { registerDrainHook, registerMetricSource }, { emitSecuritySignal }, { clientIpOf }, { setStepUpListener },
    { getFirewallActionPolicy }, { readPromotionStates }, { promotedStages }, { detectorVerdictCounts }, { firewallRegistry },
  ] = await Promise.all([
    import('@kuraykaraaslan-labs/common/server/request-gate'),
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('@kuraykaraaslan-labs/common/server/common.firewall-contracts'),
    import('@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip'),
    import('../features/ai_firewall.request-fold'),
    import('../ai_firewall.settings-policy'),
    import('../promotion/ai_firewall.promotion.service'),
    import('../promotion/ai_firewall.promotion-model'),
    import('../labels/ai_firewall.label-store'),
    import('../registry/ai_firewall.registry'),
  ]);

  const platform = platformThresholds(models.behaviour?.meta, models.attack?.meta);
  const cache = new SnapshotCache({ rowsOf: (f) => rowsFor(models, f) }).start();
  const recorder = new CascadeRecorder({
    emit: emitSecuritySignal,
    warn: (text) => Logger.warn(`[ai_firewall] ${text}`),
    proposals: {
      actions: async () => (await firewallRegistry()).catalog.actions,
      policy: getFirewallActionPolicy,
      inTenant: async (tenantId, fn) => {
        await import('reflect-metadata');
        const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db');
        return withTenantTransactionFor(tenantId, (qr) => fn(qr));
      },
    },
  }).start();
  const tenants = new TenantStates(platform, {
    killed: async (tenantId) => (await getFirewallActionPolicy(tenantId)).killed !== null,
    calibration: async (tenantId) => calibrationOf(await detectorVerdictCounts(tenantId)),
  }).start();

  let mode: ModeState = { promoted: { behaviour: false, attack: false }, platformKilled: true };
  const refreshMode = async () => {
    try {
      const [states, policy] = await Promise.all([readPromotionStates(), getFirewallActionPolicy(null)]);
      mode = { promoted: promotedStages(states, loads, Date.now()), platformKilled: policy.killed !== null };
    } catch {
      mode = { promoted: { behaviour: false, attack: false }, platformKilled: true };
    }
  };
  await refreshMode();
  const modeTimer = setInterval(() => { void refreshMode(); }, MODE_REFRESH_MS);
  modeTimer.unref?.();

  const cascade = new RequestCascade({
    models, cache, recorder, platform, mode: () => mode, tenant: tenants.lookup, addressOf: clientIpOf,
  });
  // D55-125: the proof spares the session that made it, never the person's other sessions.
  setStepUpListener(({ tenantId, userId, sessionId }) => {
    const tag = sessionId ? defaultSessionTag(sessionId) : null;
    if (tag) cache.markStepUpProved(snapshotKey({ tenantId, actor: { kind: 'user', id: userId } }), tag, Date.now() + STEP_UP_SPARE_MS);
  });
  setRequestGate(cascade.gate);

  const stop = async () => {
    setRequestGate(null);
    setStepUpListener(null);
    clearInterval(modeTimer);
    await Promise.all([cache.stop(), tenants.stop(), recorder.stop()]);
    if (holder[CURRENT_KEY]?.cascade === cascade) holder[CURRENT_KEY] = undefined;
  };
  holder[CURRENT_KEY] = { cascade, recorder, cache, stop };
  const sources = cascadeMetricSources(() => holder[CURRENT_KEY]);
  for (const s of sources) registerMetricSource(s);
  try {
    const { registerGaugeSource } = await import('@kuraykaraaslan-labs/observability/server/metrics');
    for (const s of sources) registerGaugeSource(s);
  } catch {
    // a process without the observability registry serves the sources through process_host
  }
  registerDrainHook('ai-firewall-request-cascade', stop);
  Logger.info(`[ai_firewall] request cascade registered (behaviour ${models.behaviour ? 'loaded' : 'absent'}, attack ${models.attack ? 'loaded' : 'absent'}, thresholds ${platform ? 'set' : 'absent'})`);
  return { stop };
}
