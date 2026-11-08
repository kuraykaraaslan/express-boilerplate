/**
 * What the request cascade decided, kept OFF the request path (docs/phases/55-ai-firewall/04-tree-models.md 4.8; D55-117, D55-118).
 *
 *   - Counts: every decision by stage, verdict and how it applied (enforced, shadow, alerts only), its reasons, the stage-1 audit sample
 *     (scored, and how many stage 1 let through that stage 2 would have challenged: the cascade's measured miss rate). The `/metrics`
 *     series of the runtime read them.
 *   - Per actor: a decision that was not `allow` (enforced or would-be), an audit-sample miss or a hovering actor is tallied in process,
 *     and each flush (FLUSH_MS) sends ONE `ai_firewall.cascade_decision` signal per tallied actor (counts, the strongest attack class and
 *     score, the support references of the refused requests, at most REFERENCES_MAX), at most SIGNALS_PER_FLUSH per flush; the rest are
 *     counted. D55-21 holds: no signal per request. The signal reaches the event store (the actor's timeline, where a support reference
 *     is found again) and queues the actor for the detectors, which score it and keep the incident.
 *   - Proposals (FWD-8, FWA-1): when the cascade, enforcing, reaches its terminate threshold with both keys, it PROPOSES ending the session
 *     and excluding the device; each proposal becomes one `proposed` row of `ai_firewall_actions` (no incident: `incidentId` null), under
 *     the action's mode for the tenant (`effectiveActionMode`), for the responder of 05 to run. Nothing is executed here. A proposal is
 *     written once per tenant, action and actor per PROPOSAL_DEDUPE_MS (in process), at most PROPOSALS_MAX waiting; an action that is
 *     not registered (its module absent) is counted and skipped.
 *
 * Never throws into a caller; a flush that fails drops its batch and counts it.
 */
import type { SecuritySignalInput, FirewallActionContribution, SignalLane } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { CascadeDecision, ProposedAction } from './cascade';
import { ACTIONS_TABLE } from '../store/ai_firewall.store';
import { effectiveActionMode, type FirewallActionPolicy } from '../ai_firewall.settings-policy';

export const CASCADE_DECISION_KIND = 'ai_firewall.cascade_decision';
export const FLUSH_MS = 5_000;
export const TALLY_MAX_ACTORS = 2_000;
export const SIGNALS_PER_FLUSH = 200;
export const REFERENCES_MAX = 5;
export const PROPOSALS_MAX = 500;
export const PROPOSAL_DEDUPE_MS = 10 * 60_000;
/** The reason code of a cascade proposal (dictionary `ai_firewall.reason.cascade_terminate`). */
export const CASCADE_PROPOSAL_REASON = 'cascade.terminate';

/**
 * The registered action each proposal of the cascade is run through (05.1a): ending the session by user_session; excluding the person's
 * device by user_security (the trusted devices of the account, a platform action). The request path proposes `exclude_device` only for a
 * signed-in person (IoT devices reach exclusion through their gateway's verdicts, 08).
 */
export const PROPOSAL_ACTIONS: Readonly<Record<ProposedAction, { actionId: string; actorKind: 'session' | 'user' }>> = {
  end_session: { actionId: 'user_session.end_session', actorKind: 'session' },
  exclude_device: { actionId: 'user_security.revoke_trusted_devices', actorKind: 'user' },
};

