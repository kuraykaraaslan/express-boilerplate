import Logger from '@kuraykaraaslan-labs/logger';
import type { MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { ActorFeatureRequest, ActorFeatures } from '../features/ai_firewall.feature-store';
import { scoreActor } from './ai_firewall.rule-scorer';
import { DETECTOR_IDS, SHADOW_MODELS, isPlatformActor, type DetectorId, type ModelShadowScores, type ScoredDetection, type ShadowModelId } from './ai_firewall.risk';
import { DetectionQueue, publishScoredDetection, setDetectionQueue, type DetectionTarget } from './ai_firewall.detection-queue';
import { capturedVectorsOf, incidentVectorCaptureOn } from '../dataset/ai_firewall.vector-capture';
import { anyFlagged, scoreShadow, shortSha, type ShadowModels, type ShadowSkip } from '../shadow/ai_firewall.shadow-score';
import { FLUSH_MS, ShadowTally, tallyMember, type TallyRedis } from '../shadow/ai_firewall.shadow-tally';
import { modelEdges, type FeatureEdges } from '../promotion/ai_firewall.drift';

/**
 * The periodic evaluator of the rule scorer and the detectors (docs/phases/55-ai-firewall/02 §2.2, §2.3), in the worker: every
 * TICK_MS it takes at most PER_TICK actors from the queue the feature group's consumer fills (`ai_firewall.detection-queue.ts`), reads
 * each one's vectors (`actorFeatures`: one bounded Redis pipeline, the cached baseline), scores them (`scoreActor`) and hands every
 * actor with a detection, or a score of REPORT_MIN_SCORE and more, to the incident grouping of 2.4 as a `ScoredDetection`.
 *
 * Observe (2.7): scored, grouped and shown; nothing here acts or proposes an action. Bounded work per tick (PER_TICK actors, CONCURRENCY
 * at a time, one tick at a time) and fail open (FWA-7): an actor whose windows cannot be read is skipped and counted, a scoring that
 * throws is counted, a listener that fails is counted; no request, sign-in or audit write waits on any of it.
 */
export const TICK_MS = 2_000;
export const PER_TICK = 100;
export const CONCURRENCY = 10;
/** A score from here up is handed to 2.4 even without a detection (many weak reasons together). */
export const REPORT_MIN_SCORE = 25;

export const EVALUATION_RESULTS = ['reported', 'benign', 'no_windows', 'failed'] as const;
export type EvaluationResult = (typeof EVALUATION_RESULTS)[number];

/** 04.6: what shadow mode did with one actor per model: scored it (and flagged it or not), or why it did not. */
export const SHADOW_RESULTS = ['scored', 'flagged', 'not_loaded', 'not_applicable', 'cold_start', 'catalogue_mismatch', 'failed'] as const;
export type ShadowResultKind = (typeof SHADOW_RESULTS)[number];

export interface EvaluatorStats {
  evaluations: Record<EvaluationResult, number>;
  detections: Record<DetectorId, number>;
  listenerFailures: number;
  ticks: number;
  shadow: Record<ShadowModelId, Record<ShadowResultKind, number>>;
}

const freshShadowCounts = (): Record<ShadowResultKind, number> => Object.fromEntries(SHADOW_RESULTS.map((r) => [r, 0])) as Record<ShadowResultKind, number>;

export const freshEvaluatorStats = (): EvaluatorStats => ({
  evaluations: { reported: 0, benign: 0, no_windows: 0, failed: 0 },
  detections: Object.fromEntries(DETECTOR_IDS.map((id) => [id, 0])) as Record<DetectorId, number>,
  listenerFailures: 0,
  ticks: 0,
  shadow: { behaviour: freshShadowCounts(), attack: freshShadowCounts() },
});

/**
 * 04.6: the tree models in shadow, as the evaluator runs them: the loaded models, each one's drift bins (its split thresholds) and the
 * tally of what they saw. Built once per process from the shipped models (`shadowRuntimeOf`); null when neither model is loaded.
 */
export interface ShadowRuntime {
  models: ShadowModels;
  edges: Partial<Record<ShadowModelId, FeatureEdges>>;
  tally: ShadowTally;
}

export function shadowRuntimeOf(models: ShadowModels): ShadowRuntime | null {
  const edges: ShadowRuntime['edges'] = {};
  for (const name of SHADOW_MODELS) {
    const m = models[name];
    if (m) edges[name] = modelEdges(m.ensemble);
  }
  return Object.keys(edges).length > 0 ? { models, edges, tally: new ShadowTally() } : null;
}

/** A device or machine finding stays an alert (FWA-6). */
const machineKinds = new Set(['device', 'node']);

/**
 * The scored detection of one actor, or null when there is nothing to hand on: no detection, a score under REPORT_MIN_SCORE and no tree
 * model that flagged the actor in shadow (04.6: a model's flag is handed on too, so the incident shows it and a person can give it a
 * verdict, which the promotion gate reads). `models`: the shadow scores of this scoring, kept on the detection. Pure.
 */
export function scoredDetectionOf(
  target: DetectionTarget, features: Pick<ActorFeatures, 'behaviour' | 'attack' | 'rules' | 'coldStart'>, nowMs: number, models?: ModelShadowScores | null,
): ScoredDetection | null {
  const { risk, detections } = scoreActor({ actorKind: target.actor.kind, vectors: [features.behaviour, features.attack, features.rules] });
  const flaggedByModel = !!models && anyFlagged(models);
  if (detections.length === 0 && risk.score < REPORT_MIN_SCORE && !flaggedByModel) return null;
  const alertsOnly = target.lane === 'device-iot' || machineKinds.has(target.actor.kind)
    || (detections.length > 0 && detections.every((d) => d.alertsOnly));
  return {
    tenantId: target.tenantId,
    platform: isPlatformActor(target.actor.kind) || target.tenantId.toLowerCase() === ROOT_TENANT_ID.toLowerCase(),
    actor: { ...target.actor },
    lane: target.lane,
    at: new Date(nowMs).toISOString(),
    risk,
    detections,
    coldStart: features.coldStart,
    alertsOnly,
    ...(models && Object.keys(models).length > 0 ? { models } : {}),
  };
}

export interface EvaluatorOptions {
  queue: DetectionQueue;
  /** Reads an actor's vectors (default `actorFeatures`). */
  features?: (req: ActorFeatureRequest) => Promise<ActorFeatures>;
  /** The registered kinds' default weights (rules.v1's signal mass); null when the registry cannot be read. */
  kindWeights?: () => Promise<ReadonlyMap<string, number> | null>;
  /** Hands a scored detection on; answers how many listeners failed (default: the process's listeners, 2.4). */
  publish?: (detection: ScoredDetection) => Promise<number>;
  now?: () => number;
  perTick?: number;
  concurrency?: number;
  warn?: (text: string) => void;
  /**
   * Attach the scoring's vectors to every scored detection (03 §3.5, D55-88), for the incident grouping to keep the peak's: true only on
   * a staging or demo install (the boot task reads INSTALL_ROLE once); default false, nothing kept.
   */
  captureVectors?: boolean;
  /** 04.6: the tree models in shadow (`shadowRuntimeOf`); absent or null: the rules alone, as before. */
  shadow?: ShadowRuntime | null;
}

export class DetectionEvaluator {
  readonly stats: EvaluatorStats = freshEvaluatorStats();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private lastWarn = Number.NEGATIVE_INFINITY;

  constructor(private readonly o: EvaluatorOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private warn(text: string): void {
    const now = this.now();
    if (now - this.lastWarn < 60_000) return;
    this.lastWarn = now;
    this.o.warn?.(`detections: ${text}`);
  }

  private async features(req: ActorFeatureRequest): Promise<ActorFeatures> {
    if (this.o.features) return this.o.features(req);
    const { actorFeatures } = await import('../features/ai_firewall.feature-store');
    return actorFeatures(req);
  }

  private async evaluate(target: DetectionTarget, kindWeights: ReadonlyMap<string, number> | null): Promise<void> {
    try {
      const nowMs = this.now();
      const features = await this.features({
        tenantId: target.tenantId, actor: target.actor, lane: target.lane, role: target.role, kindWeights, nowMs,
      });
      if (!features.windowsRead) { this.stats.evaluations.no_windows += 1; return; }
      const shadowScores = this.shadow(target, features, nowMs);
      const detection = scoredDetectionOf(target, features, nowMs, shadowScores);
      if (!detection) { this.stats.evaluations.benign += 1; return; }
      // A scoring handed on carries the models' contributions too (bounded: only these are explained).
      if (detection.models && this.o.shadow) {
        const explained = scoreShadow(this.o.shadow.models, this.shadowInput(target, features), true).scores;
        if (Object.keys(explained).length > 0) detection.models = explained;
      }
      if (this.o.captureVectors) detection.vectors = capturedVectorsOf(features, detection.at);
      this.stats.evaluations.reported += 1;
      for (const d of detection.detections) this.stats.detections[d.detector] += 1;
      const failed = await (this.o.publish ?? publishScoredDetection)(detection);
      this.stats.listenerFailures += failed;
    } catch (e) {
      this.stats.evaluations.failed += 1;
      this.warn(`an actor could not be scored: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private shadowInput(target: DetectionTarget, features: ActorFeatures) {
    return { actorKind: target.actor.kind, coldStart: features.coldStart, behaviour: features.behaviour, attack: features.attack };
  }

  /**
   * 04.6: both models score the actor's vectors in shadow (nothing acts on them); each scoring is counted for the gate (active and flagged
   * actors per day) and the drift check (the week's histogram). Never throws: a model that fails scores nothing for this actor.
   */
  private shadow(target: DetectionTarget, features: ActorFeatures, nowMs: number): ModelShadowScores | null {
    const rt = this.o.shadow;
    if (!rt) return null;
    try {
      const { scores, skipped } = scoreShadow(rt.models, this.shadowInput(target, features), false);
      for (const [name, why] of Object.entries(skipped) as Array<[ShadowModelId, ShadowSkip]>) this.stats.shadow[name][why] += 1;
      const member = tallyMember(target.tenantId, target.actor.kind, target.actor.id);
      for (const name of SHADOW_MODELS) {
        const score = scores[name];
        const m = rt.models[name];
        if (!score || !m) continue;
        this.stats.shadow[name].scored += 1;
        if (score.flagged) this.stats.shadow[name].flagged += 1;
        rt.tally.record({
          model: name, sha: shortSha(m.meta.sha256), member, atMs: nowMs, score, values: features[name].values,
          edges: rt.edges[name] ?? [], rule: m.ensemble.splitRule,
        });
      }
      return Object.keys(scores).length > 0 ? scores : null;
    } catch {
      return null;
    }
  }

  /** One tick: at most PER_TICK actors, CONCURRENCY at a time. One tick at a time; never rejects. */
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const targets = this.o.queue.take(this.o.perTick ?? PER_TICK, this.now());
        if (targets.length === 0) return;
        this.stats.ticks += 1;
        const kindWeights = await (this.o.kindWeights?.() ?? Promise.resolve(null)).catch(() => null);
        const width = Math.max(1, this.o.concurrency ?? CONCURRENCY);
        for (let i = 0; i < targets.length; i += width) {
          await Promise.all(targets.slice(i, i + width).map((t) => this.evaluate(t, kindWeights)));
        }
      } catch (e) {
        this.warn(`a tick failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  start(intervalMs: number = TICK_MS): this {
    if (this.timer) return this;
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    this.timer.unref?.();
    return this;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}

/* ──────────────────────────────── The worker's boot task ──────────────────────────────── */

/** The shipped models that loaded (sha256 verified, parsed under the evaluator's constraints) as the shadow runtime; null when none did. */
async function loadShadowRuntime(): Promise<ShadowRuntime | null> {
  try {
    const { loadShippedModel } = await import('../models/shipped-models');
    const models: ShadowModels = {};
    for (const name of SHADOW_MODELS) {
      const r = loadShippedModel(name);
      if (r.ok) models[name] = { ensemble: r.ensemble, meta: r.meta };
    }
    return shadowRuntimeOf(models);
  } catch {
    return null;
  }
}

const CURRENT_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.detectionEvaluator');
const holder = globalThis as unknown as Record<symbol, { evaluator: DetectionEvaluator; queue: DetectionQueue; stop(): Promise<void> } | undefined>;

export function detectionMetricSources(
  read: () => { stats: EvaluatorStats; queue: DetectionQueue } | undefined = () => {
    const h = holder[CURRENT_KEY];
    return h ? { stats: h.evaluator.stats, queue: h.queue } : undefined;
  },
): MetricSource[] {
  return [
    {
      name: 'ai_firewall_detection_evaluations_total',
      help: 'Actors the AI firewall\'s rule scorer evaluated in this worker, by result: reported to the incident grouping, benign, skipped without windows, failed.',
      labelNames: ['result'],
      read: async () => EVALUATION_RESULTS.map((result) => ({ labels: { result }, value: read()?.stats.evaluations[result] ?? 0 })),
    },
    {
      name: 'ai_firewall_detections_total',
      help: 'Detections of the AI firewall\'s rule detectors in this worker, by detector (observe: nothing acts on them).',
      labelNames: ['detector'],
      read: async () => DETECTOR_IDS.map((detector) => ({ labels: { detector }, value: read()?.stats.detections[detector] ?? 0 })),
    },
    {
      name: 'ai_firewall_shadow_scorings_total',
      help: 'Actors the AI firewall\'s tree models scored in shadow in this worker (04.6: nothing acts on them), by model and result: scored, flagged at a rung of step-up or above, or skipped (model not loaded, actor kind not described, cold start, another catalogue, failed).',
      labelNames: ['model', 'result'],
      read: async () => SHADOW_MODELS.flatMap((model) => SHADOW_RESULTS.map((result) => ({ labels: { model, result }, value: read()?.stats.shadow[model][result] ?? 0 }))),
    },
    {
      name: 'ai_firewall_detection_queue',
      help: 'The detectors\' work list in this worker: actors waiting, actors dropped because it was full, listener failures.',
      labelNames: ['state'],
      read: async () => {
        const r = read();
        return [
          { labels: { state: 'waiting' }, value: r?.queue.size ?? 0 },
          { labels: { state: 'dropped' }, value: r?.queue.dropped ?? 0 },
          { labels: { state: 'listener_failed' }, value: r?.stats.listenerFailures ?? 0 },
        ];
      },
    },
  ];
}

/**
 * `common:boot_task` of the worker (phase `scheduler`, `parallel`: every worker process scores the actors its own share of the
 * feature group's entries named). Installs the queue, starts the tick, puts the series on `/metrics`, stops on drain. Idempotent.
 */
export async function startDetectionEvaluator(): Promise<{ stop(): Promise<void> }> {
  const running = holder[CURRENT_KEY];
  if (running) return { stop: () => running.stop() };
  const [{ registerDrainHook, registerMetricSource }, { firewallRegistry }] = await Promise.all([
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('../registry/ai_firewall.registry'),
  ]);
  let weights: Promise<ReadonlyMap<string, number> | null> | null = null;
  const kindWeights = () => (weights ??= firewallRegistry()
    .then((v) => new Map([...v.catalog.signals].map(([kind, s]) => [kind, s.defaultWeight] as const)) as ReadonlyMap<string, number>)
    .catch(() => { weights = null; return null; }));
  // 03 §3.5 (D55-88, D55-92): the vectors of a scoring are kept only on a staging install (the demo exports benign traffic only, so an
  // incident's vectors would never leave); a role that cannot be read keeps none
  const captureVectors = await import('@kuraykaraaslan-labs/common/server/common.firewall-probe-gate')
    .then((m) => incidentVectorCaptureOn(m.currentInstallRole()))
    .catch(() => false);
  // 04.6: the shipped models score in shadow beside the rules; a model that is absent or refused is simply not there (FWA-7)
  const shadow = await loadShadowRuntime();
  const queue = new DetectionQueue();
  const evaluator = new DetectionEvaluator({ queue, kindWeights, captureVectors, shadow, warn: (text) => Logger.warn(`[ai_firewall] ${text}`) }).start();
  setDetectionQueue(queue);
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let redis: TallyRedis | null = null;
  const flush = async () => {
    if (!shadow?.tally.pending) return;
    redis ??= (await import('@kuraykaraaslan-labs/redis').then((m) => m.default as unknown as TallyRedis).catch(() => null));
    if (redis) await shadow.tally.flush(redis);
  };
  if (shadow) {
    flushTimer = setInterval(() => { void flush(); }, FLUSH_MS);
    flushTimer.unref?.();
  }
  const stop = async () => {
    setDetectionQueue(null);
    await evaluator.stop();
    if (flushTimer) clearInterval(flushTimer);
    await flush().catch(() => undefined);
    if (holder[CURRENT_KEY]?.evaluator === evaluator) holder[CURRENT_KEY] = undefined;
  };
  holder[CURRENT_KEY] = { evaluator, queue, stop };
  for (const source of detectionMetricSources()) registerMetricSource(source);
  registerDrainHook('ai-firewall-detections', stop);
  return { stop };
}
