/**
 * The edge sees what the app sees (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.7, P-7): the app side of the edge ban sync.
 * The host side is `infra/compose/edge/fleet-edge-sync`, run every minute by a systemd timer on a node with CrowdSec. The two meet in Redis
 * only, so neither needs a credential, a port or a volume of the other:
 *
 *  - **app -> edge**: `publishEdgeBans` writes the standing long bans of `security_ip_bans` (an hour or more in total, more than a minute
 *    left) as ONE JSON snapshot (`edge:app-bans`, a TTL of ten minutes). The host makes each a CrowdSec local decision of type `nb-app-ban`
 *    and deletes the decision of a ban that left the snapshot. A snapshot that is gone (this job stopped, Redis flushed) changes nothing
 *    at the edge: what was exported runs out on its own. Only ids, canonical targets, ends and sources leave the app; never a reason text.
 *  - **edge -> app**: the host pushes CrowdSec's LOCAL decisions (its own scenarios, an operator's cscli) onto `edge:decisions:inbox`, one
 *    JSON document per run. `ingestEdgeDecisions` takes them, checks every field against a closed shape, and reports each new decision
 *    as an `edge.decision` row through the refusal sink (common/server/refusal-sink.ts, aggregated per address and minute by audit_log),
 *    which is how the AI firewall reads it as a signal (phase 55 01 §1.4a). Seen decision ids are remembered for a week.
 *
 * Advice, not action (FWA-1): an edge decision does not ban anyone in the app. The app's bans stay human-lane bans (38 L-4), enforced by
 * the proxy per lane; the edge records them under a type no bouncer acts on, so they never drop device or machine traffic (38 A-2).
 *
 * Runs in the scheduler process (`scheduleEdgeSync`, a `common:boot_task` of limiter/module.json). Every step is idempotent (SET of the
 * whole snapshot, LPOP, SET NX per decision id), so a second scheduler on another node does no harm. Never throws.
 */
import { IsNull, MoreThan } from 'typeorm';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { reportRefusal } from '@kuraykaraaslan-labs/common/server/refusal-sink';
import { SecurityIpBan, IP_BAN_SOURCES, type IpBanSource } from './entities/security_ip_ban.entity';
import { banTargetOf } from './limiter.ban-target';
import { withinRedisBound } from './limiter.redis-bound';

/** The snapshot of the app's long bans the host reads (`fleet-edge-sync`, SNAPSHOT_KEY). */
export const EDGE_BANS_KEY = 'edge:app-bans';
/** The documents of edge decisions the host pushes (`fleet-edge-sync`, INBOX_KEY). */
export const EDGE_INBOX_KEY = 'edge:decisions:inbox';
/** The host's last run (`fleet-edge-sync`, STATUS_KEY): read by the verification steps and, later, by the firewall page. */
export const EDGE_HOST_STATUS_KEY = 'edge:sync:host';
export const edgeDecisionSeenKey = (id: number) => `edge:decision-seen:${id}`;

/** The audit action (and signal kind) of a decision CrowdSec took at the edge. */
export const EDGE_DECISION_ACTION = 'edge.decision';

/** A ban is exported when it is this long in total: the same bar as the table's (limiter.ip-ban-store.ts PERSIST_MIN_SECONDS). */
export const EDGE_EXPORT_MIN_SECONDS = 60 * 60;
/** ... and has at least this much left (a decision for the last seconds of a ban is churn). */
export const EDGE_EXPORT_MIN_REMAINING_SECONDS = 60;
/** The most bans one snapshot carries (the latest-ending first); the host takes as many. */
export const EDGE_EXPORT_MAX = 2_000;
/** The snapshot outlives a few missed runs, never a stopped job by long. */
export const EDGE_SNAPSHOT_TTL_SECONDS = 600;
export const EDGE_SYNC_MS = 60_000;
/** Documents taken from the inbox per run (the host pushes one per minute and keeps at most 50). */
export const EDGE_INBOX_DOCS_PER_RUN = 20;
/** Decisions read from one document (the host sends at most 200). */
export const EDGE_DECISIONS_PER_DOC = 200;
/** How long a decision id counts as seen: longer than any re-push of the host. */
export const EDGE_SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
/** The reason prefix of the decisions the host made from this app's bans: never read back. */
export const EDGE_APP_REASON_PREFIX = 'nb-app/';