export type DecisionMode = 'enforced' | 'shadow' | 'alerts_only' | 'off';
export const DECISION_MODES: readonly DecisionMode[] = ['enforced', 'shadow', 'alerts_only', 'off'];
export const DECISION_VERDICTS = ['allow', 'challenge', 'block'] as const;
export const DECISION_STAGES = ['none', 'stage1', 'stage2'] as const;
/** Why a request was allowed without a decision (counted, FWA-7). */
export const SKIP_REASONS = [
  'no_actor', 'features_pending', 'no_windows', 'no_thresholds', 'no_model', 'over_budget', 'breaker_open', 'step_up_cleared', 'challenge_exempt', 'error',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface DecisionRecord {
  tenantId: string | null;
  /** The actor the decision is about: the signed-in person, else the address. */
  actor: { kind: 'user' | 'ip'; id: string };
  sessionId: string | null;
  lane: SignalLane;
  decision: CascadeDecision;
  /** What happened to the request (after the challenge kind and the exemptions): what the limiter was told. */
  applied: 'allow' | 'step_up' | 'delay' | 'block';
  mode: DecisionMode;
  reference: string | null;
  hovering: ReadonlyArray<'suspicion' | 'challenge' | 'block'>;
  /** An audit-sample request (stage 1 called it normal) that stage 2 would have challenged: a miss of the cascade, measured. */
  auditMiss: boolean;
  atMs: number;
}

interface ActorTally {
  tenantId: string | null;
  actor: { kind: 'user' | 'ip'; id: string };
  lane: SignalLane;
  decisions: number;
  challenges: number;
  blocks: number;
  enforced: number;
  shadow: number;
  auditMisses: number;
  attackClass: string | null;
  attackScore: number;
  behaviourScore: number;
  references: string[];
  hovering: Set<string>;
  firstAt: number;
}

interface PendingProposal {
  tenantId: string | null;
  action: ProposedAction;
  actorId: string;
  lane: SignalLane;
  atMs: number;
}

export interface RecorderStats {
  decisions: Record<DecisionMode, Record<(typeof DECISION_VERDICTS)[number], number>>;
  applied: Record<DecisionRecord['applied'], number>;
  stages: Record<(typeof DECISION_STAGES)[number], number>;
  skipped: Record<SkipReason, number>;
  audit: { scored: number; misses: number };
  hovering: number;
  signals: { emitted: number; capped: number; actorCap: number };
  proposals: { queued: number; deduped: number; dropped: number; written: number; failed: number; notRegistered: number };
}

const zero = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export const freshRecorderStats = (): RecorderStats => ({
  decisions: Object.fromEntries(DECISION_MODES.map((m) => [m, zero(DECISION_VERDICTS)])) as RecorderStats['decisions'],
  applied: { allow: 0, step_up: 0, delay: 0, block: 0 },
  stages: zero(DECISION_STAGES),
  skipped: zero(SKIP_REASONS),
  audit: { scored: 0, misses: 0 },
  hovering: 0,
  signals: { emitted: 0, capped: 0, actorCap: 0 },
  proposals: { queued: 0, deduped: 0, dropped: 0, written: 0, failed: 0, notRegistered: 0 },
});

/** The signal of one actor's tally (counts and codes only). Pure. */
export function cascadeDecisionSignal(t: ActorTally, atMs: number): SecuritySignalInput {
  return {
    at: new Date(atMs),
    tenantId: t.actor.kind === 'ip' ? null : t.tenantId,
    lane: t.lane,
    kind: CASCADE_DECISION_KIND,
    actor: { kind: t.actor.kind, id: t.actor.id },
    outcome: t.enforced > 0 && (t.blocks > 0 || t.challenges > 0) ? 'deny' : 'info',
    severity: t.blocks > 0 ? 'high' : 'medium',
    attrs: {
      decisions: t.decisions,
      challenges: t.challenges,
      blocks: t.blocks,
      enforced: t.enforced,
      shadow: t.shadow,
      auditMisses: t.auditMisses,
      attackClass: t.attackClass,
      attackScore: Math.round(t.attackScore * 1000) / 10,
      behaviourScore: Math.round(t.behaviourScore * 1000) / 10,
      references: t.references.length ? t.references.join(',') : null,
      hovering: t.hovering.size ? [...t.hovering].sort().join(',') : null,
    },
    source: 'ai_firewall',
  };
}

export interface ProposalDeps {
  /** The registered actions (`ai_firewall:action`), by id. */
  actions: () => Promise<ReadonlyMap<string, FirewallActionContribution>>;
  /** The tenant's (null: the platform's) kill switches and modes for the ids. */
  policy: (tenantId: string | null, actionIds: readonly string[]) => Promise<FirewallActionPolicy>;
  /** Runs `fn` in the tenant's transaction (RLS applies). */
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
}

export interface RecorderOptions {
  emit?: (signal: SecuritySignalInput) => boolean;
  proposals?: ProposalDeps | null;
  now?: () => number;
  warn?: (text: string) => void;
}

/** The INSERT of one proposal row (no incident: the cascade proposed it on one request). */
export function proposalInsert(row: {
  tenantId: string; actionId: string; rung: string; lane: string; actorKind: string; actorId: string; mode: string; ttlSeconds: number; proposedAt: string;
}): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO "${ACTIONS_TABLE}" ("tenantId", "incidentId", "actionId", "rung", "lane", "actorKind", "actorId", "status", "mode", "reason", "ttlSeconds", "proposedAt")
          VALUES ($1, NULL, $2, $3, $4, $5, $6, 'proposed', $7, $8, $9, $10::timestamptz)`,
    params: [row.tenantId, row.actionId, row.rung, row.lane, row.actorKind, row.actorId, row.mode, CASCADE_PROPOSAL_REASON, row.ttlSeconds, row.proposedAt],
  };
}

export class CascadeRecorder {
  readonly stats: RecorderStats = freshRecorderStats();
  private tallies = new Map<string, ActorTally>();
  private proposals: PendingProposal[] = [];
  private readonly proposedAt = new Map<string, number>();
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWarn = Number.NEGATIVE_INFINITY;

  constructor(private readonly o: RecorderOptions = {}) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private warn(text: string): void {
    const now = this.now();
    if (now - this.lastWarn < 60_000) return;
    this.lastWarn = now;
    this.o.warn?.(`request cascade: ${text}`);
  }

  /** A request allowed without a decision (synchronous). */
  skip(reason: SkipReason): void {
    this.stats.skipped[reason] += 1;
  }

  /** One decision (synchronous; never throws). */
  note(r: DecisionRecord): void {
    try {
      const d = r.decision;
      this.stats.decisions[r.mode][d.verdict] += 1;
      this.stats.applied[r.applied] += 1;
      this.stats.stages[d.stage] += 1;
      if (d.audit) {
        this.stats.audit.scored += 1;
        // What stage 2 alone would have done with a request stage 1 called normal: a miss when it reaches the challenge threshold.
        if (r.auditMiss) this.stats.audit.misses += 1;
      }
      if (r.hovering.length) this.stats.hovering += 1;
      const interesting = d.verdict !== 'allow' || r.hovering.length > 0 || r.auditMiss;
      if (interesting) this.tally(r);
      if (d.proposedActions.length > 0) this.propose(r);
    } catch {
      // bookkeeping never changes the answer
    }
  }

  private tally(r: DecisionRecord): void {
    const key = `${r.actor.kind === 'ip' ? '-' : r.tenantId ?? '-'}|${r.actor.kind}|${r.actor.id}`;
    let t = this.tallies.get(key);
    if (!t) {
      if (this.tallies.size >= TALLY_MAX_ACTORS) { this.stats.signals.actorCap += 1; return; }
      t = {
        tenantId: r.tenantId, actor: { ...r.actor }, lane: r.lane, decisions: 0, challenges: 0, blocks: 0, enforced: 0, shadow: 0,
        auditMisses: 0, attackClass: null, attackScore: 0, behaviourScore: 0, references: [], hovering: new Set(), firstAt: r.atMs,
      };
      this.tallies.set(key, t);
    }
    const d = r.decision;
    t.decisions += 1;
    if (d.verdict === 'challenge') t.challenges += 1;
    if (d.verdict === 'block') t.blocks += 1;
    if (r.mode === 'enforced' && r.applied !== 'allow') t.enforced += 1;
    if (r.mode === 'shadow') t.shadow += 1;
    if (r.auditMiss) t.auditMisses += 1;
    const score = d.attackScore ?? d.audit?.attackScore ?? 0;
    if (score > t.attackScore) { t.attackScore = score; t.attackClass = d.attackClass ?? d.audit?.attackClass ?? null; }
    if ((d.behaviourScore ?? 0) > t.behaviourScore) t.behaviourScore = d.behaviourScore ?? 0;
    if (r.reference && t.references.length < REFERENCES_MAX) t.references.push(r.reference);
    for (const h of r.hovering) t.hovering.add(h);
  }

  private propose(r: DecisionRecord): void {
    for (const action of r.decision.proposedActions) {
      const target = PROPOSAL_ACTIONS[action];
      const actorId = target.actorKind === 'session' ? r.sessionId : r.actor.kind === 'user' ? r.actor.id : null;
      if (!actorId) continue;
      const key = `${r.tenantId ?? '-'}|${target.actionId}|${actorId}`;
      const last = this.proposedAt.get(key);
      if (last !== undefined && r.atMs - last < PROPOSAL_DEDUPE_MS) { this.stats.proposals.deduped += 1; continue; }
      if (this.proposals.length >= PROPOSALS_MAX) { this.stats.proposals.dropped += 1; continue; }
      if (this.proposedAt.size >= TALLY_MAX_ACTORS * 5) this.proposedAt.clear();
      this.proposedAt.set(key, r.atMs);
      this.proposals.push({ tenantId: r.tenantId, action, actorId, lane: r.lane, atMs: r.atMs });
      this.stats.proposals.queued += 1;
    }
  }

  /** What is tallied, as signals; the tally starts empty again (the tests read it). */
  drainSignals(): SecuritySignalInput[] {
    const at = this.now();
    const out: SecuritySignalInput[] = [];
    for (const t of this.tallies.values()) {
      if (out.length >= SIGNALS_PER_FLUSH) { this.stats.signals.capped += 1; continue; }
      out.push(cascadeDecisionSignal(t, at));
    }
    this.tallies = new Map();
    return out;
  }

  /** The waiting proposals; the queue starts empty again. */
  drainProposals(): PendingProposal[] {
    const out = this.proposals;
    this.proposals = [];
    return out;
  }

  private async writeProposals(batch: PendingProposal[]): Promise<void> {
    const deps = this.o.proposals;
    if (!deps || batch.length === 0) return;
    let actions: ReadonlyMap<string, FirewallActionContribution>;
    try {
      actions = await deps.actions();
    } catch {
      this.stats.proposals.failed += batch.length;
      return;
    }
    for (const p of batch) {
      const target = PROPOSAL_ACTIONS[p.action];
      const action = actions.get(target.actionId);
      if (!action) { this.stats.proposals.notRegistered += 1; continue; }
      try {
        // A platform action (account-wide) is the platform's run: its row and its mode are the root tenant's.
        const runTenant = action.scope === 'platform' ? null : p.tenantId;
        const policy = await deps.policy(runTenant, [action.id]);
        const mode = effectiveActionMode(policy, action);
        const tenantId = runTenant ?? ROOT_TENANT_ID;
        const stmt = proposalInsert({
          tenantId, actionId: action.id, rung: action.rung, lane: p.lane === 'unknown' ? 'human-web' : p.lane, actorKind: target.actorKind,
          actorId: p.actorId, mode, ttlSeconds: Math.max(1, Math.round(action.ttl.defaultMs / 1000)), proposedAt: new Date(p.atMs).toISOString(),
        });
        await deps.inTenant(tenantId, (db) => db.query(stmt.sql, stmt.params));
        this.stats.proposals.written += 1;
      } catch (e) {
        this.stats.proposals.failed += 1;
        this.warn(`a proposal could not be written: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** Sends the tallies and writes the proposals. One flush at a time; never rejects. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        const signals = this.drainSignals();
        for (const s of signals) {
          let ok = false;
          try { ok = this.o.emit ? this.o.emit(s) : false; } catch { ok = false; }
          if (ok) this.stats.signals.emitted += 1;
          else this.stats.signals.capped += 1;
        }
        await this.writeProposals(this.drainProposals());
      } catch (e) {
        this.warn(`a flush failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  start(intervalMs: number = FLUSH_MS): this {
    if (this.timer) return this;
    this.timer = setInterval(() => { void this.flush(); }, intervalMs);
    this.timer.unref?.();
    return this;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}
