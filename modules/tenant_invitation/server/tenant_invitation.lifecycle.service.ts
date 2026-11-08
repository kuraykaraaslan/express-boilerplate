import 'reflect-metadata';
import { LessThan, MoreThan } from 'typeorm';
import { getDataSource, withSystemRLS, withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { TenantInvitation as TenantInvitationEntity } from './entities/tenant_invitation.entity';
import { SafeTenantInvitation, SafeTenantInvitationSchema } from './tenant_invitation.types';
import { SendInvitationInput } from './tenant_invitation.dto';
import TenantInvitationMessages from './tenant_invitation.messages';
import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { sendInvitationDecisionEmail } from './tenant_invitation.notify';
import { noteInvitationAccepted, type InvitationAcceptedVia } from './tenant_invitation.firewall-emitters';
import {
  clearCache, hashToken, generateRawToken, resolveTtlMs, assertRoleAllowed, assertUsable,
  resolveInvitationRole, assertDualControl,
} from './tenant_invitation.helpers';

type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';

/**
 * Move one invitation out of PENDING, conditionally: of two concurrent
 * decisions (accept vs revoke, two accepts, a sweep) exactly one wins. A
 * decision that needs a live invitation also requires it to be unexpired.
 */
async function claim(tenantId: string, invitationId: string, to: InvitationStatus, opts: { unexpired?: boolean } = {}): Promise<boolean> {
  const res = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) => repo.update(
    { tenantId, invitationId, status: 'PENDING', ...(opts.unexpired ? { expiresAt: MoreThan(new Date()) } : {}) },
    { status: to },
  ));
  return !!res.affected;
}

/** The invitation behind a raw token, in this tenant. */
async function byToken(tenantId: string, rawToken: string): Promise<TenantInvitationEntity> {
  const hashed = hashToken(rawToken);
  const invitation = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.findOne({ where: { token: hashed, tenantId } }));
  if (!invitation) throw new AppError(TenantInvitationMessages.INVITATION_INVALID_TOKEN, 404, ErrorCode.NOT_FOUND);
  return invitation;
}

/** Re-read after a lost claim so the caller gets the precise reason (accepted, revoked, expired…). */
async function explainLostClaim(tenantId: string, invitationId: string): Promise<never> {
  const now = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.findOne({ where: { tenantId, invitationId } }));
  if (now) assertUsable(now);
  throw new AppError(TenantInvitationMessages.INVITATION_INVALID_TOKEN, 409, ErrorCode.CONFLICT);
}

