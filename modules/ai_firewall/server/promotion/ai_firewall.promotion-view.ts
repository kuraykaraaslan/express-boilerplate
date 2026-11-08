import type { ModelPromotionView } from '../ai_firewall.activity.types';
import type { ModelStateRecord } from './ai_firewall.promotion-model';

/**
 * A model's stored promotion state as the ROOT activity page shows it (docs/phases/55-ai-firewall/04-tree-models.md 4.7, 4.9). Pure: the
 * short sha only, the gate's criteria and counts, the drift report without its reference histogram.
 */
export function modelPromotionView(r: ModelStateRecord, nowMs: number): ModelPromotionView {
  const started = r.shadowStartedAt ? Date.parse(r.shadowStartedAt) : Number.NaN;
  const v = r.verdict;
  return {
    name: r.model,
    state: r.state,
    held: !!r.heldAt,
    heldAt: r.heldAt,
    sha: r.modelSha256 ? r.modelSha256.slice(0, 12) : null,
    shadowStartedAt: r.shadowStartedAt,
    shadowDays: Number.isFinite(started) ? Math.max(0, Math.floor(((nowMs - started) / 86_400_000) * 10) / 10) : null,
    promotedAt: r.promotedAt,
    demotedAt: r.demotedAt,
    demotedReason: r.demotedReason,
    lastEvaluatedAt: r.lastEvaluatedAt,
    verdict: v ? {
      at: v.at,
      passed: v.passed,
      failing: [...(v.failing ?? [])],
      criteria: (v.criteria ?? []).map((c) => ({
        id: c.id, status: c.status, value: c.value ?? null, target: c.target ?? null, ...(c.classes ? { classes: c.classes } : {}),
      })),
      metrics: v.metrics,
    } : null,
    drift: r.drift?.report ?? null,
  };
}