export type EdgeBan = { id: string; target: string; until: number; source: IpBanSource };
export type EdgeSnapshot = { v: 1; at: number; bans: EdgeBan[] };

type BanRow = Pick<SecurityIpBan, 'banId' | 'target' | 'source' | 'bannedAt' | 'expiresAt' | 'liftedAt'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES: ReadonlySet<string> = new Set(IP_BAN_SOURCES);

/** The snapshot of the rows: standing, long, not about to end, a canonical target; the latest-ending first, at most EDGE_EXPORT_MAX. Pure. */
export function buildEdgeSnapshot(rows: readonly BanRow[], now: number): EdgeSnapshot {
  const bans: EdgeBan[] = [];
  for (const row of rows) {
    if (row.liftedAt) continue;
    const until = new Date(row.expiresAt).getTime();
    const bannedAt = new Date(row.bannedAt).getTime();
    if (!Number.isFinite(until) || !Number.isFinite(bannedAt)) continue;
    if (until - now < EDGE_EXPORT_MIN_REMAINING_SECONDS * 1000) continue;
    if (until - bannedAt < EDGE_EXPORT_MIN_SECONDS * 1000) continue;
    if (!UUID.test(row.banId) || !SOURCES.has(row.source)) continue;
    const target = banTargetOf(row.target);
    // a row whose target is not in the canonical form the ban gate compares is not exported as something else
    if (!target.ok || target.target !== row.target) continue;
    bans.push({ id: row.banId.toLowerCase(), target: row.target, until, source: row.source });
  }
  bans.sort((a, b) => b.until - a.until || a.target.localeCompare(b.target));
  return { v: 1, at: now, bans: bans.slice(0, EDGE_EXPORT_MAX) };
}

/** Writes the snapshot of the standing long bans. Returns how many it carries. */
export async function publishEdgeBans(now = Date.now()): Promise<number> {
  const repo = (await getDataSource()).getRepository(SecurityIpBan);
  const rows = await repo.find({
    where: { liftedAt: IsNull(), expiresAt: MoreThan(new Date(now + EDGE_EXPORT_MIN_REMAINING_SECONDS * 1000)) },
    order: { expiresAt: 'DESC' },
    // short bans are filtered after the read; twice the cap leaves room for them
    take: EDGE_EXPORT_MAX * 2,
  });
  const snapshot = buildEdgeSnapshot(rows, now);
  await withinRedisBound(redis.set(EDGE_BANS_KEY, JSON.stringify(snapshot), 'EX', EDGE_SNAPSHOT_TTL_SECONDS));
  return snapshot.bans.length;
}

/** One decision of the edge, as the host hands it over and as far as it is believed. */
export type EdgeDecision = {
  id: number;
  origin: 'crowdsec' | 'cscli';
  type: string;
  scope: 'ip' | 'range';
  value: string;
  scenario: string;
  duration: string | null;
  simulated: boolean;
  country: string | null;
};

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** One decision of a document, or null when any field is not what the host sends. Pure. */
export function parseEdgeDecision(raw: unknown): EdgeDecision | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'number' || !Number.isSafeInteger(d.id) || d.id <= 0) return null;
  // local decisions only (38 A-2): this host's scenarios and its operator; never the community list or a subscribed list
  if (d.origin !== 'crowdsec' && d.origin !== 'cscli') return null;
  const scenario = clip(d.scenario, 120);
  if (!scenario || scenario.startsWith(EDGE_APP_REASON_PREFIX)) return null;
  const scope = typeof d.scope === 'string' ? d.scope.toLowerCase() : '';
  if (scope !== 'ip' && scope !== 'range') return null;
  const value = clip(d.value, 64);
  if (!value) return null;
  if (scope === 'ip') {
    if (value.includes('/') || !banTargetOf(value).ok) return null;
  } else {
    // a block wider than an app ban may be (an operator's /8) is still an edge decision worth a row; a value that is no block is not
    const block = value.includes('/') ? banTargetOf(value) : null;
    if (!block || (!block.ok && block.reason !== 'too_broad')) return null;
  }
  const type = clip(d.type, 32);
  if (!type || !/^[a-z0-9_-]+$/i.test(type)) return null;
  const duration = clip(d.duration, 32);
  const country = typeof d.country === 'string' && /^[A-Z]{2}$/.test(d.country) ? d.country : null;
  return {
    id: d.id,
    origin: d.origin,
    type,
    scope,
    value,
    scenario,
    duration: duration && /^-?[0-9][0-9hms.]*$/.test(duration) ? duration : null,
    simulated: d.simulated === true,
    country,
  };
}

