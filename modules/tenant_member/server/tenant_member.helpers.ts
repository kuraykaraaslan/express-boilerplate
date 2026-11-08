import 'reflect-metadata';
import { IsNull } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantMember as TenantMemberEntity } from './entities/tenant_member.entity';
import { SafeTenantMember, SafeTenantMemberSchema } from './tenant_member.types';
import type { TenantMemberRole } from './tenant_member.enums';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';

export const ROLE_HIERARCHY: TenantMemberRole[] = ['OWNER', 'ADMIN', 'USER'];

// The rank rule lives in the DB-free tenant_member.rank (05-tenant-member 2.1); re-exported so existing importers keep resolving it here.
export { ROLE_RANK, rankOf, mayActOn, assignableRoles } from './tenant_member.rank';

/** Resolve the tenant's `defaultMemberRole` setting (falls back to USER). */
export async function resolveDefaultRole(tenantId: string): Promise<TenantMemberRole> {
  const raw = await SettingService.getValue(tenantId, 'defaultMemberRole').catch(() => null);
  const role = (raw ?? '').toUpperCase();
  // GUEST is a permission-floor sentinel, never a stored member role — only
  // ADMIN/USER are valid defaults (OWNER is assigned explicitly, not by default).
  return (role === 'ADMIN' || role === 'USER') ? role as TenantMemberRole : 'USER';
}

export function hasRole(member: SafeTenantMember, requiredRole: TenantMemberRole): boolean {
  const memberIdx = ROLE_HIERARCHY.indexOf(member.memberRole);
  const requiredIdx = ROLE_HIERARCHY.indexOf(requiredRole);
  return memberIdx <= requiredIdx;
}

export async function checkPermission(tenantId: string, userId: string, requiredRole: TenantMemberRole): Promise<boolean> {
  const member = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo.findOne({
    where: { tenantId, userId, memberStatus: 'ACTIVE', deletedAt: IsNull() },
  }));
  if (!member) return false;
  return hasRole(SafeTenantMemberSchema.parse(member), requiredRole);
}
