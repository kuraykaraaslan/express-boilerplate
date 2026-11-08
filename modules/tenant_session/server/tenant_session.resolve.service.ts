import 'reflect-metadata';
import { IsNull } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantMember as TenantMemberEntity } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { SafeTenant } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import TenantAuthMessages from './tenant_session.messages';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import type { TenantSessionRequestContext } from './tenant_session.types';
import {
  hasRequiredRole, getTenantById, getTenantMembership, getTenantStatus,
  validateTenantStatus, validateMemberStatus,
} from './tenant_session.membership';
import {
  resolveSessionTtl, assertCircuitClosed, assertIpAllowed, assert2faSatisfied,
  checkGeoAnomaly, recordAuthFailure,
} from './tenant_session.policy';

export async function authenticateTenantMembership({ user, tenantId, requiredRole = 'USER', context, deferNotMember = false }: {
  user: SafeUser;
  tenantId: string;
  requiredRole?: TenantMemberRole;
  context?: TenantSessionRequestContext;
  /**
   * Throw `NOT_TENANT_MEMBER` WITHOUT recording it. For a caller that records the
   * denial itself via `recordNotMemberDenial` once it knows the answer is no (an
   * account-only session records nothing at all: refusing it is the expected
   * answer, not a probe, and counting it would lock the tenant's own staff out of login).
   */
  deferNotMember?: boolean;
}): Promise<{ tenant: SafeTenant; tenantMember: SafeTenantMember }> {
  // Per-tenant security gates that don't need the membership row run first so
  // a blocked IP / unsatisfied 2FA never touches the DB.
  if (context) {
    // S2: the breaker counts per caller (this user), with a tenant-wide backstop.
    await assertCircuitClosed(tenantId, { userId: user.userId, ip: context.ip });
    if (!context.ipListsHandled) await assertIpAllowed(tenantId, context.ip);
    await assert2faSatisfied(tenantId, context);
  }

  const cacheKey = `tenant:member:${user.userId}:${tenantId}`;
  const cached = await redis.get(cacheKey).catch(() => null);

  if (cached) {
    try {
      const cachedData = JSON.parse(cached);
      if (cachedData?.tenant && cachedData?.tenantMember) {
        // The membership AND the tenant's current status are re-read: the cached tenant carries the status of the moment it was cached, and a
        // suspension (or a migration's IMPORTING / RELOCATED) must take effect on the next request, not when the entry expires (05 section 7 stage 7).
        const [dbMember, status] = await Promise.all([
          withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo
            .findOne({ where: { tenantId, userId: user.userId, deletedAt: IsNull() }, select: { sessionVersion: true } })),
          getTenantStatus(tenantId),
        ]);
        // A status that moved since the entry was cached drops it like a stale session version: the full path below decides with fresh rows.
        if (!dbMember || dbMember.sessionVersion !== cachedData.tenantMember.sessionVersion || status !== cachedData.tenant.tenantStatus) {
          await redis.del(cacheKey).catch(() => {});
        } else {
          if (!hasRequiredRole(cachedData.tenantMember.memberRole, requiredRole)) {
            await auditDenial(tenantId, user.userId, requiredRole, context, 'insufficient_role');
            throw new AppError(TenantAuthMessages.INSUFFICIENT_TENANT_PERMISSIONS, 403, ErrorCode.FORBIDDEN);
          }
          await postResolveChecks(tenantId, user, cachedData.tenantMember, context);
          return { tenant: cachedData.tenant, tenantMember: cachedData.tenantMember };
        }
      }
    } catch (e: unknown) {
      if (e instanceof AppError) throw e;
      await redis.del(cacheKey).catch(() => {});
    }
  }

  // Keyed apart when deferring: concurrent callers share this flight's side
  // effects, and one that defers must not suppress the recording another relies on.
  return singleFlight(deferNotMember ? `${cacheKey}:defer` : cacheKey, async () => {
    // Membership before the tenant's status, and a missing tenant answered like a foreign one (tenant_session.04): a non-member
    // gets the same 403, breaker tick and denial row whether the id exists, is suspended or was never there, so the answer
    // does not tell a signed-in caller which tenant ids exist. Only a member learns the tenant's status.
    const tenant = await getTenantById(tenantId);
    const tenantMember = tenant ? await getTenantMembership(tenantId, user.userId) : null;
    if (!tenant || !tenantMember) {
      if (!deferNotMember) await recordNotMemberDenial(tenantId, user.userId, requiredRole, context);
      throw new AppError(TenantAuthMessages.USER_NOT_MEMBER_OF_TENANT, 403, ErrorCode.NOT_TENANT_MEMBER);
    }
    validateTenantStatus(tenant);
    validateMemberStatus(tenantMember);

    if (!hasRequiredRole(tenantMember.memberRole, requiredRole)) {
      await recordAuthFailure(tenantId, { userId: user.userId, ip: context?.ip });
      await auditDenial(tenantId, user.userId, requiredRole, context, 'insufficient_role');
      throw new AppError(TenantAuthMessages.INSUFFICIENT_TENANT_PERMISSIONS, 403, ErrorCode.FORBIDDEN);
    }

    const ttl = await resolveSessionTtl(tenantId);
    await redis.setex(cacheKey, jitter(ttl), JSON.stringify({ tenant, tenantMember })).catch(() => {});
    await postResolveChecks(tenantId, user, tenantMember, context);
    await auditSuccess(tenantId, user.userId, tenantMember.memberRole, context);
    return { tenant, tenantMember };
  });
}

