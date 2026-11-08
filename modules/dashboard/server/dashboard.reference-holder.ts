import { In, Like } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry'
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path'
import type { HeldReferences, ReferenceHolder } from '@kuraykaraaslan-labs/common/server/extensions/reference-holder.contract'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import { DashboardBoard } from './entities/dashboard_board.entity'
import DashboardDisplayLinkService from './display-link.service'
import { deleteOverlaysForBoard, deleteOverlaysForCards } from './card-overlay.cleanup'
import { deleteHomesForBoard } from './user-home'
import { deleteSnapshotsForBoard } from './board-snapshot'

/**
 * `module_lifecycle:reference_holder` for dashboard (docs/phases/37-extensions/06): what dashboard stores that points at
 * a module, for the impact preview before a deactivation or an uninstall and for the orphan report. Three kinds:
 *  - placements of the module's widgets;
 *  - placements of other widgets whose data slots are bound to the module's data sources (`dashboard:data_source`,
 *    `persists: true`);
 *  - boards anchored to the module (`moduleId`: the module's own board).
 * While the module is off all of them stay exactly as they were (re-enabling restores the board) and the board shows its
 * editors a placeholder. `sweep` runs only when the module's data is purged: it removes the module's placements, unbinds
 * only the slots that read the module's data (the widget stays, with its other slots), and deletes the module's boards
 * with what is placed on them.
 */
const LABEL = 'dashboard widgets and boards'
const SAMPLE_SIZE = 5
const CHUNK = 200

/**
 * The widget refs a placement stores for `moduleId`'s widgets: `manifest:<widgetId>` for its own `widgets[]` and
 * `ext:<contribution id>` for its `dashboard:widget` contributions, read from the module registry as the widget catalog
 * does (metadata only, so a disabled module answers too). A contribution id starts with its module's id, so
 * `prefix` also finds the `ext:` placements of a module that is no longer in this build.
 */
export function widgetRefsOf(moduleId: string): { refs: string[]; prefix: string } {
  const refs = [
    ...moduleRegistry.getWidgets().filter((w) => w.moduleId === moduleId).map((w) => `manifest:${w.id}`),
    ...moduleRegistry.getComponentExtensions('dashboard:widget').filter((e) => e.moduleId === moduleId).map((e) => `ext:${e.id}`),
  ]
  return { refs, prefix: `ext:${moduleId}:dashboard:widget:` }
}

/** Which module contributes which data source is process-wide, and read from the manifests (no code is loaded). */
const CATALOG_CTX = systemCtx('dashboard reference holder: which module contributes which data source')

/** The data-source keys `moduleId` contributes; a disabled or unentitled module answers too. */
export async function sourceKeysOf(moduleId: string): Promise<Set<string>> {
  const keys = new Set<string>()
  for (const { contribution } of await ext.states('dashboard:data_source', CATALOG_CTX)) {
    if (contribution.moduleId === moduleId && contribution.key) keys.add(contribution.key)
  }
  return keys
}

type SlotBinding = { sourceKey?: unknown }
const slotsOf = (binding: unknown): Array<[string, SlotBinding]> =>
  binding && typeof binding === 'object'
    ? Object.entries(binding as Record<string, unknown>).filter((e): e is [string, SlotBinding] => !!e[1] && typeof e[1] === 'object')
    : []

/** `binding` without the slots that read one of `keys`; null when nothing is left. */
export function unbind(binding: unknown, keys: ReadonlySet<string>): Record<string, SlotBinding> | null {
  const kept = slotsOf(binding).filter(([, b]) => !(typeof b.sourceKey === 'string' && keys.has(b.sourceKey)))
  return kept.length ? Object.fromEntries(kept) : null
}

type Placement = Pick<DashboardWidgetInstance, 'instanceId' | 'entityType' | 'entityId' | 'widgetRef'>
type Bound = Pick<DashboardWidgetInstance, 'instanceId' | 'entityType' | 'entityId' | 'dataBinding'>
type Board = Pick<DashboardBoard, 'boardId' | 'title'>

/** The tenant's placements of the module's widgets. `Like` narrows the prefix query; the exact prefix is checked here. */
async function placementsOf(tenantId: string, moduleId: string): Promise<Placement[]> {
  if (moduleId === 'dashboard') return [] // dashboard's own widgets go with its own tables
  const { refs, prefix } = widgetRefsOf(moduleId)
  const rows = await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.find({
    where: [
      ...(refs.length ? [{ tenantId, widgetRef: In(refs) }] : []),
      { tenantId, widgetRef: Like(`${prefix}%`) },
    ],
    select: { instanceId: true, entityType: true, entityId: true, widgetRef: true },
  }))
  const wanted = new Set(refs)
  return rows.filter((r) => wanted.has(r.widgetRef) || r.widgetRef.startsWith(prefix))
}

