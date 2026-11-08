import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { INCIDENTS_TABLE } from '../store/ai_firewall.store';
import { LABELS_TABLE } from '../labels/ai_firewall.label-store';
import { isLabelClass } from '../labels/ai_firewall.label-model';
import { attackClassOf } from '../training/training.classes';
import { storedVectorsOf } from '../dataset/ai_firewall.vector-capture';
import { predict } from '../trees/tree-ensemble.predict';
import type { ShadowModelId } from '../detect/ai_firewall.risk';
import type { IncidentModels } from '../incidents/ai_firewall.incident-model';
import { attackVerdict, rowOf, shortSha, type ShadowModel } from '../shadow/ai_firewall.shadow-score';
import { readShadowCounts, utcDay, type CountRedis } from '../shadow/ai_firewall.shadow-tally';
import { EVIDENCE_WINDOW_DAYS, type ShadowEvidence } from './ai_firewall.promotion-model';

/**
 * What shadow saw, for the promotion gate (docs/phases/55-ai-firewall/04-tree-models.md 4.7): over the last EVIDENCE_WINDOW_DAYS and every
 * tenant of the install, counts only.
 *
 *   - the active and flagged actor-days: the shadow tally's HyperLogLogs per UTC day (ai_firewall.shadow-tally.ts);
 *   - per tenant, in the tenant's own transaction (RLS), the incidents a model scored (their `models` tracks of this model file) with the
 *     person's verdict on each and whether a source whose truth we know (a decoy touch, a probe, a confirmed ban) labelled the same actor as
 *     an attack in the window: the confirmed flagged actor-days, the verdicts on flagged incidents (behaviour's precision) and the
 *     admin-confirmed false positives at a rung of step-up or above;
 *   - attack only, per tenant: the probe lane's (synthetic) and the benign traffic's labels with their kept vectors (03 §3.5; only a
 *     staging or demo install keeps any), scored again with the model: what shadow would have said about exactly that traffic.
 *
 * A tenant that cannot be read, a read cut at its bound or shadow counts that cannot be read make the evidence incomplete, which keeps the
 * model in shadow (D55-109). Never throws.
 */
export const EVIDENCE_INCIDENTS_MAX = 20_000;
export const EVIDENCE_LABELS_MAX = 20_000;

const DAY_MS = 86_400_000;

export const EVIDENCE_INCIDENTS_SQL = `SELECT i."models", l."verdict",
    EXISTS (SELECT 1 FROM "${LABELS_TABLE}" s WHERE s."tenantId" = i."tenantId" AND s."actorKind" = i."actorKind" AND s."actorId" = i."actorId"
      AND s."source" IN ('honeytoken', 'synthetic', 'ban_confirmed') AND s."labelClass" <> 'benign' AND s."refAt" >= $2::timestamptz) AS "systemAttack"
  FROM "${INCIDENTS_TABLE}" i
  LEFT JOIN "${LABELS_TABLE}" l ON l."tenantId" = i."tenantId" AND l."refKind" = 'incident' AND l."refId" = i."incidentId"::text AND l."source" = 'admin'
  WHERE i."tenantId" = $1 AND i."models" IS NOT NULL AND i."lastSignalAt" >= $2::timestamptz
  ORDER BY i."lastSignalAt" DESC LIMIT $3`;

export const EVIDENCE_LABELS_SQL = `SELECT "labelClass", "source", "vectors" FROM "${LABELS_TABLE}"
  WHERE "tenantId" = $1 AND "source" IN ('synthetic', 'benign_traffic') AND "vectors" IS NOT NULL AND "refAt" >= $2::timestamptz
  ORDER BY "refAt" DESC LIMIT $3`;

/** The window's UTC days, oldest first, ending today. */
export function windowDays(nowMs: number, days: number = EVIDENCE_WINDOW_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => utcDay(nowMs - (days - 1 - i) * DAY_MS));
}

const tracksOf = (raw: unknown): IncidentModels | null => {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  return v && typeof v === 'object' ? (v as IncidentModels) : null;
};

export interface IncidentFold {
  confirmedActorDays: number;
  labelled: { truePositive: number; falsePositive: number };
  confirmedFalsePositives: number;
}

/**
 * The window's model-scored incidents of one tenant, folded for one model file (pure). An incident counts as flagged when its track for
 * this model file flagged the actor on a day of the window; its flagged days are confirmed when a person called it a true positive or a
 * system source labelled the actor as an attack; a person's false positive on a flagged incident is an admin-confirmed false positive at a
 * rung of step-up or above (a flag is that rung by definition).
 */
export function foldIncidents(
  rows: ReadonlyArray<{ models: unknown; verdict: unknown; systemAttack: unknown }>, model: ShadowModelId, sha: string, firstDay: string,
): IncidentFold {
  const out: IncidentFold = { confirmedActorDays: 0, labelled: { truePositive: 0, falsePositive: 0 }, confirmedFalsePositives: 0 };
  for (const row of rows) {
    const track = tracksOf(row.models)?.[model];
    if (!track || track.sha !== sha || !Array.isArray(track.flaggedDays)) continue;
    const days = track.flaggedDays.filter((d) => typeof d === 'string' && d >= firstDay).length;
    if (days === 0) continue;
    const verdict = typeof row.verdict === 'string' ? row.verdict : null;
    if (verdict === 'true_positive' || row.systemAttack === true || row.systemAttack === 't') out.confirmedActorDays += days;
    if (verdict === 'true_positive') out.labelled.truePositive += 1;
    if (verdict === 'false_positive') {
      out.labelled.falsePositive += 1;
      out.confirmedFalsePositives += 1;
    }
  }
  return out;
}

