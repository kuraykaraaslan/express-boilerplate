import 'reflect-metadata';
import { IsNull, In } from 'typeorm';
import { getDataSource, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Tenant as TenantEntity } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { TenantMember as TenantMemberEntity } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import redis from '@kuraykaraaslan-labs/redis';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { SafeTenant, SafeTenantSchema } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import { SafeTenantMember, SafeTenantMemberSchema } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import TenantAuthMessages from './tenant_session.messages';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';

const ROLE_HIERARCHY: TenantMemberRole[] = ['OWNER', 'ADMIN', 'USER'];

export function hasRequiredRole(memberRole: TenantMemberRole, requiredRole: TenantMemberRole): boolean {
  // A role outside the ladder (indexOf -1) satisfies no floor.
  const rank = ROLE_HIERARCHY.indexOf(memberRole);
  return rank !== -1 && rank <= ROLE_HIERARCHY.indexOf(requiredRole);
}

export async function getTenantById(tenantId: string): Promise<SafeTenant | null> {
  const tenant = await withTenantRepositoryFor(tenantId, TenantEntity, (repo) => repo.findOne({ where: { tenantId } }));
  return tenant ? SafeTenantSchema.parse(tenant) : null;
}

/**
 * The tenant's status as the database has it now: a cached membership must not outlive a suspension (docs/phases/02-fleet/05 section 7 stage 7).
 * One primary-key read of one column, null when there is no live tenant.
 */
export async function getTenantStatus(tenantId: string): Promise<string | null> {
  const tenant = await withTenantRepositoryFor(tenantId, TenantEntity, (repo) => repo.findOne({ where: { tenantId }, select: { tenantId: true, tenantStatus: true } }));
  return tenant?.tenantStatus ?? null;
}

export async function getTenantMembership(tenantId: string, userId: string): Promise<SafeTenantMember | null> {
  const member = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo.findOne({
    where: { tenantId, userId, deletedAt: IsNull() },
  }));
  return member ? SafeTenantMemberSchema.parse(member) : null;
}

export function validateTenantStatus(tenant: SafeTenant): void {
  if (tenant.tenantStatus === 'INACTIVE') throw new AppError(TenantAuthMessages.TENANT_INACTIVE, 403, ErrorCode.FORBIDDEN);
  if (tenant.tenantStatus === 'SUSPENDED') throw new AppError(TenantAuthMessages.TENANT_SUSPENDED, 403, ErrorCode.TENANT_SUSPENDED);
  // Fleet migration (docs/phases/02-fleet/05 section 6): a tenant being imported on the target is not routable and has no sessions until it is
  // verified, and the tombstone a cutover leaves on the source never serves again. MIGRATING still serves reads; its write fence is in the DB layer.
  if (tenant.tenantStatus === 'IMPORTING') throw new AppError(TenantAuthMessages.TENANT_IMPORTING, 403, ErrorCode.TENANT_INACTIVE);
  if (tenant.tenantStatus === 'RELOCATED') throw new AppError(TenantAuthMessages.TENANT_RELOCATED, 403, ErrorCode.TENANT_INACTIVE);
}

export function validateMemberStatus(tenantMember: SafeTenantMember): void {
  if (tenantMember.memberStatus === 'INACTIVE') throw new AppError(TenantAuthMessages.MEMBER_INACTIVE, 403, ErrorCode.FORBIDDEN);
  if (tenantMember.memberStatus === 'SUSPENDED') throw new AppError(TenantAuthMessages.MEMBER_SUSPENDED, 403, ErrorCode.FORBIDDEN);
  if (tenantMember.memberStatus === 'PENDING') throw new AppError(TenantAuthMessages.MEMBER_PENDING, 403, ErrorCode.FORBIDDEN);
}

/**
 * Batched, single-query tenant resolution for a user's memberships. Tenant
 * rows live in the canonical registry (system datasource), so we load all of
 * them with one `IN (...)` query instead of issuing one round-trip per
 * membership (the previous N+1 loop).
 *
 * Not moved to withTenantRepositoryFor (docs/phases/10-db Faz 3): this reads across
 * EVERY tenant a user belongs to in one query — there is no single tenantId to
 * scope it to. Permanent, by-design exception (same shape as
 * social_identity_merge.service.ts's mergeInto).
 */
export async function getUserTenants(userId: string): Promise<Array<{ tenant: SafeTenant; tenantMember: SafeTenantMember }>> {
  const ds = await getDataSource();
  const members = await ds.getRepository(TenantMemberEntity).find({
    where: { userId, memberStatus: 'ACTIVE', deletedAt: IsNull() },
  });
  if (members.length === 0) return [];

  const tenantIds = [...new Set(members.map((m) => m.tenantId))];
  const tenants = await ds.getRepository(TenantEntity).find({ where: { tenantId: In(tenantIds) } });
  const byId = new Map(tenants.map((t) => [t.tenantId, t]));

  const results: Array<{ tenant: SafeTenant; tenantMember: SafeTenantMember }> = [];
  for (const m of members) {
    const tenant = byId.get(m.tenantId);
    if (tenant && tenant.tenantStatus === 'ACTIVE') {
      results.push({ tenant: SafeTenantSchema.parse(tenant), tenantMember: SafeTenantMemberSchema.parse(m) });
    }
  }
  return results;
}

export async function clearTenantCache(userId: string, tenantId: string): Promise<void> {
  await redis.del(`tenant:member:${userId}:${tenantId}`);
}

/**
 * Invalidate every cached membership for a user. Uses a non-blocking `SCAN`
 * cursor + `UNLINK` instead of the O(N) blocking `KEYS` command so a power
 * user's cache flush can't stall the shared Redis instance.
 */
export async function clearUserTenantCaches(userId: string): Promise<void> {
  const pattern = `tenant:member:${userId}:*`;
  let cursor = '0';
  do {
    try {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await redis.unlink(...keys).catch(() => {});
    } catch {
      break; // fail-open: skip flush if Redis is unavailable
    }
  } while (cursor !== '0');
}
