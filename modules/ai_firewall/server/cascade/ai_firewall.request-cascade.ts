/**
 * The request cascade in the request path (docs/phases/55-ai-firewall/04-tree-models.md 4.8, FWD-7, FWD-8, FWD-12): the gate the limiter
 * asks about every API request that passed its own controls (common/server/request-gate.ts, `Limiter.checkRateLimit`). Synchronous and
 * bounded; nothing here waits for anything (D55-21): it reads the actor from the in-process snapshot cache (`ai_firewall.cascade-cache.ts`,
 * refreshed off the path, D55-116), the cascade's mode and the tenant's state from caches the runtime refreshes off the path, scores with
 * the TypeScript evaluator, and decides with `decideCascade`.
 *
 *   actor            a signed-in person on a human lane (the token's signature, as the limiter reads it): the person; else the address.
 *   stage 1          the person's behaviour.v1 row; an address, a fresh account or key (cold start) skips it.
 *   stage 2          the actor's own attack.v1 row; for a person also the address's row (4.11: what an attacker cannot shape on its
 *                    own account, such as the accounts its address tried, still weighs), which can only CHALLENGE the person: every
 *                    caller behind a shared address writes it, so it never blocks nor proposes against the person (FWA-5, FWA-13,
 *                    D55-124); only for the suspicious share, the cold start, the hovering (4.11) and the audit sample.
 *   budgets          stage 1 STAGE1_BUDGET_MS, stage 2 STAGE2_BUDGET_MS of CPU (measured); a stage over its budget scores nothing and the
 *                    request is allowed and counted (FWA-7). When more than BREAKER_MAX_SHARE of the last BREAKER_WINDOW requests took
 *                    over TOTAL_BUDGET_MS, the gate stands aside for BREAKER_OPEN_MS (every request allowed, counted).
 *   mode             enforcing only with both models promoted for the files this process loaded (D55-113), no platform kill switch,
 *                    and the tenant's own switch known to be off; else shadow: every request allowed and the would-be outcome recorded.
 *   outcome          per lane (LANE_POLICY, `decideCascade`): machine and device lanes allow and signal (FWA-6); a human lane's challenge
 *                    is the session step-up (a signed-in person: auth's existing session step-up refusal; not asked again of the SESSION
 *                    that proved a second factor lately, D55-125) or a progressive delay
 *                    (anonymous: DELAY_BASE_MS doubling per challenge of the actor in DELAY_WINDOW_MS, at most GATE_DELAY_MAX_MS); no
 *                    CAPTCHA in the API path (D55-120); a block refuses this request (403 with a support reference, no detail); the
 *                    terminate threshold proposes ending the session and excluding the device to the responder (the recorder writes
 *                    the proposal, 05 runs it).
 *   rule floor       the limiter asks only about what its controls let through, and the gate can only add a refusal (FWA-2); its own
 *                    refusals are never counted as the address's misses (D55-129).
 *   hovering         noted once per snapshot refresh of the actor (one independent scoring), never once per request (D55-126).
 *
 * Never throws: anything unexpected allows and counts (`error`).
 */
import { randomBytes } from 'node:crypto';
import { featureTagOf } from '../features/ai_firewall.feature-id';
import { LANE_POLICY, type Lane } from '@kuraykaraaslan-labs/common/server/lane.policy';
import { GATE_DELAY_MAX_MS, type GateAnswer, type GateRequest } from '@kuraykaraaslan-labs/common/server/request-gate';
import { predict } from '../trees/tree-ensemble.predict';
import type { TreeEnsemble } from '../trees/tree-ensemble.types';
import type { ShippedModelMeta } from '../models/shipped-models.types';
import { benignScore, decideCascade, inAuditSample, laneEnforces, type AttackScore, type CascadeDecision, type CascadeThresholds } from './cascade';
import { snapshotKey, type ActorSnapshot, type SnapshotCache } from './ai_firewall.cascade-cache';
import { HoverWatch, type HoverLine } from './ai_firewall.cascade-hover';
import type { CascadeRecorder, DecisionMode } from './ai_firewall.cascade-recorder';

