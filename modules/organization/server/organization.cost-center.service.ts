import 'reflect-metadata'
import { Like, type Repository } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { CostCenter } from './entities/organization_cost_centers.entity'
import { COST_CENTER_SORTABLE, COST_CENTER_DEFAULT_SORT, type CreateCostCenterDTO, type UpdateCostCenterDTO, type GetCostCentersQuery } from './organization.dto'
import { ORGANIZATION_MESSAGES } from './organization.messages'
import { auditOrganization } from './organization.audit'
import { allocateCode, assertCodeFree, lockTenantKind, resolveCodePrefix } from './organization.code'
import { assertNotReferenced } from './organization.reference-check'
import { descendantsLike } from './organization.path'
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { organizationGlAccountLookupLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/organization.gl_account_lookup'
import { compactWhere, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query'

/**
 * Tenant-scoped cost-center tree (Odoo's analytic account used as a cost
 * center). `path` is the materialised ancestry — this service is its ONLY
 * writer, which is what makes `subtree` a single indexed prefix scan instead of
 * a recursive CTE.
 */
export default class CostCenterService {
  static async list(
    tenantId: string,
    query: GetCostCentersQuery,
  ): Promise<{ data: CostCenter[]; total: number }> {
    const where = compactWhere({ tenantId, isActive: query.isActive })
    const [data, total] = await withTenantRepositoryFor(tenantId, CostCenter, (repo) => repo.findAndCount({
      where: searchWhere(where, query.search, ['name', 'code']),
      order: toOrder(query.sort ?? COST_CENTER_DEFAULT_SORT, COST_CENTER_SORTABLE, { costCenterId: 'ASC' }),
      skip: query.page * query.pageSize,
      take: query.pageSize,
    }))
    return { data, total }
  }

  static async getById(tenantId: string, costCenterId: string): Promise<CostCenter> {
    const row = await withTenantRepositoryFor(tenantId, CostCenter, (repo) => repo.findOne({ where: { tenantId, costCenterId } }))
    if (!row) throw new AppError(ORGANIZATION_MESSAGES.COST_CENTER_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return row
  }

  static async create(
    tenantId: string,
    data: CreateCostCenterDTO,
    actorId?: string,
  ): Promise<CostCenter> {
    if (data.glAccountId) await assertGlAccount(tenantId, data.glAccountId)
    const prefix = data.code ? null : await resolveCodePrefix(tenantId, 'organizationCostCenterCodePrefix')
    try {
      // Code, parent path and insert under the tenant's cost-center lock
      // (docs/phases/10-db Faz 3): the tree cannot move under a create.
      const saved = await withTenantTransactionFor(tenantId, async (qr) => {
        await lockTenantKind(qr, tenantId, 'cost_center')
        const repo = qr.manager.getRepository(CostCenter)
        const code = data.code ?? (await allocateCode(repo, tenantId, prefix!))
        await assertCodeFree(repo, tenantId, code, 'costCenterId')
        const path = await CostCenterService.buildPath(repo, tenantId, code, data.parentId ?? null)
        return repo.save(repo.create({ ...data, code, path, tenantId }))
      })
      auditOrganization(
        tenantId, actorId, 'organization.costCenter.created', 'CostCenter', saved.costCenterId,
        { code: saved.code, name: saved.name, path: saved.path },
      )
      return saved
    } catch (error) {
      if (error instanceof AppError) throw error
      Logger.error(`[CostCenterService.create][tenant:${tenantId}] ${error}`)
      throw new AppError(
        ORGANIZATION_MESSAGES.COST_CENTER_CREATE_FAILED,
        500,
        ErrorCode.INTERNAL_ERROR,
      )
    }
  }

  /**
   * Update, re-materialising `path` when the code or the parent moves — and
   * rewriting every descendant's path with the same prefix swap, so the subtree
   * invariant holds after a re-parent.
   */
  static async update(
    tenantId: string,
    costCenterId: string,
    data: UpdateCostCenterDTO,
    actorId?: string,
  ): Promise<CostCenter> {
    if (data.glAccountId) await assertGlAccount(tenantId, data.glAccountId)
    // The node, its descendants' paths and the cycle check are ONE
    // transaction under the tenant's cost-center lock (docs/phases/10-db Faz 3).
    // Before, the node was saved and its subtree rewritten in separate writes
    // (a failure between them left a broken tree), and two concurrent moves
    // (A under B, B under A) each passed the cycle check and made a cycle.
    const { saved, oldPath, nextPath } = await withTenantTransactionFor(tenantId, async (qr) => {
    await lockTenantKind(qr, tenantId, 'cost_center')
    const repo = qr.manager.getRepository(CostCenter)
    const row = await repo.findOne({ where: { tenantId, costCenterId } })
    if (!row) throw new AppError(ORGANIZATION_MESSAGES.COST_CENTER_NOT_FOUND, 404, ErrorCode.NOT_FOUND)

    if (data.code !== undefined && data.code !== row.code) {
      await assertCodeFree(repo, tenantId, data.code, 'costCenterId', costCenterId)
    }

    const nextCode = data.code ?? row.code
    const nextParentId = data.parentId !== undefined ? data.parentId : (row.parentId ?? null)

    if (nextParentId) {
      // Self-parenting and descendant-parenting both produce an unreachable
      // cycle in the materialised path; reject before anything is written.
      if (nextParentId === costCenterId) {
        throw new AppError(ORGANIZATION_MESSAGES.PARENT_CYCLE, 400, ErrorCode.VALIDATION_ERROR)
      }
      const parent = await repo.findOne({ where: { tenantId, costCenterId: nextParentId } })
      if (!parent) throw new AppError(ORGANIZATION_MESSAGES.PARENT_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      if (parent.path === row.path || parent.path.startsWith(`${row.path}/`)) {
        throw new AppError(ORGANIZATION_MESSAGES.PARENT_CYCLE, 400, ErrorCode.VALIDATION_ERROR)
      }
    }

    const oldPath = row.path
    const nextPath = await CostCenterService.buildPath(repo, tenantId, nextCode, nextParentId)

    Object.assign(row, data)
    row.code = nextCode
    row.parentId = nextParentId ?? undefined
    row.path = nextPath
    const out = await repo.save(row)

    if (nextPath !== oldPath) {
      await CostCenterService.rewriteDescendants(repo, tenantId, oldPath, nextPath)
    }
    return { saved: out, oldPath, nextPath }
    })

    auditOrganization(tenantId, actorId, 'organization.costCenter.updated', 'CostCenter', costCenterId, {
      changedKeys: Object.keys(data),
      oldPath,
      newPath: nextPath,
    })
    return saved
  }

  /**
   * Soft-remove AND deactivate a leaf, after every
   * `organization:reference_check` contribution clears it. A node with live
   * children is refused: soft-removing it would strand the children under a path
   * whose head no longer exists.
   *
   * A cost center is NEVER hard-deleted — `accounting.journal_lines.costCenterId`
   * is a bare uuid with no FK, and a five-year-old ledger line must still render
   * its label (see `OrganizationLookupService.resolveLabels`, which reads
   * soft-deleted rows).
   */
  static async delete(tenantId: string, costCenterId: string, actorId?: string): Promise<void> {
    await CostCenterService.getById(tenantId, costCenterId)
    // Asks other modules — before the block.
    await assertNotReferenced(tenantId, { kind: 'COST_CENTER', id: costCenterId })
    // Children counted and the node removed under the tree lock, so no child
    // can be created under it in between.
    const row = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'cost_center')
      const repo = qr.manager.getRepository(CostCenter)
      const found = await repo.findOne({ where: { tenantId, costCenterId } })
      if (!found) throw new AppError(ORGANIZATION_MESSAGES.COST_CENTER_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      const children = await repo.count({ where: { tenantId, parentId: costCenterId } })
      if (children > 0) {
        throw new AppError(ORGANIZATION_MESSAGES.COST_CENTER_HAS_CHILDREN, 409, ErrorCode.CONFLICT)
      }
      found.isActive = false
      // organization.35: softRemove writes only deletedAt; the deactivation is persisted first, as the delete promises.
      await repo.save(found)
      await repo.softRemove(found)
      return found
    })
    auditOrganization(tenantId, actorId, 'organization.costCenter.deleted', 'CostCenter', costCenterId, {
      code: row.code,
      name: row.name,
      path: row.path,
    })
  }

  /**
   * The node plus every descendant, depth-first by path. One prefix scan — the
   * whole reason `path` is materialised.
   */
  static async subtree(tenantId: string, costCenterId: string): Promise<CostCenter[]> {
    return withTenantRepositoryFor(tenantId, CostCenter, async (repo) => {
      const root = await repo.findOne({ where: { tenantId, costCenterId } })
      if (!root) throw new AppError(ORGANIZATION_MESSAGES.COST_CENTER_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      // `${path}/%` and never `${path}%`: the latter would also match a sibling
      // whose code merely starts with this one (/GY vs /GY2).
      const descendants = await repo.find({
        where: { tenantId, path: Like(descendantsLike(root.path)) },
        order: { path: 'ASC' },
      })
      return [root, ...descendants]
    })
  }

  /**
   * Just the ids of `subtree`. What an analytics filter actually wants —
   * "everything booked under Sales" is an `IN (…)` over this.
   */
  static async subtreeIds(tenantId: string, costCenterId: string): Promise<string[]> {
    const rows = await CostCenterService.subtree(tenantId, costCenterId)
    return rows.map((r) => r.costCenterId)
  }

  // ==========================================================================
  // Path maintenance
  // ==========================================================================

  /** `/CODE` for a root, `<parent.path>/CODE` otherwise. */
  private static async buildPath(
    repo: Repository<CostCenter>,
    tenantId: string,
    code: string,
    parentId: string | null,
  ): Promise<string> {
    if (!parentId) return `/${code}`
    const parent = await repo.findOne({ where: { tenantId, costCenterId: parentId } })
    if (!parent) throw new AppError(ORGANIZATION_MESSAGES.PARENT_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return `${parent.path}/${code}`
  }

  /** Swap `oldPath` for `newPath` at the head of every descendant's path. */
  private static async rewriteDescendants(
    repo: Repository<CostCenter>,
    tenantId: string,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const descendants = await repo.find({ where: { tenantId, path: Like(descendantsLike(oldPath)) } })
    for (const child of descendants) {
      child.path = `${newPath}${child.path.slice(oldPath.length)}`
      await repo.save(child)
    }
  }
}

/**
 * organization.06: a cost center names a GL account of THIS tenant's ledger that exists and is active (accounting, an optional
 * module). With accounting off there is no ledger to point at: a GL account id is refused rather than stored unchecked.
 */
async function assertGlAccount(tenantId: string, glAccountId: string): Promise<void> {
  const invalid = () => new AppError(ORGANIZATION_MESSAGES.GL_ACCOUNT_INVALID, 422, ErrorCode.VALIDATION_ERROR)
  // Asked through `organization:gl_account_lookup` (accounting contributes): a Core module may not import accounting (Pro).
  // No contributor (accounting off or not installed) answers null, so the id is refused; a failing one refuses too (fail-closed).
  const found = await ext.first<GlAccountLookup, { isActive: boolean }>(
    GL_ACCOUNT_LOOKUP_POINT, tenantCtx(tenantId), organizationGlAccountLookupLoaders,
    (lookup) => lookup(tenantId, glAccountId),
  )
  if (!found || found.value.isActive === false) throw invalid()
}

/** organization.06: the point a ledger answers through (declared in organization/module.json). */
const GL_ACCOUNT_LOOKUP_POINT = 'organization:gl_account_lookup'
/** A contribution to `organization:gl_account_lookup`: null when the tenant has no such account. */
type GlAccountLookup = (tenantId: string, accountId: string) => Promise<{ isActive: boolean } | null>
