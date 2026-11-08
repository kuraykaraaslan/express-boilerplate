import 'reflect-metadata'
import type { EntityManager, Repository } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Site } from './entities/organization_sites.entity'
import { LegalEntity } from './entities/organization_legal_entities.entity'
import { SITE_SORTABLE, SITE_DEFAULT_SORT, type CreateSiteDTO, type UpdateSiteDTO, type GetSitesQuery } from './organization.dto'
import { ORGANIZATION_MESSAGES } from './organization.messages'
import { auditOrganization } from './organization.audit'
import { allocateCode, assertCodeFree, lockTenantKind, resolveCodePrefix } from './organization.code'
import { assertNotReferenced } from './organization.reference-check'
import { compactWhere, inList, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query'

/** Tenant-scoped physical-location master (office, branch, warehouse, plant…). */
export default class SiteService {
  static async list(tenantId: string, query: GetSitesQuery): Promise<{ data: Site[]; total: number }> {
    const where = compactWhere({
      tenantId,
      kind: inList(query.kind),
      legalEntityId: inList(query.legalEntityId),
      isActive: query.isActive,
    })
    const [data, total] = await withTenantRepositoryFor(tenantId, Site, (repo) => repo.findAndCount({
      where: searchWhere(where, query.search, ['name', 'code', 'city']),
      order: toOrder(query.sort ?? SITE_DEFAULT_SORT, SITE_SORTABLE, { siteId: 'ASC' }, Site),
      skip: query.page * query.pageSize,
      take: query.pageSize,
    }))
    return { data, total }
  }

  static async getById(tenantId: string, siteId: string): Promise<Site> {
    const row = await withTenantRepositoryFor(tenantId, Site, (repo) => repo.findOne({ where: { tenantId, siteId } }))
    if (!row) throw new AppError(ORGANIZATION_MESSAGES.SITE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return row
  }

  static async create(tenantId: string, data: CreateSiteDTO, actorId?: string): Promise<Site> {
    const prefix = data.code ? null : await resolveCodePrefix(tenantId, 'organizationSiteCodePrefix')
    try {
      // Code allocation, insert and the headquarters demotion in ONE
      // transaction under the tenant's site lock (docs/phases/10-db Faz 3).
      const saved = await withTenantTransactionFor(tenantId, async (qr) => {
        await lockTenantKind(qr, tenantId, 'site')
        const repo = qr.manager.getRepository(Site)
        const code = data.code ?? (await allocateCode(repo, tenantId, prefix!))
        await assertCodeFree(repo, tenantId, code, 'siteId')
        if (data.legalEntityId) await SiteService.assertLegalEntityExists(qr, tenantId, data.legalEntityId)
        const row = await repo.save(
          repo.create({ ...data, code, tenantId, legalEntityId: data.legalEntityId ?? undefined }),
        )
        // A tenant has exactly one headquarters; promoting one demotes the rest.
        if (row.isHeadquarters) await SiteService.demoteOtherHeadquarters(repo, tenantId, row.siteId)
        return row
      })
      auditOrganization(tenantId, actorId, 'organization.site.created', 'Site', saved.siteId, {
        code: saved.code,
        name: saved.name,
        kind: saved.kind,
        isHeadquarters: saved.isHeadquarters,
      })
      return saved
    } catch (error) {
      if (error instanceof AppError) throw error
      Logger.error(`[SiteService.create][tenant:${tenantId}] ${error}`)
      throw new AppError(ORGANIZATION_MESSAGES.SITE_CREATE_FAILED, 500, ErrorCode.INTERNAL_ERROR)
    }
  }

  static async update(
    tenantId: string,
    siteId: string,
    data: UpdateSiteDTO,
    actorId?: string,
  ): Promise<Site> {
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'site')
      const repo = qr.manager.getRepository(Site)
      const row = await repo.findOne({ where: { tenantId, siteId } })
      if (!row) throw new AppError(ORGANIZATION_MESSAGES.SITE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      if (data.code !== undefined && data.code !== row.code) {
        await assertCodeFree(repo, tenantId, data.code, 'siteId', siteId)
      }
      if (data.legalEntityId) await SiteService.assertLegalEntityExists(qr, tenantId, data.legalEntityId)
      Object.assign(row, data)
      if (data.legalEntityId === null) row.legalEntityId = undefined
      const out = await repo.save(row)
      if (out.isHeadquarters) await SiteService.demoteOtherHeadquarters(repo, tenantId, siteId)
      return out
    })
    auditOrganization(tenantId, actorId, 'organization.site.updated', 'Site', siteId, {
      changedKeys: Object.keys(data),
    })
    return saved
  }

  /**
   * Soft-remove AND deactivate, after every `organization:reference_check`
   * contribution clears it. A site is NEVER hard-deleted: a five-year-old
   * journal line, payslip or shipment still resolves its label through
   * `OrganizationLookupService`, which reads soft-deleted rows on purpose.
   */
  static async delete(tenantId: string, siteId: string, actorId?: string): Promise<void> {
    await SiteService.getById(tenantId, siteId)
    // Asks other modules — before the block.
    await assertNotReferenced(tenantId, { kind: 'SITE', id: siteId })
    const row = await withTenantRepositoryFor(tenantId, Site, async (repo) => {
      const found = await repo.findOne({ where: { tenantId, siteId } })
      if (!found) throw new AppError(ORGANIZATION_MESSAGES.SITE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      found.isActive = false
      // organization.35: softRemove writes only deletedAt; the deactivation is persisted first, as the delete promises.
      await repo.save(found)
      await repo.softRemove(found)
      return found
    })
    auditOrganization(tenantId, actorId, 'organization.site.deleted', 'Site', siteId, {
      code: row.code,
      name: row.name,
    })
  }

  /**
   * Keep `isHeadquarters` single-valued per tenant. Statutory filings name one
   * head office, so two flagged rows is not a preference but a data bug.
   */
  private static async demoteOtherHeadquarters(repo: Repository<Site>, tenantId: string, keepSiteId: string): Promise<void> {
    const others = await repo.find({ where: { tenantId, isHeadquarters: true } })
    for (const other of others) {
      if (other.siteId === keepSiteId) continue
      other.isHeadquarters = false
      await repo.save(other)
    }
  }

  /** `legalEntityId` is a bare uuid, but a bad one is a typo, not history. */
  private static async assertLegalEntityExists(qr: { manager: EntityManager }, tenantId: string, legalEntityId: string): Promise<void> {
    const found = await qr.manager.getRepository(LegalEntity).findOne({ where: { tenantId, legalEntityId } })
    if (!found) {
      throw new AppError(ORGANIZATION_MESSAGES.LEGAL_ENTITY_UNKNOWN, 400, ErrorCode.VALIDATION_ERROR)
    }
  }
}
