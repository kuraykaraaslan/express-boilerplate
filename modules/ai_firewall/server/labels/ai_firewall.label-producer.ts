import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { EVENTS_TABLE, INCIDENTS_TABLE, type EventRow } from '../store/ai_firewall.store';
import {
  BAN_KIND, LIFTED_AS_WRONG_SOURCES, banLiftedLabelOf, banPlacedLabelOf, banSourceOf, planEventLabels, suspectedClassOf,
  type LabelClass, type LabelWrite,
} from './ai_firewall.label-model';
import { insertLabels } from './ai_firewall.label-store';
import { countProbeLabels, isStamped, planProbeLabels, type InstallRoleView } from './ai_firewall.probe-labels';
import { captureEventVectors, vectorCaptureOn, type CapturedVectors, type VectorRef } from '../dataset/ai_firewall.vector-capture';

/**
 * The label producer that needs no person (docs/phases/55-ai-firewall/03 §3.1, D55-76): the fw:signals consumer hands it each tenant's
 * stored events after their write (`store/ai_firewall.signal-consumer.ts`, option `labels`), and it writes
 *
 *   - a label for every decoy touch (a kind of `honeytokenDetectorKinds`, 02 §2.5): source honeytoken, class honeytoken_touch,
 *     confidence 1, about whoever touched it;
 *   - a label for every address ban an operator placed (`security.ip_banned` by a person: a manual ban, or a firewall proposal an operator
 *     approved in 05): source ban_confirmed, the class of the address's latest incident in the same store tenant, else `other`;
 *   - a label for every lift by an operator of a ban that was automatic or the firewall's (`security.ip_unbanned` by a person, the latest
 *     earlier `security.ip_banned` of that target with source `auto` or `firewall`): source ban_confirmed, class benign. A manual ban lifted
 *     is the operator's own change of mind and labels nothing; a lift whose ban is no longer stored labels nothing either;
 *   - a label for every event a probe run or a benign-traffic run stamped (03 §3.3, §3.4, `ai_firewall.probe-labels.ts`): source
 *     synthetic or benign_traffic, the class the run declared, ONLY on a staging install (benign also on the demo); on a production
 *     install a stamped event labels nothing and is counted (`ai_firewall_probe_labels_total{result="not_staging"}`).
 *
 * Bans and lifts are the platform's (address bans are installation-wide), so they and their labels are the ROOT tenant's rows. An
 * automatic ban, or a firewall run without a person, labels nothing: no one confirmed it. The firewall's own actions in 05 that an operator
 * approves or undoes reach the same rows through the ban's own audit row once 05 passes the operator's id to the limiter (open in 05).
 *
 * On a staging or demo install every label also keeps the vectors of its actor read when it is produced (03 §3.5, D55-88, `vectors`),
 * which the dataset export joins it to; a production install keeps none.
 *
 * Idempotent per (reference, source): a redelivered event writes nothing twice. Fail open (FWA-7): one tenant transaction of its own after
 * the events' write, never part of it; a failure is counted and logged by the consumer, never retried, and never delays the stream's
 * acknowledgement. Bounded: at most PRODUCED_MAX labels per call (decoy touches are already bounded at the producer, D55-54).
 */
export const PRODUCED_MAX = 500;

export interface LabelProducerDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  /** The detector kinds of every registered decoy (empty when the registry cannot be read: then no touch is labelled). */
  honeytokenKinds: () => Promise<ReadonlySet<string>>;
  now: () => number;
  /** The install's role (03 §3.3: a stamped event is a label on staging, benign also on the demo); read only for a batch with a stamp. */
  installRole?: () => Promise<InstallRoleView>;
  /**
   * The vectors of the labelled references' actors, read now (03 §3.5, D55-88): the default reads them only on a staging or demo install
   * and answers none on production; absent = none (as in the producer's own tests). Asked only for a batch that labels something, before
   * the label transaction opens; a failure is no vectors, never a lost label.
   */
  vectors?: (tenantId: string, refs: readonly VectorRef[]) => Promise<ReadonlyMap<string, CapturedVectors>>;
}

