import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DashboardCardOverlay } from './entities/dashboard_card_overlay.entity'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import DashboardInstanceService from './instance.crud.service'
import { assertSettingsSize } from './placement-settings'
import { MAX_OVERLAYS_PER_CARD, MAX_PATCH_DEPTH, applyMergePatch, createMergePatch, jsonDepth, type CardSubject } from './card-overlay'
import MSG from './dashboard.messages'
import { markSnapshotsChanged, markSurfaceChanged } from './board-snapshot'

/** What a viewer reads of one overlay. */
export interface CardOverlayView {
  instanceId: string
  settings: Record<string, unknown>
  title: string | null
  revision: number
  updatedAt: string
}

export const toCardOverlayView = (o: DashboardCardOverlay): CardOverlayView => ({
  instanceId: o.instanceId,
  settings: o.settings ?? {},
  title: o.title ?? null,
  revision: o.revision,
  updatedAt: (o.updatedAt instanceof Date ? o.updatedAt : new Date(o.updatedAt)).toISOString(),
})

/**
 * Card overlays (docs/phases/07-dashboard/38, E38-7..E38-12). Who may read or write them, and whether the subject exists, is the route's
 * call (the board's access, the subject's entity type); this service keeps the rows and judges a write the way a card's settings edit
 * is judged (`DashboardInstanceService.overlaySettings`). Every read and write is tenant-scoped (RLS).
 */
export default class DashboardCardOverlayService {
  /** A subject's overlays on one board's cards. */
  static async listForSubject(tenantId: string, boardId: string, subject: CardSubject): Promise<DashboardCardOverlay[]> {
    return withTenantRepositoryFor(tenantId, DashboardCardOverlay, (repo) => repo.find({
      where: { tenantId, boardId, subjectType: subject.type, subjectId: subject.id },
      order: { instanceId: 'ASC' },
    }))
  }

  /** The subjects that have an overlay on a board (the editor marks them; a viewer skips the read for a board without any). */
  static async subjectsOnBoard(tenantId: string, boardId: string): Promise<CardSubject[]> {
    const rows = await withTenantRepositoryFor(tenantId, DashboardCardOverlay, (repo) => repo.find({
      where: { tenantId, boardId },
      select: { subjectType: true, subjectId: true },
      order: { subjectType: 'ASC', subjectId: 'ASC' },
    }))
    const seen = new Map<string, CardSubject>()
    for (const r of rows) seen.set(`${r.subjectType}:${r.subjectId}`, { type: r.subjectType, id: r.subjectId })
    return [...seen.values()]
  }

  /**
   * Sets a card's settings and title for a subject. `settings` is the merge patch the editor sends (the card's settings as the subject
   * should see them, as a patch on the card's own); the settings it yields are judged as a settings edit of the card, and what is stored
   * is the smallest patch from the card's settings to the judged ones (so a no-op patch stores `{}`). `expectedRevision` (absent for a
   * new overlay) must match the stored one. Returns the overlay and the top-level keys it changes.
   */
  static async set(
    tenantId: string,
    instance: Pick<DashboardWidgetInstance, 'instanceId' | 'entityId'>,
    subject: CardSubject,
    input: { settings: Record<string, unknown>; title?: string | null; expectedRevision?: number },
    userId: string,
  ): Promise<{ overlay: DashboardCardOverlay; keys: string[] }> {
    if (jsonDepth(input.settings) > MAX_PATCH_DEPTH) throw new AppError(MSG.OVERLAY_PATCH_INVALID, 422, ErrorCode.VALIDATION_ERROR)
    return withTenantTransactionFor(tenantId, async (qr) => {
      const row = await qr.manager.getRepository(DashboardWidgetInstance).findOne({ where: { tenantId, instanceId: instance.instanceId } })
      if (!row) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      const repo = qr.manager.getRepository(DashboardCardOverlay)
      // one writer per card and subject at a time: the revision check and the insert of a first overlay must not race
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:overlay:${row.instanceId}:${subject.type}:${subject.id}`])
      const stored = await repo.findOne({ where: { tenantId, instanceId: row.instanceId, subjectType: subject.type, subjectId: subject.id } })
      if (stored ? input.expectedRevision !== undefined && input.expectedRevision !== stored.revision : input.expectedRevision !== undefined && input.expectedRevision !== 0) {
        throw new AppError(MSG.OVERLAY_CONFLICT, 409, ErrorCode.CONFLICT, { details: { revision: stored?.revision ?? 0 } })
      }
      if (!stored && await repo.count({ where: { tenantId, instanceId: row.instanceId } }) >= MAX_OVERLAYS_PER_CARD) {
        throw new AppError(MSG.OVERLAY_TOO_MANY, 422, ErrorCode.VALIDATION_ERROR)
      }
      const base = (row.settings ?? {}) as Record<string, unknown>
      const judged = await DashboardInstanceService.overlaySettings(qr, tenantId, row, applyMergePatch(base, input.settings), input.settings)
      const patch = createMergePatch(base, judged)
      assertSettingsSize(patch)
      // The Discard copies are marked with the write (after the board's read above, the order a restore takes them).
      await markSurfaceChanged(qr, tenantId, row, userId)
      const title = input.title === undefined ? (stored?.title ?? null) : (input.title?.trim() || null)
      const next = stored
        ? Object.assign(stored, { settings: patch, title, revision: stored.revision + 1, updatedByUserId: userId })
        : repo.create({ tenantId, boardId: row.entityId, instanceId: row.instanceId, subjectType: subject.type, subjectId: subject.id, settings: patch, title, revision: 1, updatedByUserId: userId })
      const saved = await repo.save(next)
      return { overlay: saved, keys: Object.keys(patch).sort() }
    })
  }

  /**
   * Takes a card's overlay for a subject away (the card shows the board's settings for it again). False when there was none. `userId`
   * (null: not known) is who resets it, for the board's Discard copies, marked on this transaction.
   */
  static async reset(tenantId: string, instanceId: string, subject: CardSubject, userId: string | null = null): Promise<boolean> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardCardOverlay)
      const where = { tenantId, instanceId, subjectType: subject.type, subjectId: subject.id }
      const stored = await repo.findOne({ where })
      if (!stored) return false
      await markSnapshotsChanged(qr, tenantId, stored.boardId, userId)
      const res = await repo.delete(where)
      return (res.affected ?? 0) > 0
    })
  }
}
