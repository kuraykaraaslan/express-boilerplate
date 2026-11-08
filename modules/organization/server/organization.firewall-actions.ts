/**
 * organization's action for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6): take a person out of every team
 * of the workspace for a while (`removeMember` per team: the row is CLOSED, never deleted, the record-scope version moves in the same
 * transaction and the cached scopes are dropped). A team membership is what a TEAM record scope widens a person's reach with (they see
 * their teammates' records), so this is the narrow containment of a person who walks or exports their teams' records: their own records
 * and their workspace membership stay, nothing ends their sessions (that is user_session's; a full stop is tenant_member.suspend). A
 * membership is a person's: acted on on the human lanes, inside its tenant only.
 *
 * The undo reopens THE SAME rows (`reopenMember`, so assignment capacity and round-robin counters that hang off a `teamMemberId` carry
 * on), and only the rows this run closed, while each is exactly as the run left it (D55-222): the marker is the closed row's `updatedAt`
 * as the run's own removal saved it (`removeMember` answers the row it closed, so no second read can fail after the row is closed and
 * leave it out of the undo), which nothing else writes (a closed row is never written again; an administrator who adds the person back
 * makes a NEW row, which the undo then leaves alone, as it leaves a team that got another leader meanwhile). Add, never subtract
 * (FWA-2): a person in no team is a noop.
 *
 * At most MAX_TEAMS teams per run (the undo data is small, non-secret facts); a person in more is answered `executed` with reason
 * `capped` and `more: true` in the undo data, so the approver and the activity page see the containment was partial (the proposal id is
 * the idempotency key: the same proposal never picks up the rest). The service is loaded on first run.
 */
import {
  FIREWALL_HUMAN_LANES,
  firewallStep,
  outOfScope,
  undoText,
  type FirewallActionContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The most teams one run closes (a person in more is the administrator's to review). */
export const MAX_TEAMS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const teams = async () => (await import('./organization.team.service')).default;

/** One closed row of a run: its id and the marker (its `updatedAt` after the run's removal). */
interface ClosedRow { id: string; at: string }

function closedRowsOf(raw: string | null): ClosedRow[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const rows = v.filter((r): r is ClosedRow => !!r && typeof r === 'object' && typeof (r as ClosedRow).id === 'string' && typeof (r as ClosedRow).at === 'string');
    return rows.length === v.length ? rows : null;
  } catch {
    return null;
  }
}

export const REMOVE_FROM_TEAMS: FirewallActionContribution = {
  id: 'organization.remove_from_teams',
  // It takes away the person's reach into their teams' records: like a lock it rests on the person's own signals (FWA-5) and, run
  // automatically, needs two keys (FWA-13); the lighter choice beside tenant_member.suspend on the same rung.
  rung: 'lock',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: DAY_MS, maxMs: 7 * DAY_MS },
  minimumMode: 'auto',
  defaultMode: 'suggest',
  hourlyBudget: 10,
  // Only inside a tenant: a team is a tenant's; a run as the platform is refused (outOfScope).
  scope: 'tenant',
  evidence: { boundToActor: true, minSignals: 2 },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId === null) return outOfScope('tenant_only');
    const tenantId = ctx.tenantId;
    const userId = ctx.actor.id;
    if (!UUID.test(userId)) return { status: 'noop', reason: 'not_a_member' };
    const svc = await teams();
    const all = await svc.teamIdsForUser(tenantId, userId);
    if (!all.length) return { status: 'noop', reason: 'no_team' };
    const teamIds = all.slice(0, MAX_TEAMS);
    const more = all.length > teamIds.length;
    const closed: ClosedRow[] = [];
    let failure: unknown = null;
    for (const teamId of teamIds) {
      try {
        // the marker: the row as this run's removal saved it, answered by the same write (no other writer touches a closed row)
        const row = await svc.removeMember(tenantId, teamId, userId);
        if (row?.teamMemberId && row.updatedAt) closed.push({ id: row.teamMemberId, at: new Date(row.updatedAt).toISOString() });
        else failure ??= new Error('organization: a closed team row came back without its marker');
      } catch (error) {
        // removed meanwhile (an administrator's removal won): not this run's row. Any other failure leaves the rows already closed with
        // their undo (the run answers what it did); with none closed it is the run's answer.
        if ((error as { statusCode?: number } | null)?.statusCode !== 404) failure ??= error;
      }
    }
    if (!closed.length) {
      if (failure) throw failure;
      return { status: 'noop', reason: 'no_team' };
    }
    return {
      status: 'executed',
      ...(more ? { reason: 'capped' } : {}),
      undoData: { userId, rows: JSON.stringify(closed), ...(more ? { more: true } : {}) },
      expiresAt: new Date(Date.now() + ctx.ttlMs).toISOString(),
    };
  }),
  undo: (ctx) => firewallStep(async () => {
    const rows = closedRowsOf(undoText(ctx.undoData, 'rows'));
    if (!ctx.tenantId || !rows || !rows.length) return { status: 'noop', reason: 'no_undo_data' };
    const svc = await teams();
    let reopened = 0;
    for (const r of rows) if (await svc.reopenMember(ctx.tenantId, r.id, r.at)) reopened += 1;
    // Each row changed since the run (added back, another leader, the team deleted) is not this run's to reopen.
    return reopened > 0 ? { status: 'executed' } : { status: 'noop', reason: 'superseded' };
  }),
};

const ACTIONS: FirewallActionContribution[] = [REMOVE_FROM_TEAMS];

export default ACTIONS;
