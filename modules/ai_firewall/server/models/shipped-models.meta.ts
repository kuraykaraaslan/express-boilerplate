/**
 * The shape check of a model's `<name>.meta.json` (docs/phases/55-ai-firewall/04-tree-models.md 4.5), shared by the embed script
 * (a bad meta is never embedded) and the loader (a bad embedded meta turns the stage off instead of throwing in the request path).
 */
import type { ModelIndependence, ShippedModelMeta, ShippedModelName } from './shipped-models.types';

const NAMES: readonly ShippedModelName[] = ['behaviour', 'attack'];
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');

/** The reason a meta is unusable, or null when it has every field with the right type. */
export function metaProblem(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return 'the meta is not an object';
  const m = meta as Record<string, unknown>;
  if (typeof m.name !== 'string' || !NAMES.includes(m.name as ShippedModelName)) return 'name must be "behaviour" or "attack"';
  if (m.library !== 'lightgbm' && m.library !== 'xgboost') return 'library must be "lightgbm" or "xgboost"';
  for (const key of ['libraryVersion', 'modelFile', 'catalogue', 'trainedAt'] as const) {
    if (typeof m[key] !== 'string' || m[key] === '') return `${key} must be a non-empty string`;
  }
  if (typeof m.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(m.sha256)) return 'sha256 must be 64 hex characters';
  if (!isStringArray(m.featureNames) || m.featureNames.length === 0) return 'featureNames must be a non-empty list of names';
  if (!isStringArray(m.classes) || m.classes.length === 0) return 'classes must be a non-empty list of names';
  if (new Set(m.classes).size !== m.classes.length) return 'classes must be unique';
  // The trainer's fields (04.1) are optional; when present they must have their type.
  if (m.synthetic !== undefined && typeof m.synthetic !== 'boolean') return 'synthetic must be a boolean';
  if (m.catalogueHash !== undefined && (typeof m.catalogueHash !== 'string' || !/^[0-9a-f]{64}$/.test(m.catalogueHash))) {
    return 'catalogueHash must be 64 lowercase hex characters';
  }
  if (m.thresholds !== undefined) {
    if (!isRecord(m.thresholds)) return 'thresholds must be an object';
    if (Object.values(m.thresholds).some((v) => typeof v !== 'number' || !(v >= 0 && v <= 1))) return 'thresholds must be numbers in [0, 1]';
  }
  if (m.thresholdTargetsMet !== undefined) {
    if (!isRecord(m.thresholdTargetsMet) || Object.values(m.thresholdTargetsMet).some((v) => typeof v !== 'boolean')) {
      return 'thresholdTargetsMet must map names to booleans';
    }
  }
  if (m.independence !== undefined) {
    const i = m.independence as Record<string, unknown>;
    if (!isRecord(i) || !INDEPENDENCE_STATUSES.includes(i.status as ModelIndependence['status'])) return 'independence.status is not a known status';
    if (i.errorCorrelation !== null && (typeof i.errorCorrelation !== 'number' || !(Math.abs(i.errorCorrelation) <= 1))) {
      return 'independence.errorCorrelation must be null or in [-1, 1]';
    }
    if (typeof i.bound !== 'number' || !(i.bound >= 0 && i.bound <= 1)) return 'independence.bound must be in [0, 1]';
    if (typeof i.jointRows !== 'number' || !Number.isInteger(i.jointRows) || i.jointRows < 0) return 'independence.jointRows must be a count';
    if (i.peerSha256 !== undefined && i.peerSha256 !== null && (typeof i.peerSha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(i.peerSha256))) {
      return 'independence.peerSha256 must be null or 64 hex characters';
    }
  }
  if (m.training !== undefined && !isRecord(m.training)) return 'training must be an object';
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const INDEPENDENCE_STATUSES: readonly ModelIndependence['status'][] = ['ok', 'flagged', 'insufficient', 'not_run'];

/**
 * The loosest error-correlation bound the gate accepts (04.4, D55-103, D55-131): the trainer's default. A run may measure against a
 * stricter bound (`--max-error-correlation` below this); a looser one, or a measured correlation above this, never passes the gate, so an
 * operator cannot make independence pass vacuously under FWD-12's automatic promotion.
 */
export const INDEPENDENCE_BOUND_MAX = 0.5;

/** Why a model may not be promoted (04.7, FWD-12), from its meta alone; the shadow period and parity are the gate's other inputs. */
export type PromotionRefusal = 'invalid_meta' | 'synthetic' | 'not_trained_by_pipeline' | 'thresholds_unmet' | 'independence_not_ok';

/**
 * The meta's part of the promotion gate (04.1, 04.4, 4.7): a synthetic model never; a model without the trainer's record (thresholds,
 * targets, independence) never; a threshold that missed its target, or an independence check that is not `ok` (flagged above its bound,
 * too few joint rows, only one model trained), measured against a bound looser than INDEPENDENCE_BOUND_MAX, above that bound, or naming
 * no partner model, blocks it. Empty when the meta allows promotion. Pure. The pair itself is `independencePaired`.
 */
export function promotionRefusals(meta: unknown): PromotionRefusal[] {
  if (metaProblem(meta) !== null) return ['invalid_meta'];
  const m = meta as ShippedModelMeta;
  const out: PromotionRefusal[] = [];
  if (m.synthetic !== false) out.push(m.synthetic === true ? 'synthetic' : 'not_trained_by_pipeline');
  if (!m.thresholds || !m.thresholdTargetsMet || !m.independence) {
    if (!out.includes('not_trained_by_pipeline')) out.push('not_trained_by_pipeline');
    return out;
  }
  if (Object.values(m.thresholdTargetsMet).some((met) => !met) || Object.keys(m.thresholdTargetsMet).length === 0) out.push('thresholds_unmet');
  const i = m.independence;
  if (
    i.status !== 'ok' || !(i.bound <= INDEPENDENCE_BOUND_MAX) || i.errorCorrelation === null || !(i.errorCorrelation <= INDEPENDENCE_BOUND_MAX)
    || typeof i.peerSha256 !== 'string'
  ) out.push('independence_not_ok');
  return out;
}

/**
 * Whether two models are the pair their independence was measured on (D55-130): each meta names the other's sha256, and they are the two
 * different stages. A behaviour model of one run beside an attack model of another fails, whatever each run's status says. Pure.
 */
export function independencePaired(meta: unknown, peer: unknown): boolean {
  if (metaProblem(meta) !== null || metaProblem(peer) !== null) return false;
  const a = meta as ShippedModelMeta;
  const b = peer as ShippedModelMeta;
  const named = (x: ShippedModelMeta, y: ShippedModelMeta) =>
    typeof x.independence?.peerSha256 === 'string' && x.independence.peerSha256.toLowerCase() === y.sha256.toLowerCase();
  return a.name !== b.name && named(a, b) && named(b, a);
}

export const isShippedModelMeta = (meta: unknown): meta is ShippedModelMeta => metaProblem(meta) === null;
