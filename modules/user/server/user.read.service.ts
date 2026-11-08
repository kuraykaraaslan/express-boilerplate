import 'reflect-metadata';
import { ILike, type FindOptionsOrder, type FindOptionsWhere } from 'typeorm';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { User as UserEntity } from './entities/user.entity';
import { User, SafeUser, SafeUserSchema, UserSchema, type SafeUserWithRootMembership } from './user.types';
import UserMessages from './user.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { USER_CACHE_TTL, NEGATIVE_CACHE_TTL, NEG } from './user.helpers';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { compactWhere, containsText, dayRange, escapeLike, inList, toOrder, type ListSort } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { USER_SORTABLE } from './user.dto';
import type { UserRole, UserStatus } from './user.enums';

export async function getAll({ page, pageSize, search, userId, tenantId, phone, sort, userRole, userStatus, createdFrom, createdTo }: {
  page: number;
  pageSize: number;
  search?: string;
  userId?: string;
  tenantId?: string;
  phone?: string;
  /** Phase 43 (the platform directory): a whitelisted sort, newest first by default, and role / status / joined filters. */
  sort?: ListSort;
  userRole?: UserRole[];
  userStatus?: UserStatus[];
  createdFrom?: string;
  createdTo?: string;
}): Promise<{ users: SafeUser[]; total: number }> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);

  // Tenant-scoped search: join with tenant_members when tenantId provided
  if (tenantId) {
    const qb = ds.createQueryBuilder(UserEntity, 'u')
      .innerJoin('tenant_members', 'tm', 'tm."userId" = u."userId" AND tm."tenantId" = :tenantId', { tenantId })
      .skip(page * pageSize)
      .take(pageSize)
      // 06-user 1.5: a tie-breaker, so rows with the same createdAt keep their page.
      .orderBy('u."createdAt"', 'DESC')
      .addOrderBy('u."userId"', 'ASC');

    if (search) {
      qb.where('u.email ILIKE :search', { search: `%${search}%` });
    }
    if (phone) {
      qb.andWhere('u.phone ILIKE :phone', { phone: `%${phone}%` });
    }

    const [users, total] = await qb.getManyAndCount();
    return { users: users.map((u) => SafeUserSchema.parse(u)), total };
  }

  const baseWhere: Record<string, unknown> = compactWhere({
    userRole: inList(userRole),
    userStatus: inList(userStatus),
    createdAt: dayRange(createdFrom, createdTo),
  });
  if (userId) baseWhere.userId = userId;
  if (phone) baseWhere.phone = ILike(`%${phone}%`);

  let whereConditions: Record<string, unknown>[];
  if (search) {
    // escaped: a `%` or `_` in the box matched every address
    whereConditions = [{ ...baseWhere, email: containsText(search) }];
  } else {
    whereConditions = [baseWhere];
  }

  const [users, total] = await Promise.all([
    // 06-user 1.5 / phase 43: newest first unless sorted, with the id as tiebreak, or OFFSET paging repeats and drops rows.
    repo.find({ where: whereConditions as FindOptionsWhere<UserEntity>[], order: toOrder(sort ?? [{ field: 'createdAt', dir: 'desc' }], USER_SORTABLE, { userId: 'ASC' }) as FindOptionsOrder<UserEntity>, skip: page * pageSize, take: pageSize }),
    repo.count({ where: whereConditions as FindOptionsWhere<UserEntity>[] }),
  ]);

  return { users: users.map((u) => SafeUserSchema.parse(u)), total };
}

type RootJoinRow = { u_userId?: string; rootMemberRole?: string | null; rootMemberStatus?: string | null };

/**
 * The platform users list (GET /users) with each account's root-tenant membership role and status (06-user 2.1), so the UI can tell
 * a root OWNER (also a suspended one) from an ordinary account. One LEFT JOIN on the unique (tenantId, userId) row: one row per user,
 * no N+1. The same filters, sort (phase 43) and order as `getAll`'s platform path.
 */
