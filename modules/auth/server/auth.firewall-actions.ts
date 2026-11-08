/**
 * auth's actions for the AI firewall (`ai_firewall:action`, docs/phases/55-ai-firewall/01 §1.6, candidate of phase 55 00.6): ask one live
 * session to prove a second factor again. Registered by auth, not user_session, because the step-up is auth's (its dialog, its proof,
 * `stepUpAvailableFor`): a session whose person has no factor that can step up could only sign out, so the action is refused and the
 * responder (05) takes the next rung (end the session) instead.
 *
 * Phase 55 02.6 adds the sign-up protection (below): hold a new account until its e-mail is verified, ask a CAPTCHA before an address's
 * next sign-up, and a hard block of an address's sign-ups where the tenant opted in. The membership review is tenant_member's
 * (`tenant_member.signup_review`), the membership being its.
 *
 * Only the contract from common and auth's own code (plus user_session and user_security, which auth requires) are reached, and the services are loaded on
 * first run, never while the registry loads. The responder owns the mode, the budget and the evidence (05); this does the work and says
 * what happened.
 */
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import {
  FIREWALL_ADDRESS_LANES,
  FIREWALL_HUMAN_LANES,
  firewallStep,
  outOfScope,
  undoText,
  type FirewallActionContribution,
  type FirewallUndoData,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const sessions = () => import('@kuraykaraaslan-labs/user_session/server/user_session.admin.service');
const protection = () => import('./auth.signup-protection');
const security = async () => (await import('@kuraykaraaslan-labs/user_security/server/user_security.service')).default;
const holds = () => import('@kuraykaraaslan-labs/user_security/server/user_security.lock.service');

export const SESSION_STEP_UP: FirewallActionContribution = {
  id: 'auth.session_step_up',
  rung: 'step_up',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['session'],
  // The flag holds until the person proves a factor; the TTL is when the responder lifts it if they never do.
  ttl: { defaultMs: HOUR_MS, maxMs: 24 * HOUR_MS },
  minimumMode: 'auto',
  hourlyBudget: 50,
  // FWA-13: one tree model may reach a step-up on its own; the signals must still be the session's own.
  evidence: { boundToActor: true, minSignals: 1 },
  execute: (ctx) => firewallStep(async () => {
    const s = await sessions();
    const userSessionId = ctx.actor.id;
    const owner = await s.sessionOwnerOf(userSessionId);
    // Another tenant's session is not this run's to touch: as far as this tenant knows there is no such session.
    if (!owner || (ctx.tenantId !== null && owner.tenantId !== ctx.tenantId)) return { status: 'noop', reason: 'not_found' };
    const { stepUpAvailableFor } = await import('./auth.step-up.service');
    if (!(await stepUpAvailableFor(owner.userId, owner.tenantId ?? ROOT_TENANT_ID))) return { status: 'refused', reason: 'step_up_unavailable' };
    const r = await s.forceSessionStepUp(owner.userId, userSessionId, { actorId: null, source: 'firewall', reason: ctx.reason });
    // Asked already (by an administrator or an earlier run): nothing of this run to undo.
    if (r.alreadyRequired) return { status: 'noop', reason: 'already_required' };
    return { status: 'executed', undoData: { userSessionId, userId: owner.userId, at: r.at } };
  }),
  undo: (ctx) => firewallStep(async () => {
    const userSessionId = undoText(ctx.undoData, 'userSessionId');
    const userId = undoText(ctx.undoData, 'userId');
    if (!userSessionId || !userId) return { status: 'noop', reason: 'no_undo_data' };
    const r = await (await sessions()).clearSessionStepUp(userSessionId, { userId, actorId: null, source: 'firewall', cause: 'admin', reason: ctx.why });
    return r.wasRequired ? { status: 'executed' } : { status: 'noop', reason: 'not_required' };
  }),
};

/* ─────────────── Phase 55 02.6: sign-up protection (auth owns the sign-up and the verification) ─────────────── */

/**
 * Hold a NEW account until its e-mail is verified. Soft: the person lifts it alone by opening the verification link (the run mails a fresh
 * one first and the hold ends when that link does, D55-68; the verify page works without a session, auth-verify-email-verify.route.ts),
 * and every sign-in method answers "verify your e-mail" until then. Without a link to rest on (no address, the mail failed) the run is
 * refused (`no_verification_link`) and nothing is held. It is user_security's security lock with the sign-up marker (`signupHoldReason`, so every sign-in path refuses it,
 * the live sessions end, and the admin's unlock lifts it too), set without the lock mail. Account-wide, so the platform's (like the
 * security lock). Only an account younger than SIGNUP_WINDOW_MS whose address is not verified; never over a standing lock; a run that races
 * a verification releases its hold at once.
 */
export const SIGNUP_HOLD: FirewallActionContribution = {
  id: 'auth.signup_hold',
  rung: 'lock',
  lanes: FIREWALL_HUMAN_LANES,
  actorKinds: ['user'],
  ttl: { defaultMs: 3 * DAY_MS, maxMs: 30 * DAY_MS },
  minimumMode: 'auto',
  defaultMode: 'suggest',
  hourlyBudget: 50,
  scope: 'platform',
  // FWA-5: the account's own sign-up row (`auth.register`, written as the new account) is the evidence.
  evidence: { boundToActor: true, minSignals: 1, kinds: ['auth.register'] },
  execute: (ctx) => firewallStep(async () => {
    if (ctx.tenantId !== null) return outOfScope('platform_only');
    const userId = ctx.actor.id;
    const p = await protection();
    const account = await p.accountForSignupAction(userId);
    if (!account) return { status: 'noop', reason: 'not_found' };
    if (account.verified) return { status: 'noop', reason: 'already_verified' };
    if (!p.isNewAccount(account.createdAt)) return { status: 'refused', reason: 'not_new_account' };
    const svc = await security();
    if (await svc.getSecurityLock(userId)) return { status: 'noop', reason: 'already_locked' };
    // D55-68: the hold rests on a live link. A fresh verification mail goes out first (the register mail may never have arrived, or its
    // link may have run out: a link lasts the tenant's verification TTL, a day by default, and an account may be held up to 7 days after
    // its sign-up), and the hold ends when that link does, so the person can always lift it alone and is never left locked out by a dead
    // link. The mail carries the branding of the tenant the person signed up on (the evidence's sign-up row), the platform's for none.
    const signupTenant = ctx.evidence.find((s) => s.kind === 'auth.register')?.tenantId ?? null;
    const linkMs = await p.freshVerificationLinkMs(userId, account.email, signupTenant);
    if (linkMs < p.SIGNUP_HOLD_MIN_LINK_MS) return { status: 'refused', reason: 'no_verification_link' };
    const until = new Date(Date.now() + Math.min(ctx.ttlMs, linkMs));
    const { signupHoldReason } = await holds();
    const { lock } = await svc.lockAccount(userId, { until, reason: signupHoldReason(ctx.proposalId), actorId: null, source: 'firewall', notify: false });
    // The address was verified while the hold was being set (the verification's lift found nothing yet): release it at once.
    if ((await p.accountForSignupAction(userId))?.verified) {
      await svc.unlockAccount(userId, { actorId: null, source: 'firewall', reason: 'signup_hold: verified meanwhile', notify: false });
      return { status: 'noop', reason: 'already_verified' };
    }
    return { status: 'executed', undoData: { userId, lockedAt: lock.lockedAt.toISOString() }, expiresAt: until.toISOString() };
  }),
  undo: (ctx) => firewallStep(async () => {
    const userId = undoText(ctx.undoData, 'userId');
    const lockedAt = undoText(ctx.undoData, 'lockedAt');
    if (!userId || !lockedAt) return { status: 'noop', reason: 'no_undo_data' };
    const svc = await security();
    const lock = await svc.getSecurityLock(userId);
    if (!lock) return { status: 'noop', reason: 'not_held' };
    const { isSignupHold } = await holds();
    // Lifted by the verification and locked again since, by an administrator or another run: not this run's to lift.
    if (!isSignupHold(lock) || lock.lockedAt.toISOString() !== lockedAt) return { status: 'noop', reason: 'superseded' };
    await svc.unlockAccount(userId, { actorId: null, source: 'firewall', reason: `signup_hold undo: ${ctx.why}`, notify: false });
    return { status: 'executed' };
  }),
};

/** The undo data of an address mark: the address and the scope it was set for (null = the platform's, every tenant). */
const markUndoData = (address: string, tenantId: string | null): FirewallUndoData => ({ address, markTenant: tenantId });

/**
 * Ask a CAPTCHA from an address before its next sign-up (38 2.4 asks it from the fourth sign-up in 30 minutes; this from the first) for
 * the TTL. Only while a CAPTCHA provider is installed and configured (38 A-5): without one the run is refused (`no_captcha_provider`)
 * and nothing changes. On the lanes whose CAPTCHA column is on (38 L-4). A tenant's run asks it on the tenant's sign-up, a platform run
 * on every tenant's. Soft: a person passes the challenge and signs up.
 */
export const SIGNUP_CAPTCHA: FirewallActionContribution = {
  id: 'auth.signup_captcha',
  // A challenge before the next sign-up: it slows a bot, it refuses nobody who can pass it.
  rung: 'throttle',
  lanes: ['human-web', 'public-anon'],
  actorKinds: ['ip'],
  ttl: { defaultMs: 6 * HOUR_MS, maxMs: 7 * DAY_MS },
  minimumMode: 'auto',
  hourlyBudget: 100,
  evidence: { boundToActor: false, minSignals: 1 },
  execute: (ctx) => firewallStep(async () => {
    const address = ctx.actor.id;
    const { default: CaptchaService } = await import('./auth.captcha.service');
    if (!(await CaptchaService.providerReady())) return { status: 'refused', reason: 'no_captcha_provider' };
    const set = await (await protection()).markSignupAddress('captcha', ctx.tenantId, address, ctx.proposalId, ctx.ttlMs);
    if (!set) return { status: 'noop', reason: 'already_required' };
    return { status: 'executed', undoData: markUndoData(address, ctx.tenantId), expiresAt: new Date(Date.now() + ctx.ttlMs).toISOString() };
  }),
  undo: (ctx) => firewallStep(async () => {
    const address = undoText(ctx.undoData, 'address');
    if (!address) return { status: 'noop', reason: 'no_undo_data' };
    const lifted = await (await protection()).clearSignupAddressMark('captcha', undoText(ctx.undoData, 'markTenant'), address, ctx.proposalId);
    return lifted ? { status: 'executed' } : { status: 'noop', reason: 'not_required' };
  }),
};

/**
 * Refuse sign-ups from an address for the TTL (403 SIGNUP_BLOCKED): the HARD block, only where the tenant opted in
 * (`aiFirewallSignupHardBlock` on Settings -> AI firewall, off on install). Without the opt-in the run is refused
 * (`hard_block_not_enabled`), and switching the opt-in off ends the block's effect at once (the register route reads both). A platform run
 * needs the ROOT tenant's opt-in and still blocks only on the tenants that opted in. Never an account, never a sign-in: only new sign-ups.
 */
export const SIGNUP_BLOCK: FirewallActionContribution = {
  id: 'auth.signup_block',
  rung: 'ban',
  lanes: FIREWALL_ADDRESS_LANES,
  actorKinds: ['ip'],
  ttl: { defaultMs: 6 * HOUR_MS, maxMs: 7 * DAY_MS },
  minimumMode: 'auto',
  defaultMode: 'suggest',
  hourlyBudget: 20,
  evidence: { boundToActor: false, minSignals: 3 },
  execute: (ctx) => firewallStep(async () => {
    const address = ctx.actor.id;
    const p = await protection();
    if (!(await p.signupHardBlockAllowed(ctx.tenantId))) return { status: 'refused', reason: 'hard_block_not_enabled' };
    const set = await p.markSignupAddress('block', ctx.tenantId, address, ctx.proposalId, ctx.ttlMs);
    if (!set) return { status: 'noop', reason: 'already_blocked' };
    return { status: 'executed', undoData: markUndoData(address, ctx.tenantId), expiresAt: new Date(Date.now() + ctx.ttlMs).toISOString() };
  }),
  undo: (ctx) => firewallStep(async () => {
    const address = undoText(ctx.undoData, 'address');
    if (!address) return { status: 'noop', reason: 'no_undo_data' };
    const lifted = await (await protection()).clearSignupAddressMark('block', undoText(ctx.undoData, 'markTenant'), address, ctx.proposalId);
    return lifted ? { status: 'executed' } : { status: 'noop', reason: 'not_blocked' };
  }),
};

const ACTIONS: FirewallActionContribution[] = [SESSION_STEP_UP, SIGNUP_HOLD, SIGNUP_CAPTCHA, SIGNUP_BLOCK];

export default ACTIONS;
