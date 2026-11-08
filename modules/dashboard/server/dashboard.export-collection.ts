import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts'
import { DashboardBoard } from './entities/dashboard_board.entity'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'

/**
 * `tenant_export:collection` — the tenant's dashboards (15.4e).
 *
 * Boards, the placements on them and the tenant's own widget definitions: the
 * configuration a tenant built. Query results are NOT exported (they are
 * derived from data the owning modules export themselves), and the platform
 * catalogue is not tenant data. Display links (decision #10) are left out on
 * purpose: they are credentials, not configuration, and a restored tenant must not
 * bring screens back to life. Every row is read with the tenant filter on the
 * tenant-scoped repository.
 *
 * PRIVATE boards and widgets (decision #16, 2026-10-18): every user's personal
 * boards are exported, with their placements, because a tenant export is the
 * controller's complete copy (backup, migration). The rows are exported as stored:
 * `scope` / `visibility` and `ownerUserId` are always kept, and `redactPii` masks
 * only the owner, the creator and the personal names, never the scope. There is
 * no restore path for this collection today (`tenant_export` only exports, and
 * dashboards contribute no `data_import:target`). Any restore added later must
 * keep `scope` / `visibility` exactly as exported: a PRIVATE row stays PRIVATE,
 * and a PRIVATE row whose owner cannot be mapped (e.g. `'[redacted]'`) is skipped
 * or kept PRIVATE with no owner (visible to nobody), never turned into TENANT.
 * `dashboard.export-collection.test.ts` pins this.
 */
/**
 * A redacted export (`redactPii`) must not republish who owns or created a board or
 * widget, nor what a personal (PRIVATE) board or widget is called. Structure, ids,
 * scope and geometry stay: the row still proves what is held.
 *
 * The personal names are every column that carries one: a board's `title`, its
 * `slug` (minted from the title, so it is replaced by an id-derived value that stays
 * unique) and its `pages[].title` (the page `key` stays, placements reference it); a
 * widget's display name `label`; and `description` on both.
 */
export function redactDashboardRow<T extends object>(row: T): T {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  for (const key of ['ownerUserId', 'createdByUserId']) {
    if (out[key]) out[key] = '[redacted]'
  }
  const personal = out.scope === 'PRIVATE' || out.visibility === 'PRIVATE'
  if (personal) {
    for (const key of ['title', 'label', 'description']) {
      if (typeof out[key] === 'string') out[key] = '[redacted]'
    }
    if (typeof out.slug === 'string') {
      out.slug = typeof out.boardId === 'string' ? `redacted-${out.boardId}` : '[redacted]'
    }
    if (Array.isArray(out.pages)) {
      out.pages = (out.pages as Array<Record<string, unknown>>).map((page) =>
        page && typeof page === 'object' ? { ...page, title: '[redacted]' } : page,
      )
    }
  }
  return out as T
}

const provider: ExportCollectionProvider = async (
  tenantId: string,
  options?: { redactPii: boolean },
): Promise<ExportCollection[]> => {
  const maybe = <T extends object>(rows: T[]): T[] => (options?.redactPii ? rows.map(redactDashboardRow) : rows)
  const [boards, placements, widgets] = await Promise.all([
    withTenantRepositoryFor(tenantId, DashboardBoard, (repo) => repo.find({ where: { tenantId } })),
    withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.find({ where: { tenantId } })),
    withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => repo.find({ where: { tenantId } })),
  ])
  // A placement has no scope of its own: its title override on a PRIVATE board is
  // as personal as the board's own title, so a redacted export masks it too.
  const privateBoardIds = new Set(boards.filter((b) => b.scope === 'PRIVATE').map((b) => b.boardId))
  const redactPlacement = (row: DashboardWidgetInstance): DashboardWidgetInstance => {
    const out = redactDashboardRow(row)
    // The placement table is a polymorphic surface seam: only a DASHBOARD placement sits on a board.
    const onPrivateBoard = row.entityType === 'DASHBOARD' && privateBoardIds.has(row.entityId)
    if (onPrivateBoard && typeof out.title === 'string') out.title = '[redacted]'
    return out
  }
  return [
    { key: 'dashboardBoards', label: 'Dashboards', rows: maybe(boards) },
    { key: 'dashboardPlacements', label: 'Dashboard widget placements', rows: options?.redactPii ? placements.map(redactPlacement) : placements },
    { key: 'dashboardWidgets', label: 'Dashboard widget definitions', rows: maybe(widgets) },
  ]
}

export default provider