export async function getAllWithRootMembership({ page, pageSize, search, userId, phone, sort, userRole, userStatus, createdFrom, createdTo }: {
  page: number;
  pageSize: number;
  search?: string;
  userId?: string;
  phone?: string;
  /** Phase 43: a whitelisted sort (USER_SORTABLE), newest first by default, and role / status / joined filters. */
  sort?: ListSort;
  userRole?: UserRole[];
  userStatus?: UserStatus[];
  createdFrom?: string;
  createdTo?: string;
}): Promise<{ users: SafeUserWithRootMembership[]; total: number }> {
  const ds = await getDataSource();
  const qb = ds.createQueryBuilder(UserEntity, 'u')
    .leftJoin(
      'tenant_members', 'rm',
      'rm."userId" = u."userId" AND rm."tenantId" = :rootTenantId AND rm."deletedAt" IS NULL',
      { rootTenantId: ROOT_TENANT_ID },
    )
    .addSelect('rm."memberRole"', 'rootMemberRole')
    .addSelect('rm."memberStatus"', 'rootMemberStatus');

  // 06-user 1.5 / phase 43: the whitelisted sort (column names come from USER_SORTABLE, never from the client), then the id as a
  // tiebreak, so OFFSET paging is deterministic.
  const sortable = USER_SORTABLE as Record<string, string>;
  const order = (sort?.length ? sort : [{ field: 'createdAt', dir: 'desc' as const }])
    .filter((s) => sortable[s.field])
    .map((s) => [`u."${sortable[s.field]}"`, s.dir === 'desc' ? 'DESC' : 'ASC'] as const);
  if (order.length === 0) order.push(['u."createdAt"', 'DESC']);
  qb.orderBy(order[0][0], order[0][1]);
  for (const [col, dir] of order.slice(1)) qb.addOrderBy(col, dir);
  if (!order.some(([col]) => col === 'u."userId"')) qb.addOrderBy('u."userId"', 'ASC');
  // offset/limit, not skip/take: the join is 1:1, so no DISTINCT paging query is needed.
  qb.offset(page * pageSize).limit(pageSize);

  if (userId) qb.andWhere('u."userId" = :userId', { userId });
  // escaped: a `%` or `_` in the box matched every address (Postgres LIKE escapes with a backslash by default)
  if (search) qb.andWhere('u.email ILIKE :search', { search: `%${escapeLike(search)}%` });
  if (phone) qb.andWhere('u.phone ILIKE :phone', { phone: `%${phone}%` });
  if (userRole?.length) qb.andWhere('u."userRole" IN (:...userRoles)', { userRoles: [...userRole] });
  if (userStatus?.length) qb.andWhere('u."userStatus" IN (:...userStatuses)', { userStatuses: [...userStatus] });
  // Whole days, UTC, as `dayRange`: `from` 00:00 inclusive up to the day after `to`, exclusive.
  if (createdFrom) qb.andWhere('u."createdAt" >= :createdFrom', { createdFrom: new Date(`${createdFrom}T00:00:00.000Z`) });
  if (createdTo) qb.andWhere('u."createdAt" < :createdBefore', { createdBefore: new Date(new Date(`${createdTo}T00:00:00.000Z`).getTime() + 86_400_000) });

  const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities<RootJoinRow>(), qb.getCount()]);
  const byId = new Map(raw.filter((r) => r.u_userId).map((r) => [r.u_userId!, r]));
  const users = entities.map((u) => {
    const safe = SafeUserSchema.parse(u);
    const r = byId.get(u.userId);
    // No joined row read back: leave the fields out, which the UI reads as "not known" (privileged, fail closed).
    return r ? { ...safe, rootMemberRole: r.rootMemberRole ?? null, rootMemberStatus: r.rootMemberStatus ?? null } : safe;
  });
  return { users, total };
}

export async function getById(userId: string): Promise<SafeUser> {
  const cacheKey = `user:id:${userId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try { return SafeUserSchema.parse(JSON.parse(cached)); } catch { await redis.del(cacheKey).catch(() => {}); }
  }

  return singleFlight(cacheKey, async () => {
    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { userId } });
    if (!user) throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const parsed = SafeUserSchema.parse(user);
    await redis.setex(cacheKey, jitter(USER_CACHE_TTL), JSON.stringify(parsed)).catch(() => {});
    return parsed;
  });
}

export async function getByEmail(email: string): Promise<User | null> {
  const normalized = email.toLowerCase();
  const cacheKey = `user:email:${normalized}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached === NEG) return null;
  if (cached) {
    try { return UserSchema.parse(JSON.parse(cached)); } catch { await redis.del(cacheKey).catch(() => {}); }
  }

  return singleFlight(cacheKey, async () => {
    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { email: normalized } });
    if (!user) {
      await redis.setex(cacheKey, jitter(NEGATIVE_CACHE_TTL), NEG).catch(() => {});
      return null;
    }

    const parsed = UserSchema.parse(user);
    await redis.setex(cacheKey, jitter(USER_CACHE_TTL), JSON.stringify(parsed)).catch(() => {});
    return parsed;
  });
}
