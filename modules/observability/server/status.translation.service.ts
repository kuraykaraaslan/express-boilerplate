import 'reflect-metadata'
import { z } from 'zod'
import type { EntityTarget, ObjectLiteral } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages'
import { StatusTranslation } from './entities/status_translation.entity'
import { StatusComponent } from './entities/status_component.entity'
import { StatusComponentGroup } from './entities/status_component_group.entity'
import { StatusPage } from './entities/status_page.entity'
import { Incident } from './entities/incident.entity'
import { IncidentUpdate } from './entities/incident_update.entity'
import { isLocaleCode, normalizeLocale } from './status.page.rules'
import { publishStatusChanged } from './status.realtime'
import { TRANSLATABLE_ENTITY_TYPES } from './status.i18n'

/**
 * Translations of public status text (observability phase 15.7), written by the operator per entity and language. A translation row can
 * only point at something that belongs to this tenant, and never at the primary language (that text IS the source).
 *
 * Incident wording (phase 15 item iv): an incident's title and message and an update's message can be translated, but ONLY while the incident is
 * PUBLIC. A private incident has no public wording to translate (and a private incident shown to a restricted page is always read in the primary
 * language), so the same uniform "Nothing to translate there" answers a private one as an unknown id. The serializer applies the translator to
 * public incidents only, so a row left behind by an incident that was unpublished later is inert.
 */

export const UpsertTranslationDTO = z.object({
  entityType: z.enum(TRANSLATABLE_ENTITY_TYPES),
  entityId: z.string().uuid(),
  locale: z.string().refine(isLocaleCode, 'a language code such as de or pt-br'),
  /** The translated name or title. null / empty clears that field. */
  name: z.string().max(300).nullish(),
  /** The translated description or message. null / empty clears that field. */
  body: z.string().max(2000).nullish(),
})
export type UpsertTranslationInput = z.infer<typeof UpsertTranslationDTO>

export const ListTranslationsQuery = z.object({
  entityType: z.enum(TRANSLATABLE_ENTITY_TYPES).optional(),
  entityId: z.string().uuid().optional(),
})

export default class StatusTranslationService {
  static async list(tenantId: string, q: z.infer<typeof ListTranslationsQuery> = {}): Promise<StatusTranslation[]> {
    const where: Record<string, unknown> = { tenantId }
    if (q.entityType) where.entityType = q.entityType
    if (q.entityId) where.entityId = q.entityId
    return withTenantRepositoryFor(tenantId, StatusTranslation, (repo) => repo.find({ where, order: { entityType: 'ASC', locale: 'ASC' }, take: 2000 }))
  }

  private static async assertEntity(tenantId: string, type: UpsertTranslationInput['entityType'], id: string): Promise<void> {
    const count = async (entity: EntityTarget<ObjectLiteral>, key: string): Promise<number> =>
      withTenantRepositoryFor(tenantId, entity, (repo) => repo.count({ where: { tenantId, [key]: id } }))
    const n = await {
      page: () => count(StatusPage, 'pageId'),
      group: () => count(StatusComponentGroup, 'groupId'),
      component: () => count(StatusComponent, 'componentId'),
      incident: () => withTenantRepositoryFor(tenantId, Incident, (repo) => repo.count({ where: { tenantId, incidentId: id, isPublic: true } })),
      update: async () => {
        const update = await withTenantRepositoryFor(tenantId, IncidentUpdate, (repo) => repo.findOne({ where: { tenantId, updateId: id } }))
        if (!update) return 0
        return withTenantRepositoryFor(tenantId, Incident, (repo) => repo.count({ where: { tenantId, incidentId: update.incidentId, isPublic: true } }))
      },
    }[type]()
    if (n === 0) throw new AppError('Nothing to translate there', 404, ErrorCode.NOT_FOUND)
  }

  /** Create, change or (when both fields end up empty) remove one translation. Returns null after a removal. */
  static async upsert(tenantId: string, input: UpsertTranslationInput): Promise<StatusTranslation | null> {
    const locale = normalizeLocale(input.locale)
    const { defaultLanguage } = await resolveTenantLanguages(tenantId)
    if (locale === normalizeLocale(defaultLanguage)) {
      throw new AppError('The primary language is the source text; translate into another language', 422, ErrorCode.VALIDATION_ERROR)
    }
    await StatusTranslationService.assertEntity(tenantId, input.entityType, input.entityId)
    const name = input.name?.trim() || null
    const body = input.body?.trim() || null
    const saved = await withTenantRepositoryFor(tenantId, StatusTranslation, async (repo) => {
      const where = { tenantId, entityType: input.entityType, entityId: input.entityId, locale }
      const existing = await repo.findOne({ where })
      if (!name && !body) {
        if (existing) await repo.delete({ tenantId, translationId: existing.translationId })
        return null
      }
      if (existing) {
        await repo.update({ tenantId, translationId: existing.translationId }, { name, body })
        return { ...existing, name, body } as StatusTranslation
      }
      return repo.save(repo.create({ ...where, name, body }))
    })
    // Every language of a page is its own snapshot file, so a changed translation is a changed page.
    void publishStatusChanged(tenantId)
    return saved
  }
}
