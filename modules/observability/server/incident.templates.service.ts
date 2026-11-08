import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { IncidentUpdateTemplate } from './entities/incident_update_template.entity'
import { UpsertTemplateDTO, RenderTemplateDTO, type UpsertTemplateInput, type RenderTemplateInput } from './incident.dto'
import { assertEditable } from './config/config.managed'
import { DEFAULT_UPDATE_TEMPLATES, pickTemplate, renderTemplate } from './incident.templates'

export { UpsertTemplateDTO, RenderTemplateDTO, type UpsertTemplateInput, type RenderTemplateInput }

export default class IncidentTemplateService {
  /** The tenant's overrides plus the defaults, so the screen can show what would be used for every status. */
  static async list(tenantId: string): Promise<{ overrides: IncidentUpdateTemplate[]; defaults: Record<string, string> }> {
    const overrides = await withTenantRepositoryFor(tenantId, IncidentUpdateTemplate, (repo) => repo.find({ where: { tenantId }, order: { status: 'ASC', locale: 'ASC' } }))
    return { overrides, defaults: DEFAULT_UPDATE_TEMPLATES }
  }

  static async upsert(tenantId: string, input: UpsertTemplateInput, managed?: { managedBy: string }): Promise<IncidentUpdateTemplate> {
    return withTenantRepositoryFor(tenantId, IncidentUpdateTemplate, async (repo) => {
      const existing = await repo.findOne({ where: { tenantId, status: input.status, locale: input.locale } })
      if (existing) { assertEditable(existing, 'incident update template'); existing.body = input.body; if (managed) existing.managedBy = managed.managedBy; return repo.save(existing) }
      return repo.save(repo.create({ tenantId, status: input.status, locale: input.locale, body: input.body, ...(managed ? { managedBy: managed.managedBy } : {}) }))
    })
  }

  static async remove(tenantId: string, templateId: string): Promise<void> {
    assertEditable(await withTenantRepositoryFor(tenantId, IncidentUpdateTemplate, (repo) => repo.findOne({ where: { tenantId, templateId } })), 'incident update template')
    const r = await withTenantRepositoryFor(tenantId, IncidentUpdateTemplate, (repo) => repo.delete({ tenantId, templateId }))
    if (!r.affected) throw new AppError('Template not found', 404, ErrorCode.NOT_FOUND)
  }

  /** The text to put in the public update box for this status and language, with the incident's details filled in. */
  static async render(tenantId: string, input: RenderTemplateInput): Promise<string> {
    const { overrides } = await IncidentTemplateService.list(tenantId)
    const body = pickTemplate(input.status, input.locale, overrides) ?? ''
    return renderTemplate(body, input)
  }
}