export async function send(tenantId: string, invitedByUserId: string, { email, memberRole: requestedRole }: SendInvitationInput, callerRole: TenantMemberRole): Promise<{ invitation: SafeTenantInvitation; rawToken: string }> {
  const normalizedEmail = email.toLowerCase();
  // 05-tenant-member 3.1: no named role → the tenant's defaultMemberRole, under the same rank and dual-control rules as a named one.
  const memberRole = await resolveInvitationRole(tenantId, requestedRole);
  await assertRoleAllowed(tenantId, memberRole, callerRole);
  await assertDualControl(tenantId, memberRole);

  const sysDs = await getDataSource();
  const existingUser = await sysDs.getRepository(UserEntity).findOne({ where: { email: normalizedEmail } });
  if (existingUser) {
    const alreadyMember = await TenantMemberService.getByTenantAndUser({ tenantId, userId: existingUser.userId, tenantMemberId: null });
    if (alreadyMember) throw new AppError(TenantInvitationMessages.INVITATION_ALREADY_MEMBER, 409, ErrorCode.CONFLICT);
  }

  const rawToken = generateRawToken();
  const hashedToken = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + (await resolveTtlMs(tenantId)));

  // One live invitation per (tenant, email): serialised, so two concurrent
  // sends cannot both find "no pending" and leave two usable invitations.
  const { saved, superseded } = await withTenantTransactionFor(tenantId, async (qr) => {
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tenant_invitation:${tenantId}:${normalizedEmail}`]);
    const repo = qr.manager.getRepository(TenantInvitationEntity);
    const superseded = await repo.find({ where: { tenantId, email: normalizedEmail, status: 'PENDING' } });
    if (superseded.length > 0) {
      await repo.update({ tenantId, email: normalizedEmail, status: 'PENDING' }, { status: 'REVOKED' });
    }
    const invitation = repo.create({ tenantId, email: normalizedEmail, invitedByUserId, memberRole, token: hashedToken, status: 'PENDING', expiresAt });
    return { saved: await repo.save(invitation), superseded };
  });
  await Promise.all(superseded.map((inv) => clearCache({ invitationId: inv.invitationId, token: inv.token })));

  await redis.del(`tenant_invitation:token:${hashedToken}`).catch(() => {});
  await WebhookService.dispatchEvent(tenantId, 'invitation.sent', {
    invitationId: saved.invitationId,
    email: saved.email,
    memberRole: saved.memberRole,
  });

  return { invitation: SafeTenantInvitationSchema.parse(saved), rawToken };
}

/** The invitation with this id, in this tenant. */
async function byId(tenantId: string, invitationId: string): Promise<TenantInvitationEntity> {
  const invitation = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.findOne({ where: { invitationId, tenantId } }));
  if (!invitation) throw new AppError(TenantInvitationMessages.INVITATION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  return invitation;
}

/**
 * Accepting WITHOUT the emailed token: the caller is authenticated and the
 * invitation is addressed to their email. That is only as good as the proof that
 * the account owns that address, so an unverified account is refused here — the
 * same line `autoAcceptForEmail` draws. Holding the emailed token (the path
 * above) is itself that proof, which is why it needs no such check.
 *
 * An invitation addressed to someone else answers 404, not a mismatch error:
 * the id is not a secret worth confirming to a stranger.
 */
async function byIdForCaller(
  tenantId: string,
  invitationId: string,
  caller: { email: string; emailVerifiedAt?: Date | null },
): Promise<TenantInvitationEntity> {
  if (!caller.emailVerifiedAt) {
    throw new AppError(TenantInvitationMessages.INVITATION_EMAIL_NOT_VERIFIED, 403, ErrorCode.FORBIDDEN);
  }
  const invitation = await byId(tenantId, invitationId);
  if (invitation.email !== caller.email.toLowerCase()) {
    throw new AppError(TenantInvitationMessages.INVITATION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  }
  return invitation;
}

async function acceptInvitation(tenantId: string, userId: string, invitation: TenantInvitationEntity, via: InvitationAcceptedVia): Promise<void> {
  assertUsable(invitation);

  // Claim first: a revoke racing this accept wins or loses cleanly, and two
  // accepts cannot both proceed. The claim also releases the seat the pending
  // invitation held, which the new membership then takes.
  if (!(await claim(tenantId, invitation.invitationId, 'ACCEPTED', { unexpired: true }))) {
    await explainLostClaim(tenantId, invitation.invitationId);
  }
  try {
    await TenantMemberService.create({ tenantId, userId, memberRole: invitation.memberRole as TenantMemberRole, memberStatus: 'ACTIVE' });
  } catch (err) {
    // No membership came of it: the invitation is still open.
    await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
      repo.update({ tenantId, invitationId: invitation.invitationId, status: 'ACCEPTED' }, { status: 'PENDING' }));
    throw err;
  }
  // Phase 55 02.6: the invitation path of a sign-up reaches the AI firewall (synchronous; never throws, never changes the accept).
  noteInvitationAccepted({ tenantId, userId, invitationId: invitation.invitationId, memberRole: invitation.memberRole, via });

  await clearCache({ invitationId: invitation.invitationId, token: invitation.token });
  await WebhookService.dispatchEvent(tenantId, 'invitation.accepted', {
    invitationId: invitation.invitationId,
    email: invitation.email,
    userId,
  });
  await sendInvitationDecisionEmail(tenantId, {
    invitationId: invitation.invitationId,
    invitedByUserId: invitation.invitedByUserId,
    inviteeEmail: invitation.email,
    decision: 'accepted',
  });
}

async function declineInvitation(tenantId: string, invitation: TenantInvitationEntity): Promise<void> {
  assertUsable(invitation);
  if (!(await claim(tenantId, invitation.invitationId, 'DECLINED', { unexpired: true }))) {
    await explainLostClaim(tenantId, invitation.invitationId);
  }

  await clearCache({ invitationId: invitation.invitationId, token: invitation.token });
  await WebhookService.dispatchEvent(tenantId, 'invitation.declined', {
    invitationId: invitation.invitationId,
    email: invitation.email,
  });
  await sendInvitationDecisionEmail(tenantId, {
    invitationId: invitation.invitationId,
    invitedByUserId: invitation.invitedByUserId,
    inviteeEmail: invitation.email,
    decision: 'declined',
  });
}

/**
 * May the holder of an invitation's token decide it as this account (`userId` null: the address match only)? The token was mailed to the invited address, so holding it is the proof
 * (an account that has not verified its address joins this way too); the account's address must still be the invited one, so a forwarded link
 * does not join somebody else's account. One exception (FID-09): a Fleet ID shadow user whose address the hub has NOT released to this node has
 * only a placeholder address (F10: no address without a membership, so a newcomer never has one). For it the token alone is the proof. A shadow
 * whose address was released is held to the same match as a local account.
 */
async function assertMayDecide(invitation: TenantInvitationEntity, userId: string | null, userEmail: string): Promise<void> {
  if (invitation.email === userEmail.toLowerCase()) return;
  if (userId) {
    const row = await (await getDataSource()).getRepository(UserEntity).findOne({ select: { userId: true, identitySub: true, emailReleased: true }, where: { userId } });
    if (row?.identitySub && row.emailReleased === false) return;
  }
  throw new AppError(TenantInvitationMessages.INVITATION_EMAIL_MISMATCH, 400, ErrorCode.VALIDATION_ERROR);
}

export async function accept(tenantId: string, userId: string, userEmail: string, rawToken: string): Promise<void> {
  const invitation = await byToken(tenantId, rawToken);
  await assertMayDecide(invitation, userId, userEmail);
  await acceptInvitation(tenantId, userId, invitation, 'token');
}

export async function decline(tenantId: string, userEmail: string, rawToken: string): Promise<void> {
  const invitation = await byToken(tenantId, rawToken);
  await assertMayDecide(invitation, null, userEmail);
  await declineInvitation(tenantId, invitation);
}

/** Accept by invitation id, as an authenticated account whose verified email the invitation is addressed to. */
export async function acceptById(
  tenantId: string,
  caller: { userId: string; email: string; emailVerifiedAt?: Date | null },
  invitationId: string,
): Promise<{ memberRole: string }> {
  const invitation = await byIdForCaller(tenantId, invitationId, caller);
  await acceptInvitation(tenantId, caller.userId, invitation, 'id');
  return { memberRole: invitation.memberRole };
}

/** Decline by invitation id; same caller rules as `acceptById`. */
export async function declineById(
  tenantId: string,
  caller: { email: string; emailVerifiedAt?: Date | null },
  invitationId: string,
): Promise<void> {
  await declineInvitation(tenantId, await byIdForCaller(tenantId, invitationId, caller));
}

async function loadPending(tenantId: string, invitationId: string, notPendingMessage: string): Promise<TenantInvitationEntity> {
  const invitation = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.findOne({ where: { invitationId, tenantId } }));
  if (!invitation) throw new AppError(TenantInvitationMessages.INVITATION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  if (invitation.status !== 'PENDING') throw new AppError(notPendingMessage, 409, ErrorCode.CONFLICT);
  return invitation;
}

export async function revoke(invitationId: string, tenantId: string): Promise<void> {
  const invitation = await loadPending(tenantId, invitationId, TenantInvitationMessages.INVITATION_ONLY_PENDING_CAN_BE_REVOKED);
  if (!(await claim(tenantId, invitationId, 'REVOKED'))) {
    throw new AppError(TenantInvitationMessages.INVITATION_ONLY_PENDING_CAN_BE_REVOKED, 409, ErrorCode.CONFLICT);
  }
  await clearCache({ invitationId, token: invitation.token });
  await WebhookService.dispatchEvent(tenantId, 'invitation.revoked', {
    invitationId,
    email: invitation.email,
  });
}

/**
 * Swap the token (and optionally the expiry) of a still-PENDING invitation.
 * Conditional and column-only: a whole-row save of the stale read used to
 * write `PENDING` back over an invitation accepted or revoked meanwhile —
 * reviving it with a fresh, usable token.
 */
async function rotateToken(tenantId: string, invitation: TenantInvitationEntity, expiresAt: Date | null, notPendingMessage: string): Promise<{ saved: TenantInvitationEntity; rawToken: string }> {
  const rawToken = generateRawToken();
  const patch: Partial<TenantInvitationEntity> = { token: hashToken(rawToken), ...(expiresAt ? { expiresAt } : {}) };
  const res = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.update({ tenantId, invitationId: invitation.invitationId, status: 'PENDING' }, patch));
  if (!res.affected) throw new AppError(notPendingMessage, 409, ErrorCode.CONFLICT);
  const oldToken = invitation.token;
  const saved = Object.assign(invitation, patch);
  await clearCache({ invitationId: invitation.invitationId, token: oldToken });
  return { saved, rawToken };
}

/**
 * Resend a PENDING invitation: rotates the token and extends the expiry
 * (per-tenant TTL) without revoking + re-creating, so existing tracking holds.
 * Returns the new raw token to email out.
 */
export async function resend(invitationId: string, tenantId: string): Promise<{ invitation: SafeTenantInvitation; rawToken: string }> {
  const invitation = await loadPending(tenantId, invitationId, TenantInvitationMessages.INVITATION_ONLY_PENDING_CAN_BE_RESENT);
  const expiresAt = new Date(Date.now() + (await resolveTtlMs(tenantId)));
  const { saved, rawToken } = await rotateToken(tenantId, invitation, expiresAt, TenantInvitationMessages.INVITATION_ONLY_PENDING_CAN_BE_RESENT);

  await WebhookService.dispatchEvent(tenantId, 'invitation.sent', {
    invitationId: saved.invitationId, email: saved.email, memberRole: saved.memberRole, resent: true,
  });
  return { invitation: SafeTenantInvitationSchema.parse(saved), rawToken };
}

/**
 * Remind a PENDING invitee about their still-open invitation by rotating the
 * token and returning the new raw token to email out. Only the token hash is
 * persisted, so a fresh raw token is the only way to build a usable accept link;
 * unlike `resend` this does NOT extend the expiry — a reminder nudges toward the
 * existing deadline rather than granting a fresh window.
 */
export async function remind(invitationId: string, tenantId: string): Promise<{ invitation: SafeTenantInvitation; rawToken: string }> {
  const invitation = await loadPending(tenantId, invitationId, TenantInvitationMessages.INVITATION_ONLY_PENDING_CAN_BE_REMINDED);
  assertUsable(invitation);
  const { saved, rawToken } = await rotateToken(tenantId, invitation, null, TenantInvitationMessages.INVITATION_ONLY_PENDING_CAN_BE_REMINDED);
  return { invitation: SafeTenantInvitationSchema.parse(saved), rawToken };
}

/**
 * Mark PENDING invitations past their expiry as EXPIRED. Meant for a
 * scheduled per-tenant sweep; `accept` already rejects expired tokens, so this
 * is state hygiene. Notifies each inviter (best-effort) that their invitation
 * lapsed — once, because each expiry is a conditional claim. Returns the number expired.
 */
export async function sweepExpired(tenantId: string): Promise<number> {
  const now = new Date();
  const expired = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.find({ where: { tenantId, status: 'PENDING', expiresAt: LessThan(now) } }));
  let count = 0;
  for (const i of expired) {
    const res = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
      repo.update({ tenantId, invitationId: i.invitationId, status: 'PENDING', expiresAt: LessThan(now) }, { status: 'EXPIRED' }));
    if (!res.affected) continue;
    count += 1;
    await clearCache({ invitationId: i.invitationId, token: i.token });
    await sendInvitationDecisionEmail(tenantId, {
      invitationId: i.invitationId,
      invitedByUserId: i.invitedByUserId,
      inviteeEmail: i.email,
      decision: 'expired',
    });
  }
  return count;
}

/**
 * Accept every open invitation addressed to this account's email — WITHOUT
 * the emailed token, so only for an address the account has PROVEN it owns.
 *
 * Registration calls this straight after signup, and SAML JIT after
 * provisioning from an IdP assertion; neither proves the address. Before this
 * check anyone who registered `victim@corp.com` first (or any tenant's IdP
 * asserting it) joined every tenant that had invited that address, with the
 * invited role. An unverified account still joins through the emailed link:
 * `accept` requires the token, and holding the token is the proof.
 */
export async function autoAcceptForEmail(userId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const now = new Date();

  const user = await (await getDataSource()).getRepository(UserEntity).findOne({ where: { userId } });
  if (!user || !user.emailVerifiedAt || user.email?.toLowerCase() !== normalizedEmail) return;

  // Invitations across every tenant for this address: a deliberate cross-tenant read.
  const pending = await withSystemRLS((qr) => qr.manager.getRepository(TenantInvitationEntity).find({
    where: { email: normalizedEmail, status: 'PENDING', expiresAt: MoreThan(now) },
  }));

  for (const invitation of pending) {
    try {
      const tenantId = invitation.tenantId;
      if (!(await claim(tenantId, invitation.invitationId, 'ACCEPTED', { unexpired: true }))) continue;
      const alreadyMember = await TenantMemberService.getByTenantAndUser({ tenantId, userId, tenantMemberId: null });
      if (!alreadyMember) {
        try {
          await TenantMemberService.create({ tenantId, userId, memberRole: invitation.memberRole as TenantMemberRole, memberStatus: 'ACTIVE' });
        } catch (err) {
          await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
            repo.update({ tenantId, invitationId: invitation.invitationId, status: 'ACCEPTED' }, { status: 'PENDING' }));
          throw err;
        }
        noteInvitationAccepted({ tenantId, userId, invitationId: invitation.invitationId, memberRole: invitation.memberRole, via: 'auto' });
      }
      await clearCache({ invitationId: invitation.invitationId, token: invitation.token });
    } catch { /* one tenant's failure must not stop the others */ }
  }
}