export const STAGE1_BUDGET_MS = 0.5;
export const STAGE2_BUDGET_MS = 1;
export const TOTAL_BUDGET_MS = 2;
export const AUDIT_RATE = 0.01;
export const BREAKER_WINDOW = 1_000;
export const BREAKER_MAX_SHARE = 0.01;
export const BREAKER_OPEN_MS = 30_000;
export const DELAY_BASE_MS = 250;
export const DELAY_WINDOW_MS = 10 * 60_000;
const DELAY_ACTORS_MAX = 10_000;

/** Where a step-up is never asked (the person could not answer it, or would be locked out of the answer): the step-up itself, signing out, the session. */
export const CHALLENGE_EXEMPT_PATH = /\/api\/auth\/(?:step-up|logout|refresh|session|csrf)(?:\/|$)/;

/** The time buckets of the stage timings (µs, upper bounds; the last is everything above). */
export const TIME_BUCKETS_US = [25, 50, 100, 250, 500, 1_000, 2_000, 5_000] as const;
export const TIMED_STAGES = ['stage1', 'stage2', 'total'] as const;
export type TimedStage = (typeof TIMED_STAGES)[number];

export interface CascadeModel {
  readonly ensemble: TreeEnsemble;
  readonly meta: ShippedModelMeta;
}
export interface CascadeModels {
  readonly behaviour?: CascadeModel | null;
  readonly attack?: CascadeModel | null;
}

/** The cascade's platform-wide state, as the runtime last read it (off the path). Before the first read: nothing promoted. */
export interface ModeState {
  readonly promoted: { readonly behaviour: boolean; readonly attack: boolean };
  /** The platform's kill switch (or ROOT's own, or settings that could not be read, D55-113). */
  readonly platformKilled: boolean;
}

/** A tenant's state as the runtime last read it; null while it is not known (then: shadow, the platform's thresholds). */
export interface TenantState {
  readonly killed: boolean;
  readonly thresholds: CascadeThresholds;
}

export interface CascadeTimings {
  counts: Record<TimedStage, number[]>;
  overBudget: Record<TimedStage, number>;
}

export interface RequestCascadeOptions {
  models: CascadeModels;
  cache: SnapshotCache;
  recorder: CascadeRecorder;
  /** The platform's thresholds (`platformThresholds`); null: none, every request allowed. */
  platform: CascadeThresholds | null;
  mode: () => ModeState;
  tenant: (tenantId: string | null) => TenantState | null;
  /** The client address as the request fold reads it (`clientIpOf`), so the cascade looks up the actor the fold writes. */
  addressOf: (headers: { get(name: string): string | null }) => string | undefined;
  hover?: HoverWatch;
  now?: () => number;
  /** A monotonic clock in ms with sub-ms resolution (default `performance.now`). */
  clock?: () => number;
  auditRate?: number;
  /** The support reference of a refused request (default: 12 random hex characters with an `fw-` prefix). */
  reference?: () => string;
  budgets?: Partial<{ stage1Ms: number; stage2Ms: number; totalMs: number }>;
  /** The keyed tag of a session id the request fold counts a proved step-up under (default `featureTagOf('session', id)`; D55-125). */
  sessionTagOf?: (sessionId: string) => string | null;
}

const ALLOW: GateAnswer = Object.freeze({ action: 'allow' });
const HUMAN_LANES: ReadonlySet<Lane> = new Set<Lane>(['human-web', 'human-native']);

const defaultReference = (): string => `fw-${randomBytes(6).toString('hex')}`;
const defaultClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function pathOf(request: GateRequest['request']): string {
  if (request.nextUrl?.pathname) return request.nextUrl.pathname;
  try { return new URL(request.url ?? '/', 'http://x').pathname; } catch { return '/'; }
}

/** The session tag a proved step-up is counted under (the request fold's `sup:<tag>`, D55-125). */
export const defaultSessionTag = (sessionId: string): string | null => featureTagOf('session', sessionId);

