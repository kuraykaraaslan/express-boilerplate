import 'reflect-metadata';
import { IsNull, In } from 'typeorm';
import { compactWhere, containsText, dayRange, inList, toOrder, type ListSort } from '@kuraykaraaslan-labs/common/server/common.list-query';
import type { FindOptionsWhere } from 'typeorm';
import { getDataSource, withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { Tenant as TenantEntity } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { TenantMember as TenantMemberEntity } from './entities/tenant_member.entity';
import { SafeTenantMember, SafeTenantMemberSchema } from './tenant_member.types';
import { SafeUserSchema } from '@kuraykaraaslan-labs/user/server/user.types';
import { MEMBER_SORTABLE, type GetTenantMembersInput, type GetTenantMemberInput } from './tenant_member.dto';
import { TenantMemberRoleEnum, TenantMemberStatusEnum } from './tenant_member.enums';
import TenantMemberMessages from './tenant_member.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

export async function getByTenantId({ tenantId, page, pageSize, search, memberRole, memberStatus, memberRoles, memberStatuses, createdFrom, createdTo, sort }: GetTenantMembersInput): Promise<{ members: SafeTenantMember[]; total: number }> {
  const roles = memberRoles?.length ? memberRoles : memberRole ? [memberRole] : [];
  const statuses = memberStatuses?.length ? memberStatuses : memberStatus ? [memberStatus] : [];
  const whereBase: Record<string, unknown> = compactWhere({
    tenantId,
    deletedAt: IsNull(),
    // one value is a plain equality (as before), several an IN list
    memberRole: roles.length === 1 ? roles[0] : inList(roles),
    memberStatus: statuses.length === 1 ? statuses[0] : inList(statuses),
    createdAt: dayRange(createdFrom, createdTo),
  });

  if (search) {
    const sysDs = await getDataSource();
    const matchingUsers = await sysDs.getRepository(UserEntity).find({
      // phase 43: the wildcards of the search are escaped
      where: { email: containsText(search) },
      select: { userId: true },
    });
    const matchingIds = matchingUsers.map((u) => u.userId);
    if (!matchingIds.length) return { members: [], total: 0 };
    whereBase.userId = In(matchingIds);
  }

  // 1-based here (page 0 is the first page too), as the internal callers expect; the route turns its 0-based index into it
  const safePage = Math.max(1, page);
  // 05-tenant-member 1.3: a deterministic order (the id breaks ties, after any requested sort), or OFFSET paging repeats and drops rows.
  const [members, total] = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo.findAndCount({
    where: whereBase as FindOptionsWhere<TenantMemberEntity>, skip: (safePage - 1) * pageSize, take: pageSize,
    order: toOrder((sort as ListSort | undefined) ?? [{ field: 'createdAt', dir: 'desc' }], MEMBER_SORTABLE, { tenantMemberId: 'ASC' }) as never,
  }));

  const userIds = members.map((m) => m.userId);
  const sysDs = await getDataSource();
  const users = await sysDs.getRepository(UserEntity).find({ where: { userId: In(userIds) } });
  const userMap = Object.fromEntries(users.map((u) => [u.userId, u]));

  return {
    members: members.map((member) => ({
      ...SafeTenantMemberSchema.parse(member),
      user: userMap[member.userId] ? SafeUserSchema.parse(userMap[member.userId]) : undefined,
    })),
    total,
  };
}

/**
 * The user ids of the ACTIVE members holding the custom role `roleKey` (a `roleKeys` entry), at most `limit`. Tenant-scoped through
 * the tenant repository; used by automation's `action.notify` (`custom_role` recipients).
 */
export async function getActiveUserIdsByRoleKey(tenantId: string, roleKey: string, limit: number): Promise<string[]> {
  const rows = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo
    .createQueryBuilder('m')
    .select('m.userId', 'userId')
    .where('m.tenantId = :tenantId', { tenantId })
    .andWhere('m.deletedAt IS NULL')
    .andWhere("m.memberStatus = 'ACTIVE'")
    .andWhere('m.roleKeys @> :key::jsonb', { key: JSON.stringify([roleKey]) })
    .orderBy('m.createdAt', 'ASC')
    .limit(Math.max(1, limit))
    .getRawMany<{ userId: string }>());
  return rows.map((r) => r.userId);
}

export async function getById(tenantMemberId: string, tenantId: string): Promise<SafeTenantMember> {
  const member = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) =>
    repo.findOne({ where: { tenantMemberId, tenantId, deletedAt: IsNull() } }));
  if (!member) throw new AppError(TenantMemberMessages.MEMBER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  return SafeTenantMemberSchema.parse(member);
}

