import 'reflect-metadata';
import type { Worker } from 'bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import type { ModelLoadResult } from '../models/shipped-models';
import { SHADOW_MODELS, type ShadowModelId } from '../detect/ai_firewall.risk';
import { shortSha, type ShadowModel } from '../shadow/ai_firewall.shadow-score';
import { readHistogram, type CountRedis, type HashRedis } from '../shadow/ai_firewall.shadow-tally';
import {
  completeWeeksSince, driftReport, DRIFT_MIN_SAMPLES, modelAgeDays, modelEdges, type DriftHistogram,
} from './ai_firewall.drift';
import { evaluateGate, nextState, type GateVerdict, type ModelStateRecord, type StateChange, type StoredDrift } from './ai_firewall.promotion-model';
import { gatherEvidence, type EvidenceDeps } from './ai_firewall.promotion-evidence';
import { defaultPromotionStoreDeps, lockState, readStates, stateAuditRow, writeState, type PromotionStoreDeps } from './ai_firewall.promotion-store';

/**
 * The automatic promotion gate's run (docs/phases/55-ai-firewall/04-tree-models.md 4.7, 4.9; owner decision FWD-12): daily at 04:30 UTC and
 * once at every boot, on the leader. For each tree model:
 *
 *   1. the shipped model as this process loaded it (sha256 verified, parsed; `loadShippedModel`);
 *   2. what shadow saw in the last 28 days over every tenant (`gatherEvidence`) and the weekly drift against the reference week (`driftOf`);
 *   3. in ROOT's transaction, the model's row read FOR UPDATE, the gate's verdict (`evaluateGate`) and the next state (`nextState`): promoted
 *      when every criterion holds, demoted back to shadow when a promoted model fails one, a new model file starting a new shadow period;
 *   4. after the commit, an audit row for a promotion or a demotion (the alert source raises a demotion, a drift and a stale model).
 *
 * No person promotes (FWD-12); a ROOT owner can only hold a model in shadow. The kill switches, a tenant's off and fail open still apply to
 * what the cascade does with a promoted model (4.8). One model that fails to evaluate is logged and the other still runs.
 */
const QUEUE_NAME = 'ai-firewall-promotion';

export interface GateRunDeps {
  load: (name: ShadowModelId) => ModelLoadResult;
  store: PromotionStoreDeps;
  evidence: EvidenceDeps;
  histograms: HashRedis;
  now: () => number;
}

export interface GateRunResult {
  model: ShadowModelId;
  change: StateChange | 'failed';
  verdict: GateVerdict | null;
}

/** The model's drift: the reference week (kept once found) and the last complete week against it. Never throws. */
export async function driftOf(name: ShadowModelId, m: ShadowModel, prev: ModelStateRecord | null, nowMs: number, redis: HashRedis): Promise<StoredDrift> {
  const sha256 = m.meta.sha256.toLowerCase();
  const sha = shortSha(sha256);
  const edges = modelEdges(m.ensemble);
  const age = modelAgeDays(m.meta.trainedAt, nowMs);
  let reference: DriftHistogram | null = prev?.drift?.sha256 === sha256 ? prev.drift.reference : null;
  const startedMs = prev?.modelSha256 === sha256 && prev.shadowStartedAt ? Date.parse(prev.shadowStartedAt) : nowMs;
  try {
    const weeks = completeWeeksSince(Number.isFinite(startedMs) ? startedMs : nowMs, nowMs);
    if (!reference) {
      for (const week of weeks) {
        const h = await readHistogram(redis, name, sha, week, edges);
        if (h.n >= DRIFT_MIN_SAMPLES) { reference = h; break; }
      }
    }
    const last = weeks.at(-1);
    const current = last ? await readHistogram(redis, name, sha, last, edges) : null;
    return { sha256, reference, report: driftReport(reference, current, m.meta.featureNames, age) };
  } catch {
    return { sha256, reference, report: driftReport(reference, null, m.meta.featureNames, age) };
  }
}

