/**
 * user_session's actions for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6, candidates of phase 55 00.6):
 * end one session, end every session of a person, and make the person choose a new password. Each calls the admin actuators of
 * `user_session.admin.service` with `actorId: null, source: 'firewall'`, so the audit rows say the firewall acted.
 *
 * Scope. A run for a tenant acts inside that tenant only: one session of the tenant, or the person's sessions minted for the tenant (as a
 * tenant administrator's sign-out does). A run for the platform (`tenantId` null) may end every session of the person. The forced password
 * change is account-wide, like the platform route that does it (`/api/users/{id}/must-change-password`), so only the platform runs it.
 *
 * Undo (FWA-4). An ended session cannot be restored (its tokens are gone): the person signs in again, so both session actions are
 * `reversible: false` and their undo says so; for that reason both are Suggest-only (`minimumMode: 'suggest'`, D55-9: a person approves
 * every run). The forced password change is lifted by its undo.
 *
 * The services are loaded on first run, never while the registry loads.
 */
import {
  FIREWALL_HUMAN_LANES,
  firewallStep,
  notReversible,
  outOfScope,
  undoText,
  type FirewallActionContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const admin = () => import('./user_session.admin.service');

export const END_SESSION: FirewallActionContribution = {
  id: 'user_session.end_session',
  rung: 'end_session',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['session'],
  // Nothing lapses: the TTL only bounds how long the run stays listed as live.
  ttl: { defaultMs: HOUR_MS, maxMs: HOUR_MS },
  // FWA-4, D55-9: an ended session cannot be restored, so a person approves every run.
  minimumMode: 'suggest',
  hourlyBudget: 50,
  evidence: { boundToActor: true, minSignals: 1 },
  reversible: false,
  execute: (ctx) => firewallStep(async () => {
    const s = await admin();
    const userSessionId = ctx.actor.id;
    const owner = await s.sessionOwnerOf(userSessionId);
    if (!owner || (ctx.tenantId !== null && owner.tenantId !== ctx.tenantId)) return { status: 'noop', reason: 'not_found' };
    await s.revokeUserSessionByAdmin(owner.userId, userSessionId, { actorId: null, source: 'firewall', reason: ctx.reason });
    return { status: 'executed', undoData: { userSessionId, userId: owner.userId } };
  }),
  undo: notReversible('session_not_restorable'),
};

export const END_ALL_SESSIONS: FirewallActionContribution = {
  id: 'user_session.end_all_sessions',
  rung: 'end_all_sessions',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: HOUR_MS, maxMs: HOUR_MS },
  // FWA-4, D55-9: ended sessions cannot be restored, so a person approves every run.
  minimumMode: 'suggest',
  hourlyBudget: 20,
  // FWA-5 / FWA-13: the person's own session or credential, never failed sign-ins anyone can produce for an address.
  evidence: { boundToActor: true, minSignals: 1 },
  reversible: false,
  execute: (ctx) => firewallStep(async () => {
    const userId = ctx.actor.id;
    const { count } = await (await admin()).revokeUserSessionsByAdmin(userId, {
      actorId: null, source: 'firewall', reason: ctx.reason, ...(ctx.tenantId !== null ? { tenantId: ctx.tenantId } : {}),
    });
    if (count === 0) return { status: 'noop', reason: 'no_sessions' };
    return { status: 'executed', undoData: { userId, count, scope: ctx.tenantId === null ? 'all' : 'tenant' } };
  }),
  undo: notReversible('session_not_restorable'),
};

export const FORCE_PASSWORD_CHANGE: FirewallActionContribution = {
  id: 'user_session.force_password_change',
  // Above "end all sessions" (00.6): every live session is held at the change-password step, and the next sign-in too.
  rung: 'lock',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: 7 * DAY_MS, maxMs: 30 * DAY_MS },
  minimumMode: 'auto',
  defaultMode: 'suggest',
  hourlyBudget: 10,
  // Only as the platform (account- or installation-wide): a tenant's run is refused (outOfScope); its mode is the root tenant's.
  scope: 'platform',
  evidence: { boundToActor: true, minSignals: 1 },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId !== null) return outOfScope('platform_only');
    const userId = ctx.actor.id;
    const { getDataSource } = await import('@kuraykaraaslan-labs/db');
    const { User } = await import('@kuraykaraaslan-labs/user/server/entities/user.entity');
    const user = await (await getDataSource()).getRepository(User).findOne({ where: { userId }, select: { userId: true, password: true } });
    if (!user) return { status: 'noop', reason: 'not_found' };
    // A shadow user of a Fleet ID node signs in without a local password: it has nothing to change (the route answers 409 the same way).
    if (!user.password) return { status: 'refused', reason: 'no_local_password' };
    const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
    if ((await UserSecurityService.getByUserId(userId)).mustChangePassword === true) return { status: 'noop', reason: 'already_required' };
    await UserSecurityService.setMustChangePassword(userId, true);
    const sessionsFlagged = await (await admin()).flagPasswordChangeRequired(userId);
    await audit('auth.password_change_forced', userId, { sessionsFlagged, reason: ctx.reason, source: 'firewall' });
    return { status: 'executed', undoData: { userId, sessionsFlagged } };
  }),
  undo: (ctx) => firewallStep(async () => {
    const userId = undoText(ctx.undoData, 'userId');
    if (!userId) return { status: 'noop', reason: 'no_undo_data' };
    const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
    const wasForced = (await UserSecurityService.getByUserId(userId)).mustChangePassword === true;
    // The person already chose a new password (which cleared both flags): nothing is left to lift.
    if (!wasForced) return { status: 'noop', reason: 'already_changed' };
    await UserSecurityService.setMustChangePassword(userId, false);
    const { default: UserSessionCrudService } = await import('./user_session.crud.service');
    await UserSessionCrudService.clearPasswordChangeRequired(userId);
    await audit('auth.password_change_unforced', userId, { wasForced, reason: ctx.why, source: 'firewall' });
    return { status: 'executed' };
  }),
};

/**
 * The rows the platform route writes for an administrator, written here for the firewall (no acting person). Best effort, like every
 * actuator's own row: the change already holds, and the responder records the run in its own table either way (05).
 */
async function audit(action: string, userId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log({ tenantId: null, actorId: null, actorType: 'SYSTEM', action, resourceType: 'user', resourceId: userId, metadata });
  } catch {
    // the change holds; a missing row is the responder's to notice
  }
}

const ACTIONS: FirewallActionContribution[] = [END_SESSION, END_ALL_SESSIONS, FORCE_PASSWORD_CHANGE];

export default ACTIONS;
