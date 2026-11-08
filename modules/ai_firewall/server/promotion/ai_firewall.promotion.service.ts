import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { ModelLoadResult } from '../models/shipped-models';
import type { ShadowModelId } from '../detect/ai_firewall.risk';
import { holdState, releaseState, type ModelStateRecord } from './ai_firewall.promotion-model';
import { defaultPromotionStoreDeps, lockState, readStates, stateAuditRow, writeState, type PromotionStoreDeps } from './ai_firewall.promotion-store';

/**
 * The promotion store as the pages and the cascade read it, and a ROOT owner's override (docs/phases/55-ai-firewall/04-tree-models.md 4.7,
 * FWD-12): `hold` puts a model back in shadow at once and keeps it there (a promoted model is demoted on the spot); `release` lifts the hold
 * and promotes nothing: the next run of the gate decides, on the same criteria as always. The route (ai-firewall-models.route.ts) has
 * already checked the caller (GLOBAL scope, the ROOT tenant's OWNER).
 */
export interface OverrideResult {
  model: ShadowModelId;
  /** The state as it stands after the call. */
  record: ModelStateRecord;
  /** Whether this call changed anything (holding a held model, releasing one that is not held: nothing). */
  changed: boolean;
}

export interface OverrideDeps {
  store: PromotionStoreDeps;
  load: (name: ShadowModelId) => ModelLoadResult;
  now: () => number;
}

const defaultOverrideDeps = async (): Promise<OverrideDeps> => {
  const { loadShippedModel } = await import('../models/shipped-models');
  return { store: defaultPromotionStoreDeps, load: loadShippedModel, now: () => Date.now() };
};

/** Every model's stored state, or null when the store cannot be read (the page shows it as unavailable). Never throws. */
export async function readPromotionStates(store: PromotionStoreDeps = defaultPromotionStoreDeps): Promise<Map<ShadowModelId, ModelStateRecord> | null> {
  try {
    return await store.inRoot((db) => readStates(db));
  } catch (e) {
    Logger.warn(`[ai_firewall] the promotion store is unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function audit(store: PromotionStoreDeps, row: Record<string, unknown>, what: string): Promise<void> {
  try {
    await store.audit(row);
  } catch (e) {
    // The state is written; a lost audit row is logged, never a failed request.
    Logger.warn(`[ai_firewall] the ${what} audit row failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Holds a model in shadow (the owner's override). The note is the owner's reason, kept in the audit row only. */
export async function holdModel(model: ShadowModelId, actorId: string | null, note: string, deps?: OverrideDeps): Promise<OverrideResult> {
  const d = deps ?? (await defaultOverrideDeps());
  const load = d.load(model);
  const sha = load.ok ? load.meta.sha256.toLowerCase() : null;
  const t = await d.store.inRoot(async (db) => {
    const t = holdState(await lockState(db, model), model, sha, d.now());
    if (t.reason === 'held') await writeState(db, t.record);
    return t;
  });
  const changed = t.reason === 'held';
  if (changed) {
    await audit(d.store, stateAuditRow(model, 'held', t.record, null, actorId, note), 'hold');
    if (t.change === 'demoted') await audit(d.store, stateAuditRow(model, 'demoted', t.record, 'held', actorId), 'demotion');
  }
  return { model, record: t.record, changed };
}

/** Lifts an owner's hold; never promotes. 404 when the model has no state yet (nothing was ever held). */
export async function releaseModel(model: ShadowModelId, actorId: string | null, note: string, deps?: OverrideDeps): Promise<OverrideResult> {
  const d = deps ?? (await defaultOverrideDeps());
  const out = await d.store.inRoot(async (db) => {
    const prev = await lockState(db, model);
    if (!prev) return null;
    const t = releaseState(prev);
    if (t) await writeState(db, t.record);
    return { record: t?.record ?? prev, changed: !!t };
  });
  if (!out) throw new AppError('This model has no promotion state yet.', 404, ErrorCode.NOT_FOUND, { details: { reason: 'AI_FIREWALL_MODEL_STATE_NOT_FOUND' } });
  if (out.changed) await audit(d.store, stateAuditRow(model, 'released', out.record, null, actorId, note), 'release');
  return { model, ...out };
}
