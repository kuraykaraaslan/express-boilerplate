import 'reflect-metadata';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import {
  cacheDropOrders, noDropPending, openEntry, readGuarded, stampForWrite, stampOf, writeGuarded,
} from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import { deliverRecorded, recordOrders } from '@kuraykaraaslan-labs/session_end/server/session_end.orders';
import type { RecordedSessionEndOrder } from '@kuraykaraaslan-labs/session_end/server/session_end.contract';
import type { QueryRunner } from 'typeorm';
import { requestMemo, forgetRequestMemo } from '@kuraykaraaslan-labs/common/server/request-memo';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { AbacPolicy as AbacPolicyEntity } from './entities/auth_abac_policy.entity';
import { PolicySchema, type Policy } from './auth_abac.types';
import {
  POLICY_SORTABLE,
  type CreatePolicyInput,
  type UpdatePolicyInput,
  type ListPoliciesQueryInput,
} from './auth_abac.dto';
import { escapeLike } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { AUTH_ABAC_MESSAGES as MSG } from './auth_abac.messages';
import { policiesCacheKey, policiesVersionKey } from './auth_abac.cache-keys';

// The active policy-set is read on (potentially) every authorized request but
// changes only when an admin edits a policy — a read-through cache target. We
// cache the whole active set under one key; every write records its drop in its
// own transaction (D253, see policiesVersionKey).
const POLICIES_CACHE_TTL = env.TENANT_CACHE_TTL ?? 60 * 5;

const cacheKey = policiesCacheKey;

/** The drop of a policy write, recorded in its transaction (throws when it cannot be: the write rolls back). */
function recordPolicyDrop(qr: QueryRunner, tenantId: string): Promise<RecordedSessionEndOrder[]> {
  return recordOrders(cacheDropOrders(tenantId, 'auth_abac.cache_drop', [{ del: [cacheKey(tenantId)], bump: [policiesVersionKey(tenantId)] }]), { qr });
}

/** Normalise nullable jsonb columns into the strict runtime shape. */
function toPolicy(row: AbacPolicyEntity): Policy {
  return PolicySchema.parse({
    ...row,
    target: row.target ?? { resourceTypes: [], actions: [] },
    rules: row.rules ?? [],
  });
}

export default class AbacPolicyService {
  // ── Cache ────────────────────────────────────────────────────────────────

  /**
   * Load (and cache) the tenant's ACTIVE policy-set, ordered by priority ASC. Inside a request-memo scope (one
   * decision, one bulk check) the set is read and parsed once.
   */
  static loadSet(tenantId: string): Promise<Policy[]> {
    return requestMemo(cacheKey(tenantId), () => AbacPolicyService.readSet(tenantId));
  }

  private static async readSet(tenantId: string): Promise<Policy[]> {
    const key = cacheKey(tenantId);
    // D253 (session_end.cache-guard.ts): the set is read with its version (one round trip) and believed only when sealed with the
    // stamp of this read and no cache drop is pending for the tenant; otherwise the database answers.
    const read = await readGuarded([key], [policiesVersionKey(tenantId)]);
    const sealed = openEntry(read?.values[0], stampOf(read));
    if (Array.isArray(sealed) && (await noDropPending(tenantId))) {
      try {
        return sealed.map((p) => PolicySchema.parse(p));
      } catch {
        await redis.del(key).catch(() => {});
      }
    }

    return singleFlight(key, async () => {
      const rows = await withTenantRepositoryFor(tenantId, AbacPolicyEntity, (repo) => repo.find({
        where: { tenantId, isActive: true },
        order: { priority: 'ASC' },
      }));
      const set = rows.map(toPolicy);
      // sealed with the version read BEFORE the database read: a policy write that commits in between bumps it
      const stamp = await stampForWrite(read);
      if (stamp && (await noDropPending(tenantId))) await writeGuarded(key, stamp, set, jitter(POLICIES_CACHE_TTL));
      return set;
    });
  }

  /** After a write's commit: this request's memo forgets the set, and the drop is delivered (the relay has it otherwise). */
  private static async afterWrite(tenantId: string, drops: readonly RecordedSessionEndOrder[]): Promise<void> {
    forgetRequestMemo(cacheKey(tenantId));
    await deliverRecorded(drops);
  }

  // ── Reads (admin — includes inactive) ──────────────────────────────────────

