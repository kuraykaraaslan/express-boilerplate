import 'reflect-metadata'
import { In, type QueryRunner } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { StatusComponent } from './entities/status_component.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import { StatusPage } from './entities/status_page.entity'
import { Monitor } from './entities/monitor.entity'
import { publishStatusChanged } from './status.realtime'
import StatusGroupService from './status.group.service'
import { runStatusAutomation } from './status.automation.hook'
import type { ComponentStatus, MonitorStatus } from './uptime.enums'
import { assertEditable } from './config/config.managed'
import { emitObservabilityEvent } from './observability.events'

/**
 * Customer-facing status components (phase 2): the monitor → component
 * translation. A customer asks "is the API up", never "is monitor #7 DOWN".
 *
 * Derivation is PURE (`deriveComponentStatus`) and runs on every monitor
 * state transition. `MAINTENANCE` is operator-set and derivation never
 * overwrites it — planned downtime must not flap with probe results.
 */

/**
 * Worst-of rule over the linked monitors' debounced statuses:
 *  - every monitor DOWN → MAJOR_OUTAGE (the whole component is gone)
 *  - some (not all) DOWN → PARTIAL_OUTAGE
 *  - any DEGRADED → DEGRADED
 *  - otherwise OPERATIONAL
 * UNKNOWN monitors (never probed yet) don't vote — a fresh monitor must not
 * drag a healthy component down. No linked monitors → OPERATIONAL.
 */
export function deriveComponentStatus(monitorStatuses: MonitorStatus[]): Exclude<ComponentStatus, 'MAINTENANCE'> {
  const known = monitorStatuses.filter((s) => s !== 'UNKNOWN')
  if (known.length === 0) return 'OPERATIONAL'
  const down = known.filter((s) => s === 'DOWN').length
  if (down === known.length) return 'MAJOR_OUTAGE'
  if (down > 0) return 'PARTIAL_OUTAGE'
  if (known.some((s) => s === 'DEGRADED')) return 'DEGRADED'
  return 'OPERATIONAL'
}

export interface ComponentWithMonitors extends StatusComponent {
  monitorIds: string[]
}

/** The component row, LOCKED — the serialisation point for its status and its monitor links. */
async function lockComponent(qr: QueryRunner, tenantId: string, componentId: string): Promise<StatusComponent> {
  const row = await qr.manager.getRepository(StatusComponent).findOne({
    where: { tenantId, componentId },
    lock: { mode: 'pessimistic_write' },
  })
  if (!row) throw new AppError('Status component not found', 404, ErrorCode.NOT_FOUND)
  return row
}

/** Replace a component's monitor links on the caller's transaction (component locked). */
async function replaceMonitors(qr: QueryRunner, tenantId: string, componentId: string, monitorIds: string[]): Promise<void> {
  const unique = [...new Set(monitorIds)]
  if (unique.length) {
    const owned = await qr.manager.getRepository(Monitor).count({ where: { tenantId, monitorId: In(unique) } })
    if (owned !== unique.length) {
      throw new AppError('One or more monitors do not exist', 400, ErrorCode.VALIDATION_ERROR)
    }
  }
  const linkRepo = qr.manager.getRepository(StatusComponentMonitor)
  await linkRepo.delete({ tenantId, componentId })
  if (unique.length) {
    await linkRepo.save(unique.map((monitorId) => linkRepo.create({ tenantId, componentId, monitorId })))
  }
}

/**
 * Re-derive a component's status from its monitors on the caller's
 * transaction, with the component LOCKED. Writes only `status`, and never over
 * MAINTENANCE: a probe-driven recompute used to save the whole component read
 * before the operator's edit — reverting a rename, or flipping a component the
 * operator had just put into MAINTENANCE back to OPERATIONAL mid-window.
 * Returns true when the status changed.
 */