/** The install's role from the env, loaded on first use (the env stays out of this file's import graph and its tests). */
const installRoleLazily = async (): Promise<InstallRoleView> =>
  (await import('@kuraykaraaslan-labs/common/server/common.firewall-probe-gate')).currentInstallRole();

/** How long the decoy kinds are kept in process (the registry is fixed per process; a failed read is tried again after this). */
export const HONEYTOKEN_KINDS_TTL_MS = 10 * 60 * 1000;
let kindsCache: { at: number; kinds: ReadonlySet<string> } | null = null;

/** The registry's decoy kinds, cached per process; an unreadable registry answers none (and is read again a minute later). */
export async function registeredHoneytokenKinds(now: number = Date.now()): Promise<ReadonlySet<string>> {
  if (kindsCache && now - kindsCache.at < HONEYTOKEN_KINDS_TTL_MS) return kindsCache.kinds;
  try {
    const [{ firewallRegistry }, { honeytokenDetectorKinds }] = await Promise.all([
      import('../registry/ai_firewall.registry'),
      import('../ai_firewall.honeytoken.service'),
    ]);
    kindsCache = { at: now, kinds: honeytokenDetectorKinds(await firewallRegistry()) };
  } catch {
    kindsCache = { at: now - HONEYTOKEN_KINDS_TTL_MS + 60_000, kinds: new Set() };
  }
  return kindsCache.kinds;
}

/** Test seam: forget the cached decoy kinds. */
export function resetHoneytokenKindsCache(): void {
  kindsCache = null;
}

const defaultDeps = (): LabelProducerDeps => ({
  inTenant: async (tenantId, fn) => {
    await import('reflect-metadata');
    const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db');
    return withTenantTransactionFor(tenantId, (qr) => fn(qr));
  },
  accessRel: async (db, table) => (await import('@kuraykaraaslan-labs/db/server/db.time-series.rollup')).accessRel(db, table),
  honeytokenKinds: () => registeredHoneytokenKinds(),
  now: () => Date.now(),
  installRole: installRoleLazily,
  vectors: async (tenantId, refs) => {
    const role = await installRoleLazily().catch((): InstallRoleView => 'production');
    return vectorCaptureOn(role) ? captureEventVectors(tenantId, refs) : new Map();
  },
});

/** The latest incident of each address in the tenant: the class an operator's ban of it confirms. */
async function classesOfAddresses(db: SqlRunner, tenantId: string, targets: readonly string[]): Promise<Map<string, LabelClass>> {
  const out = new Map<string, LabelClass>();
  if (targets.length === 0) return out;
  const rows = rowsOf<{ actorId: string; reason: string | null; detections: unknown }>(await db.query(
    `SELECT DISTINCT ON ("actorId") "actorId", "reason", "detections" FROM "${INCIDENTS_TABLE}"
      WHERE "tenantId" = $1 AND "actorKind" = 'ip' AND "actorId" = ANY($2::text[]) ORDER BY "actorId", "lastSignalAt" DESC`,
    [tenantId, [...new Set(targets)]],
  ));
  for (const r of rows) {
    const detections = typeof r.detections === 'string' ? (JSON.parse(r.detections) as object) : (r.detections as object | null);
    out.set(r.actorId, suspectedClassOf({ reason: r.reason, detections: (detections ?? {}) as never }));
  }
  return out;
}

