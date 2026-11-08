import 'reflect-metadata'
import { type Repository } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizePhoneFields } from '@kuraykaraaslan-labs/common/server/common.phone'
import { resolveTenantCountryStrict } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.country'

/**
 * contact.57 / the same defect here: a national-format switchboard number parsed under a GUESSED tenant
 * country is stored as another country's number. The tenant country is read only when a national number
 * needs it, and strictly (an unreadable setting is a retryable 503, never the platform default).
 */
const hasNationalPhone = (data: Record<string, unknown>): boolean =>
  PHONE_FIELDS.some((f) => typeof data[f] === 'string' && (data[f] as string).trim() !== '' && !(data[f] as string).trim().startsWith('+'))

/** Phone columns on a legal entity, canonicalized to E.164 before every write. */
const PHONE_FIELDS = ['phone'] as const
import { LegalEntity } from './entities/organization_legal_entities.entity'
import { LEGAL_ENTITY_SORTABLE, LEGAL_ENTITY_DEFAULT_SORT, type CreateLegalEntityDTO, type UpdateLegalEntityDTO, type GetLegalEntitiesQuery } from './organization.dto'
import { ORGANIZATION_MESSAGES } from './organization.messages'
import { auditOrganization } from './organization.audit'
import { allocateCode, assertCodeFree, lockTenantKind, resolveCodePrefix } from './organization.code'
import { assertNotReferenced } from './organization.reference-check'
import {
  buildProjection,
  legalEntityFromSettings,
  IMPORTABLE_SETTING_KEYS,
  PROJECTED_SETTING_KEYS,
} from './organization.legal-entity.projection'
import { compactWhere, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query'

/**
 * The tenant's own legal persons.
 *
 * Two methods carry the deduplication contract described in
 * organization.legal-entity.projection.ts:
 *
 *   `projectToSettings`  — write-through onto invoice/terms_consent/payment keys
 *   `importFromSettings` — one-time reverse materialisation on first enable
 */

/** organization.09: a logo is an https URL or a storage key strictly under `<tenantId>/` (no `..`, no absolute path). */
function assertLogoKey(tenantId: string, key: string | null | undefined): void {
  if (key == null || key === '') return
  if (/^https:\/\//i.test(key)) return
  const segs = key.split('/')
  if (key.startsWith('/') || key.includes('\\') || segs[0] !== tenantId || segs.slice(1).some((s) => s === '' || s === '.' || s === '..')) {
    throw new AppError(ORGANIZATION_MESSAGES.LOGO_KEY_INVALID, 422, ErrorCode.VALIDATION_ERROR)
  }
}

export default class LegalEntityService {
  static async list(
    tenantId: string,
    query: GetLegalEntitiesQuery,
  ): Promise<{ data: LegalEntity[]; total: number }> {
    const where = compactWhere({ tenantId, isActive: query.isActive })
    const [data, total] = await withTenantRepositoryFor(tenantId, LegalEntity, (repo) => repo.findAndCount({
      where: searchWhere(where, query.search, ['legalName', 'code']),
      order: toOrder(query.sort ?? LEGAL_ENTITY_DEFAULT_SORT, LEGAL_ENTITY_SORTABLE, { legalEntityId: 'ASC' }),
      skip: query.page * query.pageSize,
      take: query.pageSize,
    }))
    return { data, total }
  }

  static async getById(tenantId: string, legalEntityId: string): Promise<LegalEntity> {
    const row = await withTenantRepositoryFor(tenantId, LegalEntity, (repo) => repo.findOne({ where: { tenantId, legalEntityId } }))
    if (!row) throw new AppError(ORGANIZATION_MESSAGES.LEGAL_ENTITY_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return row
  }

  /** The entity that prints on a document that names none. `null` when unset. */
  static async getDefault(tenantId: string): Promise<LegalEntity | null> {
    return withTenantRepositoryFor(tenantId, LegalEntity, (repo) => repo.findOne({ where: { tenantId, isDefault: true } }))
  }

  static async create(
    tenantId: string,
    data: CreateLegalEntityDTO,
    actorId?: string,
  ): Promise<LegalEntity> {
    // Settings reads (another module) first; then code allocation, the
    // default demotion and the insert commit together under the tenant's
    // legal-entity lock (docs/phases/10-db Faz 3).
    assertLogoKey(tenantId, data.logoStorageKey)
    const prefix = data.code ? null : await resolveCodePrefix(tenantId, 'organizationLegalEntityCodePrefix')
    // The entity's OWN country beats the tenant default here: a Turkish group's
    // German subsidiary has a German switchboard, and its row already says so.
    const input = normalizePhoneFields(
      data, PHONE_FIELDS, data.countryCode || (hasNationalPhone(data as Record<string, unknown>) ? await resolveTenantCountryStrict(tenantId) : undefined),
    )

    let saved: LegalEntity
    let isDefault = false
    try {
      saved = await withTenantTransactionFor(tenantId, async (qr) => {
        await lockTenantKind(qr, tenantId, 'legal_entity')
        const repo = qr.manager.getRepository(LegalEntity)
        const code = data.code ?? (await allocateCode(repo, tenantId, prefix!))
        await assertCodeFree(repo, tenantId, code, 'legalEntityId')

        // The very first entity is the default whether or not the caller said so:
        // a tenant with entities but no default would project nothing downstream.
        const existing = await repo.count({ where: { tenantId } })
        isDefault = !!data.isDefault || existing === 0

        // Demote BEFORE the insert: the partial unique index on
        // `(tenantId) WHERE isDefault` would reject a second flagged row outright.
        if (isDefault) await LegalEntityService.demoteOtherDefaults(repo, tenantId, '')

        return repo.save(
          repo.create({
            ...input,
            code,
            tenantId,
            isDefault,
            countryCode: data.countryCode.toUpperCase(),
          }),
        )
      })
    } catch (error) {
      if (error instanceof AppError) throw error
      Logger.error(`[LegalEntityService.create][tenant:${tenantId}] ${error}`)
      throw new AppError(
        ORGANIZATION_MESSAGES.LEGAL_ENTITY_CREATE_FAILED,
        500,
        ErrorCode.INTERNAL_ERROR,
      )
    }

    auditOrganization(tenantId, actorId, 'organization.legalEntity.created', 'LegalEntity', saved.legalEntityId, {
      code: saved.code,
      legalName: saved.legalName,
      isDefault,
    })
    if (isDefault) await LegalEntityService.projectToSettings(tenantId, saved, actorId)
    return saved
  }

  static async update(
    tenantId: string,
    legalEntityId: string,
    data: UpdateLegalEntityDTO,
    actorId?: string,
  ): Promise<LegalEntity> {
    const fallbackCountry = data.countryCode || !hasNationalPhone(data as Record<string, unknown>) ? null : await resolveTenantCountryStrict(tenantId)
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'legal_entity')
      const repo = qr.manager.getRepository(LegalEntity)
      const row = await repo.findOne({ where: { tenantId, legalEntityId } })
      if (!row) throw new AppError(ORGANIZATION_MESSAGES.LEGAL_ENTITY_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      if (data.code !== undefined && data.code !== row.code) {
        await assertCodeFree(repo, tenantId, data.code, 'legalEntityId', legalEntityId)
      }
      // organization.10: the default is moved by promoting another entity, never by
      // clearing it: a tenant always keeps one default (the projection depends on it).
      if (data.isDefault === false && row.isDefault) {
        throw new AppError(ORGANIZATION_MESSAGES.LEGAL_ENTITY_DEFAULT_REQUIRED, 409, ErrorCode.CONFLICT)
      }
      // organization.09: a storage key lives under this tenant's prefix, with no traversal.
      assertLogoKey(tenantId, data.logoStorageKey)
      // Demote first — the partial unique index refuses two flagged rows.
      if (data.isDefault === true) await LegalEntityService.demoteOtherDefaults(repo, tenantId, legalEntityId)
      Object.assign(row, normalizePhoneFields(
        data, PHONE_FIELDS, data.countryCode || row.countryCode || fallbackCountry || undefined,
      ))
      if (data.countryCode) row.countryCode = data.countryCode.toUpperCase()
      return repo.save(row)
    })
    auditOrganization(tenantId, actorId, 'organization.legalEntity.updated', 'LegalEntity', legalEntityId, {
      changedKeys: Object.keys(data),
    })
    if (saved.isDefault) await LegalEntityService.projectToSettings(tenantId, saved, actorId)
    return saved
  }

  /**
   * Promote one entity to default and project it. The demotion of the previous
   * default happens in `demoteOtherDefaults`, before the partial unique index
   * could ever see two rows flagged at once.
   */
  static async setDefault(
    tenantId: string,
    legalEntityId: string,
    actorId?: string,
  ): Promise<LegalEntity> {
    // Demote + promote in ONE transaction under the tenant lock: before, a
    // failure after the demotion committed left the tenant with no default.
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'legal_entity')
      const repo = qr.manager.getRepository(LegalEntity)
      const row = await repo.findOne({ where: { tenantId, legalEntityId } })
      if (!row) throw new AppError(ORGANIZATION_MESSAGES.LEGAL_ENTITY_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      await LegalEntityService.demoteOtherDefaults(repo, tenantId, legalEntityId)
      row.isDefault = true
      return repo.save(row)
    })
    auditOrganization(tenantId, actorId, 'organization.legalEntity.default_set', 'LegalEntity', legalEntityId, {
      code: saved.code,
    })
    await LegalEntityService.projectToSettings(tenantId, saved, actorId)
    return saved
  }

  /**
   * Soft-remove, after every `organization:reference_check` contribution clears
   * it. The default entity is refused outright: deleting the row the invoice
   * seller is projected from would leave the projection pointing at nothing.
   */
  static async delete(tenantId: string, legalEntityId: string, actorId?: string): Promise<void> {
    const current = await LegalEntityService.getById(tenantId, legalEntityId)
    if (current.isDefault) {
      throw new AppError(ORGANIZATION_MESSAGES.DEFAULT_LEGAL_ENTITY_UNDELETABLE, 409, ErrorCode.CONFLICT)
    }
    // Asks other modules — before the block.
    await assertNotReferenced(tenantId, { kind: 'LEGAL_ENTITY', id: legalEntityId })
    const row = await withTenantTransactionFor(tenantId, async (qr) => {
      await lockTenantKind(qr, tenantId, 'legal_entity')
      const repo = qr.manager.getRepository(LegalEntity)
      const found = await repo.findOne({ where: { tenantId, legalEntityId } })
      if (!found) throw new AppError(ORGANIZATION_MESSAGES.LEGAL_ENTITY_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      // Re-checked under the lock: it may have been made the default meanwhile.
      if (found.isDefault) {
        throw new AppError(ORGANIZATION_MESSAGES.DEFAULT_LEGAL_ENTITY_UNDELETABLE, 409, ErrorCode.CONFLICT)
      }
      // Soft-delete AND deactivate: a five-year-old document may still resolve its
      // label through the lookup service, but no picker may offer it again.
      found.isActive = false
      // organization.35: softRemove writes only deletedAt; the deactivation is persisted first, as the delete promises.
      await repo.save(found)
      await repo.softRemove(found)
      return found
    })
    auditOrganization(tenantId, actorId, 'organization.legalEntity.deleted', 'LegalEntity', legalEntityId, {
      code: row.code,
      legalName: row.legalName,
    })
  }

  // ==========================================================================
  // Settings deduplication (see organization.legal-entity.projection.ts)
  // ==========================================================================

  /**
   * Write the entity onto the 24 legacy `invoice` / `terms_consent` / `payment`
   * keys and lock them.
   *
   * The unlock/write/relock dance is not decoration: `SettingService.updateMany`
   * SILENTLY SKIPS locked keys, so locking after the first projection would make
   * every later projection a no-op — the drift this whole design exists to
   * prevent.
   *
   * Failures are logged, never thrown: a settings hiccup must not roll back a
   * legal-entity edit that already committed. The next save re-projects.
   */
  static async projectToSettings(
    tenantId: string,
    _entity: LegalEntity,
    actorId?: string,
  ): Promise<void> {
    // organization.31: projections are serialised per tenant (their own advisory lock, held for the ~50 settings calls) and
    // each projects the default AS IT IS when its turn comes, re-read under that lock, not the entity its caller saved.
    // Two promotions used to project after their commits and outside any lock: the earlier one's slow projection landed
    // last (or relocked the keys under the later updateMany, which skips locked keys), leaving the invoice seller on the
    // entity that is no longer the default.
    try {
      await withTenantTransactionFor(tenantId, async (qr) => {
        await lockTenantKind(qr, tenantId, 'legal_entity_projection')
        const current = await qr.manager.getRepository(LegalEntity).findOne({ where: { tenantId, isDefault: true } })
        if (current) await LegalEntityService.projectEntity(tenantId, current, actorId)
      })
    } catch (error) {
      Logger.error(`[LegalEntityService.projectToSettings][tenant:${tenantId}] ${error}`)
    }
  }

  private static async projectEntity(
    tenantId: string,
    entity: LegalEntity,
    actorId?: string,
  ): Promise<void> {
    try {
      // organization.33: an unreadable kill switch is "off" (no projection), never "on".
      const enabled = await SettingService.getByKeys(tenantId, [
        'organizationProjectLegalEntityToSettings',
      ]).catch(() => null) as Record<string, unknown> | null
      if (!enabled || typeof enabled !== 'object') return
      const flag = enabled.organizationProjectLegalEntityToSettings
      if (flag !== undefined && flag !== null && typeof flag !== 'string') return
      if (flag === 'false') return

      const values = buildProjection(entity)
      const keys = Object.keys(values)
      const unlocked: string[] = []
      try {
        for (const key of keys) { await SettingService.setLocked(tenantId, key, false); unlocked.push(key) }
        await SettingService.updateMany(tenantId, values, { actorId })
      } finally {
        // organization.13: every key that was unlocked is relocked, whatever failed in between.
        for (const key of unlocked) await SettingService.setLocked(tenantId, key, true).catch(() => {})
      }
    } catch (error) {
      Logger.error(`[LegalEntityService.projectToSettings][tenant:${tenantId}] ${error}`)
    }
  }

  /**
   * One-time reverse materialisation: read the legacy keys and, if this tenant
   * has no legal entity yet, create the first one from them.
   *
   * Idempotent — returns the existing default when there already is one, and
   * `null` when the legacy keys held nothing worth importing.
   */
  static async importFromSettings(tenantId: string, actorId?: string): Promise<LegalEntity | null> {
    const existing = await LegalEntityService.getDefault(tenantId)
    if (existing) return existing

    const anyRow = await withTenantRepositoryFor(tenantId, LegalEntity, (repo) => repo.count({ where: { tenantId } }))
    if (anyRow > 0) return null

    const values = await SettingService.getByKeys(tenantId, [
      ...IMPORTABLE_SETTING_KEYS,
    ]).catch(() => ({}) as Record<string, string>)
    const imported = legalEntityFromSettings(values)
    if (!imported) return null

    return LegalEntityService.create(tenantId, { ...imported, isDefault: true, isActive: true }, actorId)
  }

  /** The keys this module writes through; exposed for the settings UI badge. */
  static projectedSettingKeys(): readonly string[] {
    return PROJECTED_SETTING_KEYS
  }

  // ==========================================================================
  // Invariants
  // ==========================================================================

  /**
   * Keep `isDefault` single-valued per tenant. The partial unique index is the
   * real arbiter; this clears the previous holder first so a promotion never
   * hits it.
   */
  /** On the caller's locked transaction. */
  private static async demoteOtherDefaults(repo: Repository<LegalEntity>, tenantId: string, keepId: string): Promise<void> {
    const others = await repo.find({ where: { tenantId, isDefault: true } })
    for (const other of others) {
      if (other.legalEntityId === keepId) continue
      other.isDefault = false
      await repo.save(other)
    }
  }
}
