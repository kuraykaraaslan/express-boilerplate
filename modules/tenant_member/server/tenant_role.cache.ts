import 'reflect-metadata';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { requestMemo, forgetRequestMemo } from '@kuraykaraaslan-labs/common/server/request-memo';
import type { QueryRunner } from 'typeorm';
import { CACHE_VERSION_TTL_SECONDS, cacheDropOrders, noDropPending, openEntry, readGuarded, stampForWrite, stampOf, writeGuarded } from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import { deliverRecorded, recordOrders } from '@kuraykaraaslan-labs/session_end/server/session_end.orders';
import type { RecordedSessionEndOrder } from '@kuraykaraaslan-labs/session_end/server/session_end.contract';
import { TenantRole as TenantRoleEntity } from './entities/tenant_role.entity';
import type { CachedRoleSet } from './tenant_role.types';
import {
  ROLES_CACHE_TTL,
  cacheKey,
  rolesVersionKey,
  synthesizeBuiltins,
  toView,
} from './tenant_role.helpers';

// ── Cache ────────────────────────────────────────────────────────────────

/**
 * The tenant's effective role set. When the tenant has never persisted a role,
 * the three built-ins are synthesized in-memory from PERMISSION_MATRIX
 * (`seeded:false`) — nothing is written on read.
 */
export function loadSet(tenantId: string): Promise<CachedRoleSet> {
  // One permission decision reads the set up to three times (custom-role union, matrix fallback, and again per
  // permission in a bulk check); inside a request-memo scope that is one Redis read and one parse.
  return requestMemo(`tenant_role:set:${tenantId}`, () => readSet(tenantId));
}

async function readSet(tenantId: string): Promise<CachedRoleSet> {
  const key = cacheKey(tenantId);
  // D253 (session_end.cache-guard.ts): the set is read with its version (one round trip) and believed only when sealed with the
  // stamp of this read and no cache drop is pending for the tenant; otherwise the database answers.
  const read = await readGuarded([key], [rolesVersionKey(tenantId)]);
  const sealed = openEntry(read?.values[0], stampOf(read)) as Partial<CachedRoleSet> | undefined;
  if (sealed && Array.isArray(sealed.roles) && (await noDropPending(tenantId))) return sealed as CachedRoleSet;
  if (sealed) await redis.del(key).catch(() => {});

  return singleFlight(key, async () => {
    const rows = await withTenantRepositoryFor(tenantId, TenantRoleEntity, (repo) =>
      repo.find({ where: { tenantId }, order: { isBuiltin: 'DESC', key: 'ASC' } }));
    const set: CachedRoleSet =
      rows.length > 0
        ? { roles: rows.map(toView), seeded: true }
        : { roles: synthesizeBuiltins(), seeded: false };
    // sealed with the version read BEFORE the database read: a role-set write that commits in between bumps it
    const stamp = await stampForWrite(read);
    if (stamp && (await noDropPending(tenantId))) await writeGuarded(key, stamp, set, jitter(ROLES_CACHE_TTL));
    return set;
  });
}

/**
 * The drop of a role-set write, recorded in the write's open transaction (D253): the set deleted and its version bumped, which also
 * retires every cached ABAC decision of the tenant. Throws when it cannot be recorded (the write rolls back).
 */
export function recordRoleSetDrop(qr: QueryRunner, tenantId: string): Promise<RecordedSessionEndOrder[]> {
  return recordOrders(cacheDropOrders(tenantId, 'tenant_member.role_set_drop', [{ del: [cacheKey(tenantId)], bump: [rolesVersionKey(tenantId)] }]), { qr });
}

/** After the write's commit: this request's memo forgets the set and the drop is delivered (never throws; the relay has it). */
export async function deliverRoleSetDrop(tenantId: string, drops: readonly RecordedSessionEndOrder[]): Promise<void> {
  forgetRequestMemo(`tenant_role:set:${tenantId}`);
  await deliverRecorded(drops);
}

/**
 * Best-effort drop for a caller outside a role-set write (`TenantRoleService.invalidate`): deletes the set and bumps its version. A
 * failure is left to the entry's TTL; every role-set write records its drop durably instead (`recordRoleSetDrop`).
 */
export async function invalidate(tenantId: string): Promise<void> {
  forgetRequestMemo(`tenant_role:set:${tenantId}`);
  await redis.del(cacheKey(tenantId)).catch(() => {});
  const v = rolesVersionKey(tenantId);
  await Promise.resolve().then(() => redis.incr(v)).then(() => redis.expire(v, CACHE_VERSION_TTL_SECONDS)).catch(() => {});
}
