import 'reflect-metadata';
import { env } from '@kuraykaraaslan-labs/env';
import crypto from 'crypto';
import redis from '@kuraykaraaslan-labs/redis';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROLE_HIERARCHY, resolveDefaultRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.helpers';
import { isSensitiveRole, isDualControlEnabled } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.approval';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import TenantInvitationMessages from './tenant_invitation.messages';
import { sanitizeInvitationTtlMs } from './tenant_invitation.settings-policy';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

export const INVITATION_TTL_SECONDS = env.INVITATION_TTL_SECONDS ?? (60 * 60 * 24 * 7);
export const INVITATION_CACHE_TTL = env.TENANT_CACHE_TTL ?? (60 * 5);
export const NEGATIVE_CACHE_TTL = Math.min(60, INVITATION_CACHE_TTL);
export const NEG = '__not_found__';

export async function clearCache(invitation: { invitationId: string; token?: string }): Promise<void> {
  const ops: Promise<unknown>[] = [redis.del(`tenant_invitation:id:${invitation.invitationId}`)];
  if (invitation.token) ops.push(redis.del(`tenant_invitation:token:${invitation.token}`));
  await Promise.all(ops.map((p) => p.catch(() => {})));
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Per-tenant invitation TTL (`invitationTtlDays` setting, Invitations → Settings); falls back to env. Capped at the env
 * default: a tenant can shorten an invitation's life, never extend it (tenant_invitation.settings-policy.ts).
 */
export async function resolveTtlMs(tenantId: string): Promise<number> {
  const raw = await SettingService.getValue(tenantId, 'invitationTtlDays').catch(() => null);
  return sanitizeInvitationTtlMs(raw, INVITATION_TTL_SECONDS * 1000);
}

/**
 * A tenant can restrict which roles may be granted via invitation
 * (`invitationAllowedRoles`, CSV). OWNER can never be granted by invitation —
 * ownership transfer is an explicit, separate flow.
 *
 * `callerRole` is the inviter's own tenant_member role. A permission
 * (`tenant_invitation.invitations.invite`) can be granted to a non-ADMIN member
 * via a custom role group (auth_abac phase 6.2), so holding the permission is
 * not proof of the seniority to hand out ADMIN — the same "cannot assign a role
 * equal to or higher than your own" rule tenant_member enforces on role changes
 * (`ROLE_HIERARCHY`) applies here too.
 */
export async function assertRoleAllowed(tenantId: string, memberRole: string, callerRole: string): Promise<void> {
  if (memberRole === 'OWNER') {
    throw new AppError(TenantInvitationMessages.INVITATION_ROLE_NOT_ALLOWED, 422, ErrorCode.VALIDATION_ERROR);
  }
  const callerIdx = ROLE_HIERARCHY.indexOf(callerRole as (typeof ROLE_HIERARCHY)[number]);
  const targetIdx = ROLE_HIERARCHY.indexOf(memberRole as (typeof ROLE_HIERARCHY)[number]);
  if (targetIdx === -1 || callerIdx === -1 || targetIdx <= callerIdx) {
    throw new AppError(TenantInvitationMessages.INVITATION_ROLE_EXCEEDS_CALLER, 403, ErrorCode.FORBIDDEN);
  }
  const raw = await SettingService.getValue(tenantId, 'invitationAllowedRoles').catch(() => null);
  if (raw) {
    const allowed = raw.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(memberRole.toUpperCase())) {
      throw new AppError(TenantInvitationMessages.INVITATION_ROLE_NOT_ALLOWED, 422, ErrorCode.VALIDATION_ERROR);
    }
  }
}

/**
 * The role an invitation grants (05-tenant-member 3.1): the one the inviter named, or else the tenant's owner-only
 * `defaultMemberRole` (USER when unset). Either way it then goes through `assertRoleAllowed` and `assertDualControl`, so an
 * ADMIN default is refused to an ADMIN inviter exactly like a named ADMIN.
 */
export async function resolveInvitationRole(tenantId: string, memberRole: TenantMemberRole | undefined): Promise<TenantMemberRole> {
  return memberRole ?? resolveDefaultRole(tenantId);
}

/**
 * Dual control (`tenantMemberDualControl`, 05-tenant-member 3.1): POST /members holds an ADMIN/OWNER grant for a second
 * approver, and accepting an invitation creates the membership with no approval step, so while dual control is on (or
 * unreadable — it fails closed) an invitation cannot carry a sensitive role. The inviter invites as USER and promotes; the
 * promotion goes through the approval queue.
 */
export async function assertDualControl(tenantId: string, memberRole: string): Promise<void> {
  if (isSensitiveRole(memberRole) && await isDualControlEnabled(tenantId)) {
    throw new AppError(TenantInvitationMessages.INVITATION_ROLE_NEEDS_APPROVAL, 403, ErrorCode.FORBIDDEN);
  }
}

export function assertUsable(invitation: { status: string; expiresAt: Date }): void {
  if (invitation.status === 'ACCEPTED') throw new AppError(TenantInvitationMessages.INVITATION_ALREADY_ACCEPTED, 409, ErrorCode.CONFLICT);
  if (invitation.status === 'DECLINED') throw new AppError(TenantInvitationMessages.INVITATION_ALREADY_DECLINED, 409, ErrorCode.CONFLICT);
  if (invitation.status === 'REVOKED') throw new AppError(TenantInvitationMessages.INVITATION_REVOKED, 410, ErrorCode.VALIDATION_ERROR);
  if (invitation.status === 'EXPIRED' || invitation.expiresAt < new Date()) throw new AppError(TenantInvitationMessages.INVITATION_EXPIRED, 410, ErrorCode.VALIDATION_ERROR);
}