  static async list(
    tenantId: string,
    query: Pick<ListPoliciesQueryInput, 'page' | 'pageSize'> & Partial<Omit<ListPoliciesQueryInput, 'page' | 'pageSize'>>,
  ): Promise<{ data: Policy[]; total: number }> {
    const [rows, total] = await withTenantRepositoryFor(tenantId, AbacPolicyEntity, (repo) => {
      const qb = repo
        .createQueryBuilder('p')
        .where('p.tenantId = :tenantId', { tenantId });
      const effects = query.effect === undefined ? [] : ([] as string[]).concat(query.effect);
      if (effects.length === 1) qb.andWhere('p.effect = :effect', { effect: effects[0] });
      else if (effects.length > 1) qb.andWhere('p.effect IN (:...effects)', { effects });
      if (query.isActive !== undefined)
        qb.andWhere('p.isActive = :isActive', { isActive: query.isActive });
      // `%` and `_` in the search match literally.
      if (query.search)
        qb.andWhere(`(p.name ILIKE :search ESCAPE '\\' OR p.description ILIKE :search ESCAPE '\\')`, { search: `%${escapeLike(query.search)}%` });
      // Columns only from POLICY_SORTABLE; the id breaks ties so pages never overlap.
      const order = query.sort?.length ? query.sort : [{ field: 'priority' as const, dir: 'asc' as const }, { field: 'name' as const, dir: 'asc' as const }];
      order.forEach((o, i) => {
        const col = `p.${POLICY_SORTABLE[o.field]}`;
        const dir = o.dir === 'asc' ? 'ASC' : 'DESC';
        if (i === 0) qb.orderBy(col, dir); else qb.addOrderBy(col, dir);
      });
      qb.addOrderBy('p.policyId', 'ASC');
      return qb
        .skip(query.page * query.pageSize)
        .take(query.pageSize)
        .getManyAndCount();
    });
    return { data: rows.map(toPolicy), total };
  }

  static async get(tenantId: string, policyId: string): Promise<Policy> {
    const row = await withTenantRepositoryFor(tenantId, AbacPolicyEntity, (repo) => repo.findOne({
      where: { tenantId, policyId },
    }));
    if (!row) throw new AppError(MSG.POLICY_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    return toPolicy(row);
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  static async create(tenantId: string, input: CreatePolicyInput): Promise<Policy> {
    const { saved, drops } = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(AbacPolicyEntity);
      const existing = await repo.findOne({ where: { tenantId, name: input.name } });
      if (existing) throw new AppError(MSG.POLICY_NAME_TAKEN, 409, ErrorCode.CONFLICT);

      const row = repo.create({
        tenantId,
        name: input.name,
        description: input.description ?? null,
        effect: input.effect,
        priority: input.priority,
        isActive: input.isActive,
        target: input.target,
        rules: input.rules,
      });
      const saved = await repo.save(row);
      return { saved, drops: await recordPolicyDrop(qr, tenantId) };
    });
    await this.afterWrite(tenantId, drops);
    return toPolicy(saved);
  }

  static async update(
    tenantId: string,
    policyId: string,
    input: UpdatePolicyInput,
  ): Promise<Policy> {
    const { saved, drops } = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(AbacPolicyEntity);
      const row = await repo.findOne({ where: { tenantId, policyId } });
      if (!row) throw new AppError(MSG.POLICY_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

      if (input.name !== undefined && input.name !== row.name) {
        const clash = await repo.findOne({ where: { tenantId, name: input.name } });
        if (clash) throw new AppError(MSG.POLICY_NAME_TAKEN, 409, ErrorCode.CONFLICT);
        row.name = input.name;
      }
      if (input.description !== undefined) row.description = input.description;
      if (input.effect !== undefined) row.effect = input.effect;
      if (input.priority !== undefined) row.priority = input.priority;
      if (input.isActive !== undefined) row.isActive = input.isActive;
      if (input.target !== undefined) row.target = input.target;
      if (input.rules !== undefined) row.rules = input.rules;

      const saved = await repo.save(row);
      return { saved, drops: await recordPolicyDrop(qr, tenantId) };
    });
    await this.afterWrite(tenantId, drops);
    return toPolicy(saved);
  }

  static async remove(tenantId: string, policyId: string): Promise<void> {
    const drops = await withTenantTransactionFor(tenantId, async (qr) => {
      const result = await qr.manager.getRepository(AbacPolicyEntity).delete({ tenantId, policyId });
      if (!result.affected) throw new AppError(MSG.POLICY_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      return recordPolicyDrop(qr, tenantId);
    });
    await this.afterWrite(tenantId, drops);
  }
}