/** The decisions of one inbox document (`{ v: 1, at, decisions: [...] }`); a document that is not one is nothing. Pure. */
export function parseEdgeDocument(text: string): EdgeDecision[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof doc !== 'object' || doc === null || (doc as { v?: unknown }).v !== 1) return [];
  const list = (doc as { decisions?: unknown }).decisions;
  if (!Array.isArray(list)) return [];
  const out: EdgeDecision[] = [];
  for (const raw of list.slice(0, EDGE_DECISIONS_PER_DOC)) {
    const d = parseEdgeDecision(raw);
    if (d) out.push(d);
  }
  return out;
}

/** Reports one edge decision: a ROOT row, counted per address (or block) and minute, the scenario as its sample. */
export function reportEdgeDecision(d: EdgeDecision): Promise<void> {
  return reportRefusal({
    action: EDGE_DECISION_ACTION,
    tenantId: null,
    key: d.value,
    ipAddress: d.scope === 'ip' ? d.value : null,
    actorType: 'SYSTEM',
    resourceType: 'edge_decision',
    resourceId: `crowdsec:${d.id}`,
    metadata: {
      decisionId: d.id,
      origin: d.origin,
      type: d.type,
      scope: d.scope,
      scenario: d.scenario,
      duration: d.duration,
      simulated: d.simulated,
      country: d.country,
    },
    sample: d.scenario,
  });
}

/** Takes the inbox and reports every decision not seen before. Returns how many were reported. */
export async function ingestEdgeDecisions(): Promise<number> {
  let reported = 0;
  for (let i = 0; i < EDGE_INBOX_DOCS_PER_RUN; i++) {
    const text = await withinRedisBound(redis.lpop(EDGE_INBOX_KEY));
    if (typeof text !== 'string') break;
    for (const d of parseEdgeDocument(text)) {
      const first = await withinRedisBound(redis.set(edgeDecisionSeenKey(d.id), '1', 'EX', EDGE_SEEN_TTL_SECONDS, 'NX'));
      if (first !== 'OK') continue;
      await reportEdgeDecision(d);
      reported += 1;
    }
  }
  return reported;
}

/** One run of both directions. Never throws: each direction is logged on failure and the other still runs. */
export async function runEdgeSync(now = Date.now()): Promise<{ exported: number | null; reported: number | null }> {
  let exported: number | null = null;
  let reported: number | null = null;
  try {
    exported = await publishEdgeBans(now);
  } catch (err) {
    Logger.warn(`[limiter] edge sync: the ban snapshot was not written: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    reported = await ingestEdgeDecisions();
  } catch (err) {
    Logger.warn(`[limiter] edge sync: the edge decisions were not read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { exported, reported };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** The scheduler boot task: a run now and every minute. */
export function scheduleEdgeSync(): void {
  if (timer) return;
  void runEdgeSync();
  timer = setInterval(() => { void runEdgeSync(); }, EDGE_SYNC_MS);
  (timer as { unref?: () => void }).unref?.();
}

/** Tests: stop the schedule. */
export function resetEdgeSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
