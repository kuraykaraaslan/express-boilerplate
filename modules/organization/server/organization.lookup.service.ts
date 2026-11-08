import 'reflect-metadata'
import { In, type EntityTarget, type FindOptionsWhere, type ObjectLiteral } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { LegalEntity } from './entities/organization_legal_entities.entity'
import { Site } from './entities/organization_sites.entity'
import { CostCenter } from './entities/organization_cost_centers.entity'
import { OrganizationTeam } from './entities/organization_teams.entity'
import type { OrganizationRefKind } from './organization.enums'
import type { OrganizationLabelMap, OrganizationOption } from './organization.types'

interface CatalogSpec {
  target: EntityTarget<ObjectLiteral>
  /** Primary-key column name, which is also the id other modules store. */
  pk: string
  /** Column carrying the human name (`legalName` on the legal entity). */
  nameColumn: string
}

/** The single place that maps a reference kind onto its table. */
const CATALOGS: Record<OrganizationRefKind, CatalogSpec> = {
  LEGAL_ENTITY: { target: LegalEntity, pk: 'legalEntityId', nameColumn: 'legalName' },
  SITE: { target: Site, pk: 'siteId', nameColumn: 'name' },
  COST_CENTER: { target: CostCenter, pk: 'costCenterId', nameColumn: 'name' },
  TEAM: { target: OrganizationTeam, pk: 'teamId', nameColumn: 'name' },
}

/** Hard ceiling on a picker payload — a `<Select>` past this needs a search box. */
const OPTIONS_LIMIT = 500

const labelOf = (code: string, name: string): string => `${code} — ${name}`

/**
 * Batch label/option resolver for the organization master data.
 *
 * This exists to kill the repo's "raw uuid in a list column" habit: a consumer
 * (hr's employee table, accounting's journal lines, inventory's stock items)
 * holds `siteId` / `costCenterId` uuids but must not import this module's
 * entities to render them. It sends the ids it has and gets back display
 * strings, in ONE round trip per page instead of one per row.
 */
export default class OrganizationLookupService {
  /**
   * `"<kind>:<id>" -> "<code> — <name>"` for every id that resolves. Ids that do
   * not exist (or belong to another tenant) are simply absent from the map, so
   * the caller can fall back to its own placeholder without a second request.
   *
   * SOFT-DELETED rows are resolved too (`withDeleted: true`). That is the whole
   * point of never hard-deleting a site or a cost center: a five-year-old
   * journal line keeps rendering "SAT — Satış" long after the cost center was
   * retired, instead of showing a raw uuid or a broken label.
   */
  static async resolveLabels(
    tenantId: string,
    refs: { kind: OrganizationRefKind; ids: string[] }[],
  ): Promise<OrganizationLabelMap> {
    const labels: OrganizationLabelMap = {}
    if (refs.length === 0) return labels

    for (const ref of refs) {
      const ids = [...new Set(ref.ids)]
      if (ids.length === 0) continue
      const spec = CATALOGS[ref.kind]
      try {
        // Each catalog its own block; the degrading catch sits outside it.
        const rows = await withTenantRepositoryFor(tenantId, spec.target, (repo) => repo.find({
          where: { tenantId, [spec.pk]: In(ids) } as FindOptionsWhere<ObjectLiteral>,
          withDeleted: true,
        }))
        for (const row of rows) {
          labels[`${ref.kind}:${row[spec.pk] as string}`] = labelOf(
            row.code as string,
            row[spec.nameColumn] as string,
          )
        }
      } catch (error) {
        // A label is decoration: a failed lookup must degrade to the raw id in
        // the caller's UI, never fail the page that asked for it.
        Logger.error(
          `[OrganizationLookupService.resolveLabels][tenant:${tenantId}][${ref.kind}] ${error}`,
        )
      }
    }
    return labels
  }

  /**
   * Active rows of one catalog as `{ id, code, name }`, ordered by code — the
   * exact shape a `<Select>` needs. Inactive and soft-deleted rows are excluded
   * on purpose: a picker offers what may be chosen NOW, while `resolveLabels`
   * still resolves historic ids.
   */
  static async options(
    tenantId: string,
    kind: OrganizationRefKind,
  ): Promise<OrganizationOption[]> {
    const spec = CATALOGS[kind]
    const rows = await withTenantRepositoryFor(tenantId, spec.target, (repo) => repo.find({
      where: { tenantId, isActive: true } as FindOptionsWhere<ObjectLiteral>,
      order: { code: 'ASC' },
      take: OPTIONS_LIMIT,
    }))
    return rows.map((row) => ({
      id: row[spec.pk] as string,
      code: row.code as string,
      name: row[spec.nameColumn] as string,
    }))
  }
}
