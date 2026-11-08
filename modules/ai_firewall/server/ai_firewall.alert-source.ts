import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { AlertSourceProvider, AlertSourceSpec } from '@kuraykaraaslan-labs/observability/server/alert.source.types';
import { INCIDENTS_TABLE } from './store/ai_firewall.store';
import { ALERT_MAX_SPECS, ALERT_MIN_SCORE, firingSpecs } from './incidents/ai_firewall.incident-model';
import { INCIDENT_SELECT, defaultIncidentStoreDeps, recordOf } from './incidents/ai_firewall.incident-store';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { SHADOW_MODELS, type ShadowModelId } from './detect/ai_firewall.risk';
import { gateRanLately, type ModelStateRecord } from './promotion/ai_firewall.promotion-model';

/**
 * `observability:alert-source` (docs/phases/55-ai-firewall/02 §2.7, D55-39): the firewall's incidents enter the alert pipeline (routing,
 * grouping, silences, on-call) instead of a notifier of its own. State-based, as the pipeline asks: every minutely sweep of a tenant lists
 * its OPEN incidents whose peak reached ALERT_MIN_SCORE (the highest ALERT_MAX_SPECS); one that is acknowledged, resolved or expired is no
 * longer listed and the pipeline resolves its alert. Each spec is labelled `category=security`, so the Security route observability
 * seeds for every tenant (phase 55 00.4) claims it. A tenant's sweep lists the tenant's own incidents (RLS, its own rows); the ROOT
 * tenant's sweep lists the platform's (addresses, anonymous callers, ROOT actors: D55-24).
 *
 * Observe: an alert tells a person; nothing acts. A read that fails throws (the pipeline then leaves the alerts this module raised as
 * they are: failing to look is not recovery).
 */
export interface AlertSourceDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  /** 4.7, 4.9: the tree models' promotion states (the ROOT tenant's sweep only); throws when the store cannot be read. */
  modelStates?: () => Promise<ReadonlyMap<ShadowModelId, ModelStateRecord>>;
}

/** The database is imported on first use. */
const defaultDeps: AlertSourceDeps = {
  inTenant: defaultIncidentStoreDeps.inTenant,
  modelStates: async () => {
    const [{ defaultPromotionStoreDeps, readStates }] = await Promise.all([import('./promotion/ai_firewall.promotion-store')]);
    return defaultPromotionStoreDeps.inRoot((db) => readStates(db));
  },
};

/** An automatic demotion is raised for this long after it happened (while the model is still in shadow). */
export const DEMOTION_ALERT_MS = 7 * 24 * 60 * 60 * 1000;

const MODEL_WORDS: Readonly<Record<ShadowModelId, string>> = { behaviour: 'the behaviour model (LightGBM)', attack: 'the attack model (XGBoost)' };

/**
 * The tree models' alerts (4.7, 4.9), on the ROOT tenant's sweep (the models are the platform's), state-based like the incidents':
 *   - `model.<name>.demoted`: the gate demoted a promoted model back to shadow on its own (not an owner's hold), for DEMOTION_ALERT_MS or
 *     until it is promoted again (MAJOR; WARNING when a release changed or removed the model file);
 *   - `model.<name>.drift`: the latest weekly drift check found the score or a feature drifting (MINOR);
 *   - `model.<name>.stale`: the model is older than the age bound (WARNING);
 *   - `model.<name>.gate_not_run`: the gate has not evaluated the model within PROMOTION_FRESH_MS (D55-128: leader or queue down, a job
 *     that keeps failing); MAJOR for a promoted model (the cascade fell back to shadow on its own), WARNING for one in shadow.
 * Labelled `category=security` (the seeded Security route) and `scope=platform`; names and numbers only. Pure.
 */