/**
 * The side effects of "this user is not a member here": one tick on the tenant's
 * auth-failure breaker and a `tenant.session.denied` audit row. Exported for the
 * `deferNotMember` caller, which records only once it knows the answer is no.
 */
export async function recordNotMemberDenial(
  tenantId: string,
  userId: string,
  requiredRole: TenantMemberRole,
  context?: TenantSessionRequestContext,
): Promise<void> {
  await recordAuthFailure(tenantId, { userId, ip: context?.ip });
  await auditDenial(tenantId, userId, requiredRole, context, 'not_member');
}

/**
 * Post-resolution security checks (geo anomaly). The concurrent-session cap is not here (MS-36): `maxConcurrentSessions` is
 * enforced once, when a session is issued (user_session `enforceSessionCap`: the oldest sessions in the tenant end), not
 * per request with a second, different meaning (a 429 on the newest session).
 */
async function postResolveChecks(
  tenantId: string,
  user: SafeUser,
  _member: SafeTenantMember,
  context?: TenantSessionRequestContext,
): Promise<void> {
  if (!context) return;
  await checkGeoAnomaly(tenantId, user.userId, context);
}

async function auditDenial(
  tenantId: string, userId: string, requiredRole: TenantMemberRole,
  context: TenantSessionRequestContext | undefined, reason: string,
): Promise<void> {
  await AuditLogService.log({
    tenantId, actorId: userId, actorType: 'USER', action: 'tenant.session.denied',
    severity: 'medium', resourceType: 'tenant', resourceId: tenantId,
    ipAddress: context?.ip ?? null, userAgent: context?.userAgent ?? null,
    metadata: { reason, requiredRole },
  }).catch((e: unknown) => Logger.warn(`[tenant_session] audit denial failed: ${e instanceof Error ? e.message : e}`));
}

async function auditSuccess(
  tenantId: string, userId: string, role: TenantMemberRole,
  context: TenantSessionRequestContext | undefined,
): Promise<void> {
  await AuditLogService.log({
    tenantId, actorId: userId, actorType: 'USER', action: 'tenant.session.resolved',
    severity: 'low', resourceType: 'tenant', resourceId: tenantId,
    ipAddress: context?.ip ?? null, userAgent: context?.userAgent ?? null,
    metadata: { role },
  }).catch((e: unknown) => Logger.warn(`[tenant_session] audit success failed: ${e instanceof Error ? e.message : e}`));
}