async function recomputeLocked(qr: QueryRunner, tenantId: string, componentId: string): Promise<boolean> {
  const row = await qr.manager.getRepository(StatusComponent).findOne({
    where: { tenantId, componentId },
    lock: { mode: 'pessimistic_write' },
  })
  if (!row || row.status === 'MAINTENANCE') return false
  const links = await qr.manager.getRepository(StatusComponentMonitor).find({ where: { tenantId, componentId } })
  let statuses: MonitorStatus[] = []
  if (links.length) {
    const monitors = await qr.manager.getRepository(Monitor).find({
      where: { tenantId, monitorId: In(links.map((l) => l.monitorId)) },
    })
    statuses = monitors.map((m) => m.lastStatus as MonitorStatus)
  }
  const next = deriveComponentStatus(statuses)
  if (next === row.status) return false
  await qr.manager.getRepository(StatusComponent).update({ tenantId, componentId }, { status: next })
  return true
}

export default class StatusComponentService {
  static async list(tenantId: string): Promise<ComponentWithMonitors[]> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const components = await qr.manager.getRepository(StatusComponent).find({
        where: { tenantId },
        order: { order: 'ASC', createdAt: 'ASC' },
      })
      if (components.length === 0) return []
      const links = await qr.manager.getRepository(StatusComponentMonitor).find({
        where: { tenantId, componentId: In(components.map((c) => c.componentId)) },
      })
      return components.map((c) => Object.assign(c, {
        monitorIds: links.filter((l) => l.componentId === c.componentId).map((l) => l.monitorId),
      }))
    })
  }

  static async getById(tenantId: string, componentId: string): Promise<ComponentWithMonitors> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const row = await qr.manager.getRepository(StatusComponent).findOne({ where: { tenantId, componentId } })
      if (!row) throw new AppError('Status component not found', 404, ErrorCode.NOT_FOUND)
      const links = await qr.manager.getRepository(StatusComponentMonitor).find({ where: { tenantId, componentId } })
      return Object.assign(row, { monitorIds: links.map((l) => l.monitorId) })
    })
  }

  static async create(
    tenantId: string,
    data: {
      name: string; description?: string | null; order?: number; isPublic?: boolean; monitorIds?: string[]; managedBy?: string | null; sourceKey?: string | null
      groupId?: string | null; showUptime?: boolean; showHistory?: boolean; showRegions?: boolean; showResponseTime?: boolean
    },
  ): Promise<ComponentWithMonitors> {
    await StatusGroupService.assertOwned(tenantId, data.groupId)
    // Component + its links + the derived status in ONE transaction: a bad
    // monitor id no longer leaves a half-created component behind.
    const componentId = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(StatusComponent)
      const row = await repo.save(repo.create({
        tenantId,
        name: data.name,
        description: data.description ?? null,
        order: data.order ?? 0,
        isPublic: data.isPublic ?? true,
        groupId: data.groupId ?? null,
        showUptime: data.showUptime ?? true,
        showHistory: data.showHistory ?? true,
        showRegions: data.showRegions ?? false,
        showResponseTime: data.showResponseTime ?? false,
        status: 'OPERATIONAL',
        ...(data.managedBy ? { managedBy: data.managedBy, sourceKey: data.sourceKey ?? null } : {}),
      }))
      if (data.monitorIds?.length) {
        await replaceMonitors(qr, tenantId, row.componentId, data.monitorIds)
        await recomputeLocked(qr, tenantId, row.componentId)
      }
      return row.componentId
    })
    void publishStatusChanged(tenantId)
    return StatusComponentService.getById(tenantId, componentId)
  }

  static async update(
    tenantId: string,
    componentId: string,
    data: {
      name?: string; description?: string | null; order?: number; isPublic?: boolean
      status?: ComponentStatus; monitorIds?: string[]
      groupId?: string | null; showUptime?: boolean; showHistory?: boolean; showRegions?: boolean; showResponseTime?: boolean
    },
  ): Promise<ComponentWithMonitors> {
    let statusBefore: string | undefined
    await StatusGroupService.assertOwned(tenantId, data.groupId)
    await withTenantTransactionFor(tenantId, async (qr) => {
      const row = await lockComponent(qr, tenantId, componentId)
      statusBefore = row.status
      // A code-managed component changes through an apply; its operator-set MAINTENANCE status is state, not definition.
      assertEditable(row, 'status component', data as Record<string, unknown>, ['status'])
      const { monitorIds, ...patch } = data
      const leavingMaintenance = patch.status !== undefined
        && row.status === 'MAINTENANCE' && patch.status !== 'MAINTENANCE'
      if (Object.keys(patch).length) {
        await qr.manager.getRepository(StatusComponent).update({ tenantId, componentId }, patch)
      }
      if (monitorIds !== undefined) {
        await replaceMonitors(qr, tenantId, componentId, monitorIds)
      }
      // Re-derive when the link set changed, or when maintenance just ended
      // (the operator's OPERATIONAL guess yields to what the probes actually say).
      if (monitorIds !== undefined || leavingMaintenance) {
        await recomputeLocked(qr, tenantId, componentId)
      }
    })
    void publishStatusChanged(tenantId)
    const updated = await StatusComponentService.getById(tenantId, componentId)
    if (data.status !== undefined && updated.status !== statusBefore) StatusComponentService.announce(tenantId, updated, statusBefore ?? null)
    return updated
  }

  /** `status.component_changed` (phase 21.5): fire-and-forget, identifiers and states only. */
  private static announce(tenantId: string, c: Pick<StatusComponent, 'componentId' | 'name' | 'status' | 'isPublic'>, previousStatus: string | null): void {
    emitObservabilityEvent(tenantId, 'status.component_changed', { componentId: c.componentId, name: c.name, status: c.status, previousStatus, isPublic: c.isPublic })
  }

  /**
   * Delete a component, its monitor links, and its id from every page of the tenant that lists it. A page keeps an explicit component list
   * (`componentIds`), and the page update refuses an id that does not exist: a stale id left behind made every later save of that page a 400.
   */
  static async remove(tenantId: string, componentId: string): Promise<void> {
    await withTenantTransactionFor(tenantId, async (qr) => {
      assertEditable(await qr.manager.getRepository(StatusComponent).findOne({ where: { tenantId, componentId } }), 'status component')
      await qr.manager.getRepository(StatusComponentMonitor).delete({ tenantId, componentId })
      await qr.manager.getRepository(StatusComponent).delete({ tenantId, componentId })
      const pageRepo = qr.manager.getRepository(StatusPage)
      const pages = await pageRepo.find({ where: { tenantId }, select: { pageId: true, componentIds: true } })
      for (const page of pages) {
        if (!page.componentIds?.includes(componentId)) continue
        await pageRepo.update({ tenantId, pageId: page.pageId }, { componentIds: page.componentIds.filter((id) => id !== componentId) })
      }
    })
    void publishStatusChanged(tenantId)
  }

  static async setMonitors(tenantId: string, componentId: string, monitorIds: string[]): Promise<void> {
    // Delete + insert on the locked component: two concurrent saves of the
    // link list used to interleave into duplicates (or a unique violation).
    await withTenantTransactionFor(tenantId, async (qr) => {
      assertEditable(await lockComponent(qr, tenantId, componentId), 'status component')
      await replaceMonitors(qr, tenantId, componentId, monitorIds)
    })
  }

  static async recompute(tenantId: string, componentId: string): Promise<void> {
    let before: string | null = null
    const changed = await withTenantTransactionFor(tenantId, async (qr) => {
      before = (await qr.manager.getRepository(StatusComponent).findOne({ where: { tenantId, componentId } }))?.status ?? null
      return recomputeLocked(qr, tenantId, componentId)
    })
    if (changed) {
      void publishStatusChanged(tenantId)
      const now = await StatusComponentService.getById(tenantId, componentId).catch(() => null)
      if (now) StatusComponentService.announce(tenantId, now, before)
      // Auto-post and auto-resolve templates (phase 15.10): never awaited, never able to fail the probe that caused the change.
      runStatusAutomation(tenantId, componentId)
    }
  }

  static async recomputeForMonitor(tenantId: string, monitorId: string): Promise<void> {
    try {
      const links = await withTenantRepositoryFor(tenantId, StatusComponentMonitor, (repo) =>
        repo.find({ where: { tenantId, monitorId } }))
      for (const link of links) {
        await StatusComponentService.recompute(tenantId, link.componentId)
      }
    } catch (err) {
      // A failed status-page refresh must never fail the probe that caused it.
      Logger.warn(`[observability] component recompute failed for monitor ${monitorId}: ${err}`)
    }
  }
}