export function modelAlertSpecs(states: ReadonlyMap<ShadowModelId, ModelStateRecord>, nowMs: number): AlertSourceSpec[] {
  const out: AlertSourceSpec[] = [];
  for (const name of SHADOW_MODELS) {
    const r = states.get(name);
    if (!r) continue;
    const labels = { category: 'security', source: 'ai_firewall', scope: 'platform', model: name };
    const page = '/admin/platform/ai-firewall';
    const demotedAt = r.demotedAt ? Date.parse(r.demotedAt) : Number.NaN;
    if (r.state === 'shadow' && Number.isFinite(demotedAt) && nowMs - demotedAt <= DEMOTION_ALERT_MS && r.demotedReason && r.demotedReason !== 'held') {
      out.push({
        key: `model.${name}.demoted`,
        title: `AI firewall: ${MODEL_WORDS[name]} was demoted to shadow`,
        // a release that changed or removed the model is expected (WARNING); a gate that failed is news (MAJOR)
        severity: r.demotedReason.startsWith('model_') ? 'WARNING' : 'MAJOR',
        labels: { ...labels, kind: 'demoted' },
        annotations: { reason: r.demotedReason, demotedAt: r.demotedAt!, page },
      });
    }
    const report = r.drift?.report;
    if (report?.status === 'drifting') {
      out.push({
        key: `model.${name}.drift`,
        title: `AI firewall: the traffic ${MODEL_WORDS[name]} scores has drifted`,
        severity: 'MINOR',
        labels: { ...labels, kind: 'drift' },
        annotations: {
          week: report.week ?? '', referenceWeek: report.referenceWeek ?? '', scorePsi: String(report.scorePsi ?? ''),
          maxFeaturePsi: String(report.maxFeaturePsi ?? ''), features: report.drifting.map((d) => d.feature).join(', '), page,
        },
      });
    }
    const evaluatedAt = r.lastEvaluatedAt ? Date.parse(r.lastEvaluatedAt) : Number.NaN;
    if (Number.isFinite(evaluatedAt) && !gateRanLately(r, nowMs)) {
      out.push({
        key: `model.${name}.gate_not_run`,
        title: `AI firewall: the promotion gate has not checked ${MODEL_WORDS[name]} lately`,
        severity: r.state === 'promoted' ? 'MAJOR' : 'WARNING',
        labels: { ...labels, kind: 'gate_not_run' },
        annotations: { lastEvaluatedAt: r.lastEvaluatedAt!, state: r.state, page },
      });
    }
    if (report?.stale) {
      out.push({
        key: `model.${name}.stale`,
        title: `AI firewall: ${MODEL_WORDS[name]} is older than it should be`,
        severity: 'WARNING',
        labels: { ...labels, kind: 'stale' },
        annotations: { ageDays: String(report.ageDays ?? ''), page },
      });
    }
  }
  return out;
}

export const FIRING_SQL = `SELECT ${INCIDENT_SELECT} FROM "${INCIDENTS_TABLE}"
  WHERE "tenantId" = $1 AND "status" = 'open' AND "peakScore" >= $2
  ORDER BY "peakScore" DESC, "lastSignalAt" DESC LIMIT $3`;

export async function listFiringIncidents(tenantId: string, deps: AlertSourceDeps = defaultDeps): Promise<AlertSourceSpec[]> {
  const rows = await deps.inTenant(tenantId, async (db) => rowsOf<Record<string, unknown>>(await db.query(FIRING_SQL, [tenantId, ALERT_MIN_SCORE, ALERT_MAX_SPECS])));
  const records = rows.map((r) => recordOf(r)).filter((r): r is NonNullable<typeof r> => r !== null);
  return firingSpecs(records);
}

/** The tenant's firing incidents and, on the ROOT tenant's sweep, the tree models' alerts. Throws when either read fails. */
export async function listFiring(tenantId: string, deps: AlertSourceDeps = defaultDeps, nowMs: number = Date.now()): Promise<AlertSourceSpec[]> {
  const incidents = await listFiringIncidents(tenantId, deps);
  if (!isRootTenant(tenantId) || !deps.modelStates) return incidents;
  return [...incidents, ...modelAlertSpecs(await deps.modelStates(), nowMs)];
}

const provider: AlertSourceProvider = {
  listFiring: (tenantId: string) => listFiring(tenantId),
};

export default provider;