/** The source of the latest ban of each target stored at or before `until`. */
async function lastBanSources(
  db: SqlRunner, deps: LabelProducerDeps, tenantId: string, targets: readonly string[], until: string,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (targets.length === 0) return out;
  const rel = await deps.accessRel(db, EVENTS_TABLE);
  const rows = rowsOf<{ subjectId: string; source: unknown }>(await db.query(
    `SELECT DISTINCT ON ("subjectId") "subjectId", "attrs" -> 'm.source' AS "source" FROM ${rel}
      WHERE "tenantId" = $1 AND "kind" = $2 AND "subjectType" = 'ip' AND "subjectId" = ANY($3::text[]) AND "at" <= $4::timestamptz
      ORDER BY "subjectId", "at" DESC`,
    [tenantId, BAN_KIND, [...new Set(targets)], until],
  ));
  for (const r of rows) out.set(r.subjectId, banSourceOf(r.source));
  return out;
}

const latestAt = (rows: ReadonlyArray<{ row: EventRow }>): string =>
  rows.reduce((max, { row }) => (Date.parse(row.at) > Date.parse(max) ? row.at : max), rows[0]!.row.at);

/**
 * Labels one tenant's stored events; answers how many labels were new. Throws when the write throws (the consumer counts it and moves on).
 * No database call at all for a batch with no decoy touch, ban or lift by a person (the common case).
 */
export async function produceEventLabels(
  tenantId: string, rows: readonly EventRow[], deps: LabelProducerDeps = defaultDeps(),
): Promise<number> {
  if (rows.length === 0) return 0;
  const atIso = new Date(deps.now()).toISOString();
  const own = rows.filter((r) => r.tenantId === tenantId);
  const plan = planEventLabels(own, await deps.honeytokenKinds(), atIso);
  // 03 §3.3 / §3.4: stamped events; the install role is read only when the batch carries a stamp (never on the common path)
  let probeLabels: LabelWrite[] = [];
  if (own.some(isStamped)) {
    // a role that cannot be read is production: a stamp then labels nothing (never a label on doubt), and the rest still goes
    const role = await (deps.installRole ?? installRoleLazily)().catch((): InstallRoleView => 'production');
    const probe = planProbeLabels(own, role, atIso);
    countProbeLabels(probe.results);
    probeLabels = probe.labels;
  }
  if (plan.touches.length === 0 && plan.bans.length === 0 && plan.lifts.length === 0 && probeLabels.length === 0) return 0;
  // 03 §3.5: the actors' vectors now, outside the transaction (Redis reads never hold it); none on production
  const vectors = deps.vectors
    ? await deps.vectors(tenantId, [
      ...[...plan.touches, ...probeLabels].map((l) => ({ refId: l.refId, actorKind: l.actorKind, actorId: l.actorId, lane: l.lane })),
      ...[...plan.bans, ...plan.lifts].map((b) => ({ refId: b.row.signalId, actorKind: 'ip', actorId: b.target, lane: b.row.lane })),
    ]).catch((): ReadonlyMap<string, CapturedVectors> => new Map())
    : null;
  const withVectors = (l: LabelWrite): LabelWrite => {
    const v = l.refKind === 'event' ? vectors?.get(l.refId) : undefined;
    return v ? { ...l, vectors: v } : l;
  };
  return deps.inTenant(tenantId, async (db) => {
    const labels: LabelWrite[] = [...plan.touches];
    if (plan.bans.length) {
      const classes = await classesOfAddresses(db, tenantId, plan.bans.map((b) => b.target));
      for (const b of plan.bans) labels.push(banPlacedLabelOf(b.row, b.target, classes.get(b.target) ?? null, atIso));
    }
    if (plan.lifts.length) {
      const sources = await lastBanSources(db, deps, tenantId, plan.lifts.map((l) => l.target), latestAt(plan.lifts));
      for (const l of plan.lifts) {
        const source = sources.get(l.target);
        if (source && LIFTED_AS_WRONG_SOURCES.has(source)) labels.push(banLiftedLabelOf(l.row, l.target, atIso));
      }
    }
    // the probe lane's labels last: a full batch cuts its own synthetic rows before a decoy touch or an operator's decision
    labels.push(...probeLabels);
    return insertLabels(db, tenantId, labels.slice(0, PRODUCED_MAX).map(withVectors));
  });
}