/** Placements of other widgets with a slot bound to one of `keys`; `skip` holds those already counted as the module's. */
async function boundTo(tenantId: string, keys: ReadonlySet<string>, skip: ReadonlySet<string>): Promise<Bound[]> {
  if (keys.size === 0) return []
  const rows = await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.find({
    where: { tenantId },
    select: { instanceId: true, entityType: true, entityId: true, dataBinding: true },
  }))
  return rows.filter((r) => !skip.has(r.instanceId) && slotsOf(r.dataBinding).some(([, b]) => typeof b.sourceKey === 'string' && keys.has(b.sourceKey)))
}

async function referencesOf(tenantId: string, moduleId: string): Promise<{ placements: Placement[]; bound: Bound[]; boards: Board[]; keys: Set<string> }> {
  if (moduleId === 'dashboard') return { placements: [], bound: [], boards: [], keys: new Set() } // its own go with its own tables
  const placements = await placementsOf(tenantId, moduleId)
  const keys = await sourceKeysOf(moduleId)
  const [bound, boards] = await Promise.all([
    boundTo(tenantId, keys, new Set(placements.map((p) => p.instanceId))),
    withTenantRepositoryFor(tenantId, DashboardBoard, (repo) => repo.find({ where: { tenantId, moduleId }, select: { boardId: true, title: true } })),
  ])
  return { placements, bound, boards, keys }
}

const dashboardReferenceHolder: ReferenceHolder = {
  async listReferences(tenantId, moduleId): Promise<HeldReferences> {
    const { placements, bound, boards } = await referencesOf(tenantId, moduleId)
    const count = placements.length + bound.length + boards.length
    if (count === 0) return { label: LABEL, count: 0 }
    // the sample names boards: the module's own first, then those its widgets or data sit on
    const onBoards = [...placements, ...bound].filter((p) => p.entityType === 'DASHBOARD').map((p) => p.entityId)
    const boardIds = [...new Set([...boards.map((b) => b.boardId), ...onBoards])].slice(0, SAMPLE_SIZE)
    const missing = boardIds.filter((id) => !boards.some((b) => b.boardId === id))
    const others = missing.length
      ? await withTenantRepositoryFor(tenantId, DashboardBoard, (repo) => repo.find({ where: { tenantId, boardId: In(missing) }, select: { boardId: true, title: true } }))
      : []
    const titleOf = new Map([...boards, ...others].map((b) => [b.boardId, b.title]))
    return {
      label: LABEL,
      count,
      sample: boardIds.map((id) => ({ id, title: titleOf.get(id) ?? id, href: tenantPath(tenantId, `/admin/dashboards/${id}`) })),
    }
  },

  async sweep(tenantId, moduleId) {
    const { placements, bound, boards, keys } = await referencesOf(tenantId, moduleId)
    let removed = 0
    // A Discard copy taken before the purge would put back what it removes: the copies of every board it touches go first, so no
    // restore can find one once a card is gone (a restore running now holds the copies' lock, and this waits for it).
    const touched = new Set([...placements, ...bound].filter((p) => p.entityType === 'DASHBOARD').map((p) => p.entityId))
    for (const boardId of touched) await withTenantTransactionFor(tenantId, (qr) => deleteSnapshotsForBoard(qr, tenantId, boardId))
    const ids = placements.map((p) => p.instanceId)
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK)
      await deleteOverlaysForCards(tenantId, part)
      const res = await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.delete({ tenantId, instanceId: In(part) }))
      removed += res.affected ?? 0
    }
    for (const p of bound) {
      await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.update({ tenantId, instanceId: p.instanceId }, { dataBinding: unbind(p.dataBinding, keys) }))
      removed += 1
    }
    // As BoardCrudService.remove does (placements, display links, overlays, then the board), without a viewer: the purge runs for the platform.
    for (const b of boards) {
      await withTenantTransactionFor(tenantId, async (qr) => {
        await qr.manager.getRepository(DashboardWidgetInstance).delete({ tenantId, entityType: 'DASHBOARD', entityId: b.boardId })
        await DashboardDisplayLinkService.deleteForBoard(qr, tenantId, b.boardId)
        await deleteOverlaysForBoard(qr, tenantId, b.boardId)
        await deleteHomesForBoard(qr, tenantId, b.boardId)
        await deleteSnapshotsForBoard(qr, tenantId, b.boardId)
        await qr.manager.getRepository(DashboardBoard).delete({ tenantId, boardId: b.boardId })
      })
      removed += 1
    }
    return { removed }
  },
}

export default dashboardReferenceHolder