/**
 * Detail-page variant of {@link getById} that also hydrates the linked user
 * (email/name) from the system data source so the member detail view can show a
 * human identity instead of a bare userId. Returns `user: undefined` for
 * orphaned memberships whose user row no longer exists.
 */
export async function getByIdWithUser(tenantMemberId: string, tenantId: string): Promise<SafeTenantMember> {
  const member = await getById(tenantMemberId, tenantId);
  const sysDs = await getDataSource();
  const user = await sysDs.getRepository(UserEntity).findOne({ where: { userId: member.userId } });
  return { ...member, user: user ? SafeUserSchema.parse(user) : undefined };
}

export interface MemberBreakdownRow {
  key: string;
  count: number;
}

export interface MemberStats {
  total: number;
  byRole: MemberBreakdownRow[];
  byStatus: MemberBreakdownRow[];
}

/**
 * Members-by-role / members-by-status aggregation for the membership report.
 * All enum buckets are represented (zero-filled) so the report renders a stable
 * set of rows/columns regardless of the current membership mix.
 */
export async function getMemberStats(tenantId: string): Promise<MemberStats> {
  const members = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) =>
    repo.find({ where: { tenantId, deletedAt: IsNull() } }));

  const roleCounts = new Map<string, number>(TenantMemberRoleEnum.options.map((r) => [r, 0]));
  const statusCounts = new Map<string, number>(TenantMemberStatusEnum.options.map((s) => [s, 0]));

  for (const m of members) {
    roleCounts.set(m.memberRole, (roleCounts.get(m.memberRole) ?? 0) + 1);
    statusCounts.set(m.memberStatus, (statusCounts.get(m.memberStatus) ?? 0) + 1);
  }

  return {
    total: members.length,
    byRole: [...roleCounts.entries()].map(([key, count]) => ({ key, count })),
    byStatus: [...statusCounts.entries()].map(([key, count]) => ({ key, count })),
  };
}

export async function getByTenantAndUser({ tenantMemberId, tenantId, userId }: GetTenantMemberInput): Promise<SafeTenantMember | null> {
  if (tenantMemberId) {
    if (!tenantId) return null;
    const member = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) =>
      repo.findOne({ where: { tenantMemberId, tenantId, deletedAt: IsNull() } }));
    if (!member || member.userId !== userId) return null;
    return SafeTenantMemberSchema.parse(member);
  }
  if (!tenantId || !userId) return null;
  const member = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) =>
    repo.findOne({ where: { tenantId, userId, deletedAt: IsNull() } }));
  return member ? SafeTenantMemberSchema.parse(member) : null;
}

export async function getUserTenants(userId: string) {
  // Every tenant this user belongs to: the tenant is what is being listed, so
  // a deliberate cross-tenant read (memberships and the tenants they name).
  const { members, tenants } = await withSystemRLS(async (qr) => {
    const members = await qr.manager.getRepository(TenantMemberEntity).find({
      where: { userId, memberStatus: 'ACTIVE', deletedAt: IsNull() },
    });
    // Hydrate each membership with its tenant so the UI can show the tenant
    // name instead of falling back to the raw tenantId (uuid).
    const tenantIds = members.map((m) => m.tenantId);
    const tenants = tenantIds.length
      ? await qr.manager.getRepository(TenantEntity).find({ where: { tenantId: In(tenantIds) } })
      : [];
    return { members, tenants };
  });
  const tenantMap = Object.fromEntries(
    tenants.map((t) => [t.tenantId, { tenantId: t.tenantId, name: t.name, tenantStatus: t.tenantStatus }]),
  );

  return members.map((m) => ({
    ...SafeTenantMemberSchema.parse(m),
    tenant: tenantMap[m.tenantId],
  }));
}

/**
 * A label (the email) for each of these users who is a member of the tenant: "who made this" on a list the members
 * share (the dashboards hub, owner request 2026-10-22). A user who is not, or no longer, a member is left out, so a
 * list never names someone outside the tenant.
 */
export async function memberLabels(tenantId: string, userIds: Array<string | null | undefined>): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return {};
  const members = await withTenantRepositoryFor(tenantId, TenantMemberEntity, (repo) => repo.find({
    where: { tenantId, userId: In(ids), deletedAt: IsNull() } as FindOptionsWhere<TenantMemberEntity>,
    select: { userId: true },
  }));
  const memberIds = members.map((m) => m.userId);
  if (memberIds.length === 0) return {};
  const sysDs = await getDataSource();
  const users = await sysDs.getRepository(UserEntity).find({ where: { userId: In(memberIds) }, select: { userId: true, email: true } });
  return Object.fromEntries(users.filter((u) => !!u.email).map((u) => [u.userId, u.email]));
}
