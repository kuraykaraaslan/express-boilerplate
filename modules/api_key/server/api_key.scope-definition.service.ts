import 'reflect-metadata';
import { withSharedTenantRepositoryFor, withSharedTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ApiKeyScopeDefinition } from './entities/api_key_scope_definition.entity';
import ApiKeyMessages from './api_key.messages';
import {
  SCOPE_DEFINITION_SORTABLE,
  type CreateScopeDefinitionInput,
  type UpdateScopeDefinitionInput,
  type ListScopeDefinitionsInput,
} from './api_key.dto';
import { compactWhere, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query';

/**
 * CRUD for the tenant-configurable API-key scope catalogue (descriptive
 * master-data). Soft-deletable; every query is tenant-scoped.
 */
export default class ApiKeyScopeDefinitionService {
  static async list(
    tenantId: string,
    query: Pick<ListScopeDefinitionsInput, 'page' | 'pageSize'> & Partial<Pick<ListScopeDefinitionsInput, 'sort' | 'search' | 'isActive' | 'category'>>,
  ): Promise<{ data: ApiKeyScopeDefinition[]; total: number }> {
    const where = compactWhere({ tenantId, isActive: query.isActive, category: query.category });
    const [data, total] = await withSharedTenantRepositoryFor(tenantId, ApiKeyScopeDefinition, (repo) => repo.findAndCount({
      // `%` and `_` in the search match literally (escapeLike), across scope, label and description.
      where: searchWhere(where, query.search, ['scope', 'label', 'description']),
      // Columns only from SCOPE_DEFINITION_SORTABLE; the id breaks ties so pages never overlap.
      order: toOrder(
        query.sort ?? [{ field: 'category', dir: 'asc' }, { field: 'scope', dir: 'asc' }],
        SCOPE_DEFINITION_SORTABLE,
        { apiKeyScopeDefinitionId: 'ASC' },
      ),
      skip: query.page * query.pageSize,
      take: query.pageSize,
    }));
    return { data, total };
  }

  static async getById(tenantId: string, scopeDefinitionId: string): Promise<ApiKeyScopeDefinition> {
    const row = await withSharedTenantRepositoryFor(tenantId, ApiKeyScopeDefinition, (repo) => repo.findOne({
      where: { tenantId, apiKeyScopeDefinitionId: scopeDefinitionId },
    }));
    if (!row) throw new AppError(ApiKeyMessages.SCOPE_DEFINITION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    return row;
  }

  /**
   * The (tenantId, scope) unique index also covers soft-deleted rows, so a
   * deleted definition is RESTORED when the scope is defined again — a fresh
   * insert would fail. Serialised per scope; a lost race is a 409, not a 500.
   */
  static async create(tenantId: string, data: CreateScopeDefinitionInput): Promise<ApiKeyScopeDefinition> {
    const fields = {
      label: data.label,
      description: data.description ?? null,
      category: data.category ?? 'General',
      isActive: data.isActive ?? true,
    };
    try {
      return await withSharedTenantTransactionFor(tenantId, async (qr) => {
        await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`api_key:scope_def:${tenantId}:${data.scope}`]);
        const repo = qr.manager.getRepository(ApiKeyScopeDefinition);
        const existing = await repo.findOne({ where: { tenantId, scope: data.scope }, withDeleted: true });
        if (existing && !existing.deletedAt) throw new AppError(ApiKeyMessages.SCOPE_DEFINITION_EXISTS, 409, ErrorCode.CONFLICT);
        if (existing) {
          await repo.update({ tenantId, apiKeyScopeDefinitionId: existing.apiKeyScopeDefinitionId }, { ...fields, deletedAt: null } as never);
          return Object.assign(existing, fields, { deletedAt: null }) as ApiKeyScopeDefinition;
        }
        return repo.save(repo.create({ tenantId, scope: data.scope, ...fields }));
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isUniqueViolation(error)) throw new AppError(ApiKeyMessages.SCOPE_DEFINITION_EXISTS, 409, ErrorCode.CONFLICT);
      throw new AppError(ApiKeyMessages.SCOPE_DEFINITION_CREATE_FAILED, 500, ErrorCode.INTERNAL_ERROR);
    }
  }

  static async update(
    tenantId: string,
    scopeDefinitionId: string,
    data: UpdateScopeDefinitionInput,
  ): Promise<ApiKeyScopeDefinition> {
    const patch: Partial<ApiKeyScopeDefinition> = {};
    if (data.scope !== undefined) patch.scope = data.scope;
    if (data.label !== undefined) patch.label = data.label;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.category !== undefined) patch.category = data.category;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    try {
      const row = await withSharedTenantRepositoryFor(tenantId, ApiKeyScopeDefinition, async (repo) => {
        const found = await repo.findOne({ where: { tenantId, apiKeyScopeDefinitionId: scopeDefinitionId } });
        if (!found) return null;
        if (Object.keys(patch).length) await repo.update({ tenantId, apiKeyScopeDefinitionId: scopeDefinitionId }, patch);
        return Object.assign(found, patch);
      });
      if (!row) throw new AppError(ApiKeyMessages.SCOPE_DEFINITION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      return row;
    } catch (error) {
      // Renaming onto a scope that is already defined (even a deleted one).
      if (isUniqueViolation(error)) throw new AppError(ApiKeyMessages.SCOPE_DEFINITION_EXISTS, 409, ErrorCode.CONFLICT);
      throw error;
    }
  }

  static async delete(tenantId: string, scopeDefinitionId: string): Promise<void> {
    const res = await withSharedTenantRepositoryFor(tenantId, ApiKeyScopeDefinition, (repo) =>
      repo.softDelete({ tenantId, apiKeyScopeDefinitionId: scopeDefinitionId }));
    if (!res.affected) throw new AppError(ApiKeyMessages.SCOPE_DEFINITION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  }
}

/** Postgres unique_violation, however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}
