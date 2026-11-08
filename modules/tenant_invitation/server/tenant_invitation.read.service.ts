import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import { withSystemRLS, withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { TenantInvitation as TenantInvitationEntity } from './entities/tenant_invitation.entity';
import { Tenant as TenantEntity } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { SafeTenantInvitation, SafeTenantInvitationSchema } from './tenant_invitation.types';
import { INVITATION_SORTABLE, type GetInvitationsInput } from './tenant_invitation.dto';
import { compactWhere, dayRange, inList, searchWhere, toOrder, type ListSort } from '@kuraykaraaslan-labs/common/server/common.list-query';
import TenantInvitationMessages from './tenant_invitation.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { INVITATION_CACHE_TTL, NEGATIVE_CACHE_TTL, NEG, hashToken, assertUsable } from './tenant_invitation.helpers';

export async function getByTenantId({ tenantId, page, pageSize, status, statuses, memberRoles, search, createdFrom, createdTo, expiresFrom, expiresTo, sort }: GetInvitationsInput): Promise<{ invitations: SafeTenantInvitation[]; total: number }> {
  const states = statuses?.length ? statuses : status ? [status] : [];
  const where = compactWhere({
    tenantId,
    // one value is a plain equality (as before), several an IN list
    status: states.length === 1 ? states[0] : inList(states),
    memberRole: inList(memberRoles),
    createdAt: dayRange(createdFrom, createdTo),
    expiresAt: dayRange(expiresFrom, expiresTo),
  });

  const safePage = Math.max(1, page);
  const [rows, total] = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.findAndCount({
      where: searchWhere(where, search, ['email']) as FindOptionsWhere<TenantInvitationEntity>,
      skip: (safePage - 1) * pageSize, take: pageSize,
      order: toOrder((sort as ListSort | undefined) ?? [{ field: 'createdAt', dir: 'desc' }], INVITATION_SORTABLE, { invitationId: 'ASC' }) as never,
    }));

  return { invitations: rows.map((r) => SafeTenantInvitationSchema.parse(r)), total };
}

export async function getById(invitationId: string, tenantId: string): Promise<SafeTenantInvitation> {
  const cacheKey = `tenant_invitation:id:${invitationId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const parsed = SafeTenantInvitationSchema.parse(JSON.parse(cached));
      if (parsed.tenantId !== tenantId) throw new AppError(TenantInvitationMessages.INVITATION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      return parsed;
    } catch (e) {
      if (e instanceof AppError) throw e;
      await redis.del(cacheKey).catch(() => {});
    }
  }

  return singleFlight(cacheKey, async () => {
    const invitation = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
      repo.findOne({ where: { invitationId, tenantId } }));
    if (!invitation) throw new AppError(TenantInvitationMessages.INVITATION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const parsed = SafeTenantInvitationSchema.parse(invitation);
    await redis.setex(cacheKey, jitter(INVITATION_CACHE_TTL), JSON.stringify(parsed)).catch(() => {});
    return parsed;
  });
}

export async function getByToken(rawToken: string): Promise<SafeTenantInvitation> {
  const hashed = hashToken(rawToken);
  const cacheKey = `tenant_invitation:token:${hashed}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached === NEG) throw new AppError(TenantInvitationMessages.INVITATION_INVALID_TOKEN, 404, ErrorCode.NOT_FOUND);
  if (cached) {
    try { return SafeTenantInvitationSchema.parse(JSON.parse(cached)); } catch { await redis.del(cacheKey).catch(() => {}); }
  }

  return singleFlight(cacheKey, async () => {
    // The token is what identifies the tenant: a deliberate cross-tenant lookup.
    const invitation = await withSystemRLS((qr) => qr.manager.getRepository(TenantInvitationEntity).findOne({ where: { token: hashed } }));
    if (!invitation) {
      await redis.setex(cacheKey, jitter(NEGATIVE_CACHE_TTL), NEG).catch(() => {});
      throw new AppError(TenantInvitationMessages.INVITATION_INVALID_TOKEN, 404, ErrorCode.NOT_FOUND);
    }

    const parsed = SafeTenantInvitationSchema.parse(invitation);
    await redis.setex(cacheKey, jitter(INVITATION_CACHE_TTL), JSON.stringify(parsed)).catch(() => {});
    return parsed;
  });
}

export async function preview(tenantId: string, rawToken: string): Promise<{ invitation: SafeTenantInvitation; tenant: { tenantId: string; name: string } }> {
  const hashed = hashToken(rawToken);
  const { invitation, tenant } = await withTenantTransactionFor(tenantId, async (qr) => ({
    invitation: await qr.manager.getRepository(TenantInvitationEntity).findOne({ where: { token: hashed, tenantId } }),
    tenant: await qr.manager.getRepository(TenantEntity).findOne({ where: { tenantId } }),
  }));
  if (!invitation) throw new AppError(TenantInvitationMessages.INVITATION_INVALID_TOKEN, 404, ErrorCode.NOT_FOUND);
  assertUsable(invitation);

  return {
    invitation: SafeTenantInvitationSchema.parse(invitation),
    tenant: { tenantId: tenantId, name: tenant?.name ?? '' },
  };
}

/**
 * The PENDING invitations one person sent in this tenant, oldest first, at most `limit` (phase 55: the AI firewall's
 * `tenant_invitation.revoke_sent`, which revokes what a person under suspicion handed out). The tenant filter and RLS keep another
 * tenant's rows out; a malformed user id is no sender.
 */
export async function pendingSentBy(tenantId: string, invitedByUserId: string, limit = 100): Promise<SafeTenantInvitation[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitedByUserId)) return [];
  const rows = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, (repo) =>
    repo.find({ where: { tenantId, invitedByUserId, status: 'PENDING' }, order: { createdAt: 'ASC', invitationId: 'ASC' }, take: Math.max(1, Math.min(limit, 500)) }));
  return rows.map((r) => SafeTenantInvitationSchema.parse(r));
}