/** One model's evaluation and transition. Throws when its row cannot be read or written (the caller logs it). */
export async function evaluateModel(name: ShadowModelId, deps: GateRunDeps): Promise<GateRunResult> {
  const nowMs = deps.now();
  const load = deps.load(name);
  // D55-130: the other stage as this process loaded it, for the pair's independence (one that cannot load is no partner).
  let peer: ModelLoadResult | null;
  try {
    peer = deps.load(name === 'behaviour' ? 'attack' : 'behaviour');
  } catch {
    peer = null;
  }
  const before = (await deps.store.inRoot((db) => readStates(db))).get(name) ?? null;
  const m: ShadowModel | null = load.ok ? { ensemble: load.ensemble, meta: load.meta } : null;
  const evidence = m ? await gatherEvidence(name, m, nowMs, deps.evidence) : null;
  const drift = m ? await driftOf(name, m, before, nowMs, deps.histograms) : null;
  const done = await deps.store.inRoot(async (db) => {
    const locked = await lockState(db, name);
    const verdict = evaluateGate({ model: name, load, peer, state: locked, evidence, drift: drift?.report ?? null, nowMs });
    const t = nextState(locked, verdict, drift, nowMs);
    await writeState(db, t.record);
    return { verdict, t };
  });
  if (done.t.change === 'promoted' || done.t.change === 'demoted') {
    try {
      await deps.store.audit(stateAuditRow(name, done.t.change, done.t.record, done.t.reason, null));
    } catch (e) {
      Logger.warn(`[CronJob:${QUEUE_NAME}] ${name}: the ${done.t.change} audit row failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { model: name, change: done.t.change, verdict: done.verdict };
}

/** Both models, one after the other. Never throws. */
export async function runPromotionGate(deps?: GateRunDeps): Promise<GateRunResult[]> {
  const d = deps ?? (await defaultGateDeps());
  const out: GateRunResult[] = [];
  for (const name of SHADOW_MODELS) {
    try {
      const r = await evaluateModel(name, d);
      out.push(r);
      Logger.info(`[CronJob:${QUEUE_NAME}] ${name}: ${r.change}${r.verdict && r.verdict.failing.length ? ` (shadow: ${r.verdict.failing.join(', ')})` : ''}`);
    } catch (e) {
      out.push({ model: name, change: 'failed', verdict: null });
      Logger.warn(`[CronJob:${QUEUE_NAME}] ${name}: the gate could not run: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

async function defaultGateDeps(): Promise<GateRunDeps> {
  const [{ loadShippedModel }, { default: redis }, { withTenantTransactionFor }, { listLiveTenantIds }] = await Promise.all([
    import('../models/shipped-models'),
    import('@kuraykaraaslan-labs/redis'),
    import('@kuraykaraaslan-labs/db'),
    import('@kuraykaraaslan-labs/tenant/server/tenant.sweep'),
  ]);
  return {
    load: loadShippedModel,
    store: defaultPromotionStoreDeps,
    evidence: {
      listTenants: () => listLiveTenantIds(),
      inTenant: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
      redis: redis as unknown as CountRedis,
    },
    histograms: redis as unknown as HashRedis,
    now: () => Date.now(),
  };
}

/* ──────────────────────────────── The schedule ──────────────────────────────── */

let worker: Worker | null = null;
let scheduled = false;

/**
 * `common:boot_task` (scheduler phase; single-owner, so the leader runs it): the daily run and one run at boot, one at a time. A boot after a
 * release with a new model file starts that file's shadow period at once.
 */
export async function schedulePromotionGate(cronPattern = '30 4 * * *'): Promise<void> {
  if (scheduled) return;
  scheduled = true;
  const [{ createQueue, createWorker }, { registerWorkerDrain }, { runWithJobContext }] = await Promise.all([
    import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('@kuraykaraaslan-labs/logger/server/logger.request-context'),
  ]);
  const queue = createQueue(QUEUE_NAME, { defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } });
  worker ??= createWorker(QUEUE_NAME, async () => runWithJobContext(QUEUE_NAME, () => runPromotionGate()), { concurrency: 1 });
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  await queue.add('evaluate', {}, { repeat: { pattern: cronPattern }, jobId: `${QUEUE_NAME}-recurring` });
  await queue.add('evaluate-at-boot', {}, { jobId: `${QUEUE_NAME}-boot-${Date.now()}` });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern} and one run at boot`);
}
