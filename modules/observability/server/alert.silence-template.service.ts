import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { AlertSilenceTemplate } from './entities/alert_silence_template.entity'
import AlertSilenceService from './alert.silence.service'
import { assertEditable } from './config/config.managed'
import type { AlertSilence } from './entities/alert_silence.entity'

export interface SilenceTemplateInput { name: string; matchers: unknown[]; durationMinutes: number; reason: string }

/**
 * Silence templates (observability phase 21): a named, reusable silence that lives in a repository. A template mutes nothing; `start`
 * creates a normal time-bound silence from it through the same service as the console, so every rule of a silence (at least one matcher, at
 * most 30 days, a reason) still applies and the silence shows up in the usual list.
 */
export default class AlertSilenceTemplateService {
  static async list(tenantId: string): Promise<AlertSilenceTemplate[]> {
    return withTenantRepositoryFor(tenantId, AlertSilenceTemplate, (repo) => repo.find({ where: { tenantId }, order: { name: 'ASC' } }))
  }

  static async create(tenantId: string, input: SilenceTemplateInput, managed?: { managedBy: string; sourceKey: string | null }): Promise<AlertSilenceTemplate> {
    return withTenantRepositoryFor(tenantId, AlertSilenceTemplate, (repo) => repo.save(repo.create({
      tenantId, name: input.name, matchers: input.matchers, durationMinutes: input.durationMinutes, reason: input.reason,
      ...(managed ? { managedBy: managed.managedBy, sourceKey: managed.sourceKey } : {}),
    })))
  }

  static async update(tenantId: string, templateId: string, input: Partial<SilenceTemplateInput>): Promise<AlertSilenceTemplate> {
    const row = await withTenantRepositoryFor(tenantId, AlertSilenceTemplate, (repo) => repo.findOne({ where: { tenantId, templateId } }))
    if (!row) throw new AppError('Silence template not found', 404, ErrorCode.NOT_FOUND)
    assertEditable(row, 'silence template')
    Object.assign(row, input)
    return withTenantRepositoryFor(tenantId, AlertSilenceTemplate, (repo) => repo.save(row))
  }

  static async remove(tenantId: string, templateId: string): Promise<void> {
    assertEditable(await withTenantRepositoryFor(tenantId, AlertSilenceTemplate, (repo) => repo.findOne({ where: { tenantId, templateId } })), 'silence template')
    const r = await withTenantRepositoryFor(tenantId, AlertSilenceTemplate, (repo) => repo.delete({ tenantId, templateId }))
    if (!r.affected) throw new AppError('Silence template not found', 404, ErrorCode.NOT_FOUND)
  }

  /** Start the template now: a silence of its length, with its matchers and reason (the reason may be replaced by whoever starts it). */
  static async start(tenantId: string, templateId: string, userId: string | null, overrides: { durationMinutes?: number; reason?: string } = {}): Promise<AlertSilence> {
    const t = await withTenantRepositoryFor(tenantId, AlertSilenceTemplate, (repo) => repo.findOne({ where: { tenantId, templateId } }))
    if (!t) throw new AppError('Silence template not found', 404, ErrorCode.NOT_FOUND)
    return AlertSilenceService.create(tenantId, {
      matchers: t.matchers as never, durationMinutes: overrides.durationMinutes ?? t.durationMinutes, reason: overrides.reason ?? t.reason,
    }, userId)
  }
}