export interface LabelFold {
  classes: ShadowEvidence['classes'];
  benign: ShadowEvidence['benign'];
}

/**
 * The window's synthetic and benign-traffic labels of one tenant scored with the attack model (pure). A kept vector of another catalogue or
 * pinned hash than the model's is left out. Per attack class: its labels, those the model flagged as that class (`detected`), and every
 * label the model flagged as that class (`predicted`, a benign label included): precision is detected / predicted, recall detected /
 * labels. A benign-traffic label the model flags is a benign false positive.
 */
export function foldLabels(rows: ReadonlyArray<{ labelClass: unknown; source: unknown; vectors: unknown }>, m: ShadowModel, into?: LabelFold): LabelFold {
  const out: LabelFold = into ?? { classes: {}, benign: { labels: 0, flagged: 0 } };
  const entry = (cls: string) => (out.classes[cls] ??= { labels: 0, detected: 0, predicted: 0 });
  for (const row of rows) {
    if (!isLabelClass(row.labelClass)) continue;
    const v = storedVectorsOf(row.vectors)?.attack;
    if (!v || v.catalogue !== m.meta.catalogue || (m.meta.catalogueHash && v.hash !== m.meta.catalogueHash) || v.values.length !== m.meta.featureNames.length) continue;
    let flaggedAs: string | null = null;
    try {
      const { output } = predict(m.ensemble, rowOf(v.values));
      const a = attackVerdict({ classes: m.meta.classes, probabilities: output }, m.meta.thresholds);
      if (a.attackClass && (a.verdict === 'challenge' || a.verdict === 'block' || a.verdict === 'terminate')) flaggedAs = a.attackClass;
    } catch {
      continue;
    }
    if (row.source === 'benign_traffic') {
      out.benign.labels += 1;
      if (flaggedAs) out.benign.flagged += 1;
    } else if (row.source === 'synthetic') {
      const cls = attackClassOf(row.labelClass);
      if (cls && cls !== 'benign') {
        entry(cls).labels += 1;
        if (flaggedAs === cls) entry(cls).detected += 1;
      }
    } else {
      continue;
    }
    if (flaggedAs) entry(flaggedAs).predicted += 1;
  }
  return out;
}

export interface EvidenceDeps {
  listTenants: () => Promise<string[]>;
  inTenant: <X>(tenantId: string, fn: (db: SqlRunner) => Promise<X>) => Promise<X>;
  redis: CountRedis;
  incidentsMax?: number;
  labelsMax?: number;
}

/** Everything the gate reads about one loaded model, over every tenant (never throws; anything unread makes it incomplete). */
export async function gatherEvidence(model: ShadowModelId, m: ShadowModel, nowMs: number, deps: EvidenceDeps): Promise<ShadowEvidence> {
  const sha = shortSha(m.meta.sha256);
  const days = windowDays(nowMs);
  const since = new Date(Date.parse(`${days[0]}T00:00:00.000Z`)).toISOString();
  const incidentsMax = deps.incidentsMax ?? EVIDENCE_INCIDENTS_MAX;
  const labelsMax = deps.labelsMax ?? EVIDENCE_LABELS_MAX;
  const ev: ShadowEvidence = {
    complete: true, windowDays: days.length, activeActorDays: 0, flaggedActorDays: 0, confirmedActorDays: 0,
    labelled: { truePositive: 0, falsePositive: 0 }, confirmedFalsePositives: 0, classes: {}, benign: { labels: 0, flagged: 0 },
  };
  try {
    for (const d of await readShadowCounts(deps.redis, model, sha, days)) {
      ev.activeActorDays += d.active;
      ev.flaggedActorDays += d.flagged;
    }
  } catch {
    ev.complete = false;
  }
  let tenants: string[] = [];
  try {
    tenants = await deps.listTenants();
  } catch {
    ev.complete = false;
  }
  const labels: LabelFold = { classes: ev.classes, benign: ev.benign };
  for (const tenantId of tenants) {
    try {
      await deps.inTenant(tenantId, async (db) => {
        const rows = rowsOf<{ models: unknown; verdict: unknown; systemAttack: unknown }>(await db.query(EVIDENCE_INCIDENTS_SQL, [tenantId, since, incidentsMax]));
        if (rows.length >= incidentsMax) ev.complete = false;
        const f = foldIncidents(rows, model, sha, days[0]!);
        ev.confirmedActorDays += f.confirmedActorDays;
        ev.labelled.truePositive += f.labelled.truePositive;
        ev.labelled.falsePositive += f.labelled.falsePositive;
        ev.confirmedFalsePositives += f.confirmedFalsePositives;
        if (model === 'attack') {
          const labelRows = rowsOf<{ labelClass: unknown; source: unknown; vectors: unknown }>(await db.query(EVIDENCE_LABELS_SQL, [tenantId, since, labelsMax]));
          if (labelRows.length >= labelsMax) ev.complete = false;
          foldLabels(labelRows, m, labels);
        }
      });
    } catch {
      ev.complete = false;
    }
  }
  return ev;
}
