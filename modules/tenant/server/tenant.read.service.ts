import 'reflect-metadata';
import { IsNull, Not, type FindOptionsWhere } from 'typeorm';
import { FLEET_TENANT_ID, isFleetTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import {
  noDropPending, openEntry, readGuarded, stampForWrite, stampOf, writeGuarded,
} from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import { tenantProfileKey, tenantProfileVersionKey } from './tenant.cache-drop';
import { Tenant as TenantEntity } from './entities/tenant.entity';
import { SafeTenant, SafeTenantSchema } from './tenant.types';
import { TENANT_SORTABLE, type GetTenantsInput } from './tenant.dto';
import { compactWhere, containsText, dayRange, inList, toOrder, type ListSort } from '@kuraykaraaslan-labs/common/server/common.list-query';
import TenantMessages from './tenant.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { TENANT_CACHE_TTL } from './tenant.helpers';

/**
 * JSON turns the tenant's Date columns into ISO strings and SafeTenantSchema declares them `z.date()`, so every cached read failed to
 * parse, was deleted and re-read from the database: the cache never served a hit (appendix A, tenant.read.service.edge, fixed
 * 2026-10-20). The date-named keys are revived on the way back.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
function reviveDates(key: string, value: unknown): unknown {
  return typeof value === 'string' && /(?:At|After|Until)$/.test(key) && ISO_INSTANT.test(value) ? new Date(value) : value;
}

export async function getAll({ page, pageSize, search, tenantId, sort, tenantStatus, region, countryCode, createdFrom, createdTo }: GetTenantsInput): Promise<{ tenants: SafeTenant[]; total: number }> {
  // The fleet tenant is a federation home, never a directory entry (docs/phases/02-fleet Decision 19):
  // excluded from the list and from `total`, even when asked for by id.
  if (isFleetTenant(tenantId)) return { tenants: [], total: 0 };
  const baseWhere: Record<string, unknown> = compactWhere({
    deletedAt: IsNull(),
    tenantId: tenantId ? tenantId : Not(FLEET_TENANT_ID),
    tenantStatus: inList(tenantStatus),
    region: inList(region),
    countryCode: inList(countryCode),
    createdAt: dayRange(createdFrom, createdTo),
  });

  // phase 43: a search over the name (and the slug), its wildcards escaped; each branch keeps the conditions above
  const whereConditions: Record<string, unknown>[] = search
    ? [{ ...baseWhere, name: containsText(search) }, { ...baseWhere, slug: containsText(search) }]
    : [baseWhere];

  // The platform tenant list: a deliberate cross-tenant read.
  const [tenants, total] = await withSystemRLS((qr) => qr.manager.getRepository(TenantEntity).findAndCount({
    where: whereConditions as FindOptionsWhere<TenantEntity>[], skip: page * pageSize, take: pageSize,
    order: toOrder((sort as ListSort | undefined) ?? [{ field: 'createdAt', dir: 'desc' }], TENANT_SORTABLE, { tenantId: 'ASC' }, TenantEntity) as never,
  }));

  return { tenants: tenants.map((t) => SafeTenantSchema.parse(t)), total };
}

/**
 * D270 (tenant.cache-drop.ts): the cached row is read with the tenant's profile version (one round trip) and believed only when it is
 * sealed with the stamp of this read and no cache drop is pending for the tenant; otherwise the database answers. A status write
 * records its drop in its own transaction, so a suspension, a deletion request or a migration freeze is applied at once by every
 * reader (an API key's standing check among them), also when Redis was away or came back with its old data.
 */
export async function getById(tenantId: string): Promise<SafeTenant> {
  const cacheKey = tenantProfileKey(tenantId);
  const read = await readGuarded([cacheKey], [tenantProfileVersionKey(tenantId)]);
  const sealed = openEntry(read?.values[0], stampOf(read));
  if (sealed !== undefined && (await noDropPending(tenantId))) {
    try { return SafeTenantSchema.parse(JSON.parse(JSON.stringify(sealed), reviveDates)); } catch { await redis.del(cacheKey).catch(() => {}); }
  }

  return singleFlight(cacheKey, async () => {
    const tenant = await withTenantRepositoryFor(tenantId, TenantEntity, (repo) =>
      repo.findOne({ where: { tenantId, deletedAt: IsNull() } }));
    if (!tenant) throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);

    const parsed = SafeTenantSchema.parse(tenant);
    // sealed with the version read BEFORE the database read: a status write that commits in between bumps it
    const stamp = await stampForWrite(read);
    if (stamp && (await noDropPending(tenantId))) await writeGuarded(cacheKey, stamp, parsed, jitter(TENANT_CACHE_TTL));
    return parsed;
  });
}

export async function getBySlug(slug: string): Promise<SafeTenant> {
  // Slug → tenant: the tenant is what is being resolved, so a cross-tenant read.
  const tenant = await withSystemRLS((qr) => qr.manager.getRepository(TenantEntity).findOne({ where: { slug, deletedAt: IsNull() } }));
  if (!tenant) throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
  return SafeTenantSchema.parse(tenant);
}
