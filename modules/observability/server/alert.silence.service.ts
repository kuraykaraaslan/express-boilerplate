import 'reflect-metadata'
import { MoreThan } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { AlertSilence } from './entities/alert_silence.entity'
import AlertService from './alert.service'
import { MAX_SILENCE_MINUTES, type CreateSilenceInput } from './alert.dto'

/**
 * Silences (observability phase 11). A silence mutes the ANNOUNCEMENT of matching alerts; the alerts are still stored (SUPPRESSED, with
 * the silence named as the reason) and come back by themselves when it ends. Creating or ending one re-evaluates what is open right now.
 */
export default class AlertSilenceService {
  static async list(tenantId: string, opts: { includeExpired?: boolean } = {}): Promise<AlertSilence[]> {
    return withTenantRepositoryFor(tenantId, AlertSilence, (repo) => repo.find({
      where: opts.includeExpired ? { tenantId } : { tenantId, endsAt: MoreThan(new Date()) },
      order: { endsAt: 'DESC' }, take: 200,
    }))
  }

  static async create(tenantId: string, input: CreateSilenceInput, userId: string | null): Promise<AlertSilence> {
    const startsAt = input.startsAt ?? new Date()
    const endsAt = input.endsAt ?? new Date(startsAt.getTime() + (input.durationMinutes as number) * 60_000)
    if (endsAt.getTime() <= startsAt.getTime()) throw new AppError('A silence must end after it starts', 400, ErrorCode.VALIDATION_ERROR)
    if (endsAt.getTime() - startsAt.getTime() > MAX_SILENCE_MINUTES * 60_000) {
      throw new AppError('A silence may last at most 30 days', 400, ErrorCode.VALIDATION_ERROR)
    }
    if (endsAt.getTime() <= Date.now()) throw new AppError('A silence cannot end in the past', 400, ErrorCode.VALIDATION_ERROR)
    const row = await withTenantRepositoryFor(tenantId, AlertSilence, (repo) => repo.save(repo.create({
      tenantId, matchers: input.matchers, startsAt, endsAt, createdBy: userId, reason: input.reason,
    })))
    await AlertService.reevaluate(tenantId)
    return row
  }

  /** End a silence now. Expiring an expired or unknown one is a quiet no-op for the first and a 404 for the second. */
  static async expire(tenantId: string, silenceId: string): Promise<AlertSilence> {
    const row = await withTenantRepositoryFor(tenantId, AlertSilence, (repo) => repo.findOne({ where: { tenantId, silenceId } }))
    if (!row) throw new AppError('Silence not found', 404, ErrorCode.NOT_FOUND)
    if (new Date(row.endsAt).getTime() > Date.now()) {
      row.endsAt = new Date()
      await withTenantRepositoryFor(tenantId, AlertSilence, (repo) => repo.save(row))
      await AlertService.reevaluate(tenantId)
    }
    return row
  }
}