export class RequestCascade {
  readonly timings: CascadeTimings = {
    counts: { stage1: new Array(TIME_BUCKETS_US.length + 1).fill(0), stage2: new Array(TIME_BUCKETS_US.length + 1).fill(0), total: new Array(TIME_BUCKETS_US.length + 1).fill(0) },
    overBudget: { stage1: 0, stage2: 0, total: 0 },
  };
  readonly hover: HoverWatch;
  private readonly ring = new Uint8Array(BREAKER_WINDOW);
  private ringAt = 0;
  private ringFilled = 0;
  private ringOver = 0;
  private breakerUntil = 0;
  breakerOpenings = 0;
  private readonly delays = new Map<string, { start: number; n: number }>();
  private auditCounter = 0;
  private readonly auditSalt = randomBytes(4).toString('hex');

  constructor(private readonly o: RequestCascadeOptions) {
    this.hover = o.hover ?? new HoverWatch();
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private clock(): number {
    return (this.o.clock ?? defaultClock)();
  }

  private budget(stage: TimedStage): number {
    const b = this.o.budgets ?? {};
    return stage === 'stage1' ? b.stage1Ms ?? STAGE1_BUDGET_MS : stage === 'stage2' ? b.stage2Ms ?? STAGE2_BUDGET_MS : b.totalMs ?? TOTAL_BUDGET_MS;
  }

  /** Counts one timing; answers whether it was over the stage's budget. */
  private time(stage: TimedStage, ms: number): boolean {
    const us = ms * 1000;
    let i = 0;
    while (i < TIME_BUCKETS_US.length && us > TIME_BUCKETS_US[i]!) i += 1;
    const buckets = this.timings.counts[stage];
    buckets[i] = (buckets[i] ?? 0) + 1;
    const over = ms > this.budget(stage);
    if (over) this.timings.overBudget[stage] += 1;
    return over;
  }

  /** The breaker's window: one slot per gated request, 1 when it took over the total budget. */
  private noteTotal(over: boolean, nowMs: number): void {
    const old = this.ring[this.ringAt]!;
    if (this.ringFilled >= BREAKER_WINDOW) this.ringOver -= old;
    else this.ringFilled += 1;
    this.ring[this.ringAt] = over ? 1 : 0;
    this.ringOver += over ? 1 : 0;
    this.ringAt = (this.ringAt + 1) % BREAKER_WINDOW;
    if (this.ringFilled >= BREAKER_WINDOW && this.ringOver / BREAKER_WINDOW > BREAKER_MAX_SHARE) {
      this.breakerUntil = nowMs + BREAKER_OPEN_MS;
      this.breakerOpenings += 1;
      this.ring.fill(0);
      this.ringAt = 0;
      this.ringFilled = 0;
      this.ringOver = 0;
    }
  }

  /** Whether the breaker stands the gate aside right now. */
  breakerOpen(nowMs: number = this.now()): boolean {
    return this.breakerUntil > nowMs;
  }

  /** The gate (the seam's `RequestGate`). Never throws. */
  readonly gate = (input: GateRequest): GateAnswer => {
    const t0 = this.clock();
    const nowMs = this.now();
    let answer: GateAnswer = ALLOW;
    let timed = false;
    try {
      if (this.breakerOpen(nowMs)) { this.o.recorder.skip('breaker_open'); return ALLOW; }
      timed = true;
      answer = this.decide(input, nowMs);
    } catch {
      this.o.recorder.skip('error');
      answer = ALLOW;
    } finally {
      if (timed) this.noteTotal(this.time('total', this.clock() - t0), nowMs);
    }
    return answer;
  };

  private auditKey(input: GateRequest): string {
    const id = input.request.headers.get('x-request-id');
    if (id && id.length <= 128) return id;
    this.auditCounter = (this.auditCounter + 1) >>> 0;
    return `${this.auditSalt}:${this.auditCounter}`;
  }

  /** The next progressive delay of an actor's challenges: DELAY_BASE_MS, doubling per challenge in the window, capped. */
  private delayOf(actorKey: string, nowMs: number): number {
    let d = this.delays.get(actorKey);
    if (!d || nowMs - d.start > DELAY_WINDOW_MS) {
      if (!d && this.delays.size >= DELAY_ACTORS_MAX) this.delays.clear();
      d = { start: nowMs, n: 0 };
      this.delays.set(actorKey, d);
    }
    d.n += 1;
    return Math.min(GATE_DELAY_MAX_MS, DELAY_BASE_MS * 2 ** Math.min(16, d.n - 1));
  }

  /** D55-125: the request's own session proved a second factor lately (the fold's `sup:<tag>`, or this process saw it). */
  private sessionProved(personKey: string, snap: ActorSnapshot, sessionId: string, nowMs: number): boolean {
    try {
      const tag = (this.o.sessionTagOf ?? defaultSessionTag)(sessionId);
      return !!tag && this.o.cache.sessionProved(personKey, snap, tag, nowMs);
    } catch {
      return false;
    }
  }

  private decide(input: GateRequest, nowMs: number): GateAnswer {
    const { models, cache, recorder } = this.o;
    const attackModel = models.attack ?? null;
    const behaviourModel = models.behaviour ?? null;
    if (!attackModel) { recorder.skip('no_model'); return ALLOW; }
    const platform = this.o.platform;
    if (!platform) { recorder.skip('no_thresholds'); return ALLOW; }

    const lane = input.lane;
    const policy = LANE_POLICY[lane] ?? LANE_POLICY['public-anon'];
    const address = this.o.addressOf(input.request.headers) ?? null;
    const person = HUMAN_LANES.has(lane) && input.signedIn && input.tenantId ? input.signedIn : null;
    if (!person && !address) { recorder.skip('no_actor'); return ALLOW; }

    const personRef = person ? { tenantId: input.tenantId, actor: { kind: 'user' as const, id: person.userId } } : null;
    const addressRef = address ? { tenantId: null, actor: { kind: 'ip' as const, id: address } } : null;
    const personKey = personRef ? snapshotKey(personRef) : null;
    const addressKey = addressRef ? snapshotKey(addressRef) : null;
    const personSnap: ActorSnapshot | null = personRef
      ? cache.lookup(personKey!, () => ({ ...personRef, lane }), nowMs).snapshot : null;
    const addressSnap: ActorSnapshot | null = addressRef
      ? cache.lookup(addressKey!, () => ({ ...addressRef, lane }), nowMs).snapshot : null;
    const primary = person ? personSnap : addressSnap;
    if (!primary) { recorder.skip('features_pending'); return ALLOW; }
    if (!primary.windowsRead) { recorder.skip('no_windows'); return ALLOW; }
    const actorKey = (person ? personKey : addressKey)!;
    // D55-126: one hover scoring per refresh of the snapshots the score came from, so the requests of one page load count once.
    const stage1Scoring = primary.readAtMs;

    const tenant = this.o.tenant(input.tenantId);
    const thresholds = tenant?.thresholds ?? platform;
    const mode = this.o.mode();
    // FWD-12: enforcing only with both stages promoted, no platform switch, and the tenant's own switch known to be off (D55-113).
    const enforcing = mode.promoted.behaviour && mode.promoted.attack && !mode.platformKilled && tenant !== null && !tenant.killed;
    const coldStart = person ? primary.coldStart : true;

    // Stage 1, measured: over its budget it scores nothing (the cascade then allows, FWA-7).
    const run = { overBudget: false, attackDone: false, attack: null as AttackScore | null, shared: null as AttackScore | null };
    let behaviourScore: number | null = null;
    if (!coldStart && behaviourModel && primary.behaviour) {
      const s = this.clock();
      try {
        const p = predict(behaviourModel.ensemble, primary.behaviour).output[0];
        behaviourScore = typeof p === 'number' && Number.isFinite(p) ? p : null;
      } catch {
        behaviourScore = null;
      }
      if (this.time('stage1', this.clock() - s)) { run.overBudget = true; behaviourScore = null; }
    }
    const hovering: HoverLine[] = [];
    const hoverStage1 = behaviourScore !== null && this.hover.note('suspicion', actorKey, behaviourScore, thresholds.suspicion, nowMs, stage1Scoring);
    if (hoverStage1) hovering.push('suspicion');
    const stage1Score = behaviourScore;

    // Stage 2, memoised and measured together: the actor's own row and, for a person, the address's row (D55-124: a challenge at most).
    const scoreRows = (): { own: AttackScore | null; shared: AttackScore | null } => {
      if (run.attackDone) return { own: run.attack, shared: run.shared };
      run.attackDone = true;
      const s = this.clock();
      const classes = attackModel.meta.classes;
      const score = (row: Float64Array | null): AttackScore | null => {
        if (!row) return null;
        try {
          return { classes, probabilities: predict(attackModel.ensemble, row).output };
        } catch {
          return null; // a row the model cannot score adds nothing
        }
      };
      let own = score(primary.attack);
      let shared = person ? score(addressSnap?.attack ?? null) : null;
      if (this.time('stage2', this.clock() - s)) { run.overBudget = true; own = null; shared = null; }
      run.attack = own;
      run.shared = shared;
      return { own, shared };
    };

    const decision: CascadeDecision = decideCascade({
      lane,
      policy,
      coldStart,
      auditSample: !coldStart && inAuditSample(this.auditKey(input), this.o.auditRate ?? AUDIT_RATE),
      scoreBehaviour: () => stage1Score,
      scoreAttack: () => scoreRows().own,
      scoreSharedAttack: person ? () => scoreRows().shared : undefined,
      promoted: { behaviour: enforcing, attack: enforcing },
      thresholds,
      ruleOutcome: 'allow',
      hasSession: !!person,
      hasDevice: !!person,
      captchaConfigured: false,
      hovering: hoverStage1,
    });
    if (run.overBudget) recorder.skip('over_budget');

    // 4.11: hovering just under the stage-2 lines (an attack class leading, under the challenge or the block threshold).
    if (decision.attackScore !== undefined && !decision.reasons.includes('attack_model_benign')) {
      const stage2Scoring = person && addressSnap ? `${primary.readAtMs}:${addressSnap.readAtMs}` : primary.readAtMs;
      if (this.hover.note('challenge', actorKey, decision.attackScore, thresholds.challenge, nowMs, stage2Scoring)) hovering.push('challenge');
      if (decision.attackScore >= thresholds.challenge && this.hover.note('block', actorKey, decision.attackScore, thresholds.block, nowMs, stage2Scoring)) hovering.push('block');
    }
    const auditMiss = !!decision.audit && run.attack !== null && decision.audit.attackScore >= thresholds.challenge && benignScore(run.attack) < decision.audit.attackScore;

    let applied: 'allow' | 'step_up' | 'delay' | 'block' = 'allow';
    if (decision.enforced === 'block') applied = 'block';
    else if (decision.enforced === 'challenge') {
      if (decision.challenge === 'step_up') {
        if (CHALLENGE_EXEMPT_PATH.test(pathOf(input.request))) recorder.skip('challenge_exempt');
        else if (this.sessionProved(personKey!, primary, person!.sessionId, nowMs)) recorder.skip('step_up_cleared');
        else applied = 'step_up';
      } else {
        applied = 'delay';
      }
    }
    const reference = decision.verdict !== 'allow' ? (this.o.reference ?? defaultReference)() : null;
    const decisionMode: DecisionMode = !laneEnforces(policy) ? 'alerts_only' : decision.shadow || !enforcing ? 'shadow' : 'enforced';
    recorder.note({
      tenantId: input.tenantId,
      actor: person ? { kind: 'user', id: person.userId } : { kind: 'ip', id: address! },
      sessionId: person?.sessionId ?? null,
      lane,
      decision,
      applied,
      mode: decisionMode,
      reference,
      hovering,
      auditMiss,
      atMs: nowMs,
    });
    if (applied === 'block') return { action: 'block', reference: reference! };
    if (applied === 'step_up') return { action: 'step_up', reference: reference! };
    if (applied === 'delay') return { action: 'delay', reference: reference!, delayMs: this.delayOf(actorKey, nowMs) };
    return ALLOW;
  }
}
