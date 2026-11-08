import 'reflect-metadata'
import { In, IsNull, LessThan, Not } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { StatusComponent } from './entities/status_component.entity'
import { StatusComponentGroup } from './entities/status_component_group.entity'
import { StatusTranslation } from './entities/status_translation.entity'
import { Incident } from './entities/incident.entity'
import { IncidentUpdate } from './entities/incident_update.entity'
import StatusPageService, { type StatusPageSpec } from './status.page.service'
import StatusHistoryService from './status.history.service'
import { buildDayBars, type DayBar } from './status.history'
import { incidentTouchesPage, visibleComponents, type StatusTheme } from './status.page.rules'
import { availableLanguages, isRtl, makeTranslator, pickLanguage, type Translator } from './status.i18n'
import StatusUptimeService, { type UptimeWindows } from './status.uptime.service'
import StatusRegionService, { type PublicRegion } from './status.region.service'
import StatusLatencyService from './status.latency.service'
import type { LatencySeries } from './uptime.latency-buckets'
import { listMaintenanceForStatus, type BridgedMaintenanceWindow } from './status.maintenance.bridge'
import { loadStatusBranding, type StatusBranding } from './status.branding'
import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages'
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys'
import type { ComponentStatus } from './uptime.enums'

/**
 * The public status page's ONE serializer (phase 3). Everything the internet
 * may see of a tenant's health is built here, allowlist-first: fields are
 * copied one by one into plain objects, never spread from entities — a
 * monitor name, target or header can not leak through a field nobody
 * remembered to omit, because nothing is emitted that is not written below.
 *
 * `statusPageEnabled` is OFF by default (locked decision) and this service
 * 404s when it is off — indistinguishable from a tenant that has no page.
 */

export interface PublicIncidentUpdate {
  status: string
  publicMessage: string
  createdAt: Date
}

export interface PublicIncident {
  incidentId: string
  title: string
  severity: string
  startedAt: Date
  resolvedAt: Date | null
  publicMessage: string | null
  affectedComponentIds: string[]
  updates: PublicIncidentUpdate[]
}

export interface PublicComponent {
  componentId: string
  name: string
  description: string | null
  status: string
  uptime: UptimeWindows
}

export interface PublicStatus {
  overall: ComponentStatus
  components: PublicComponent[]
  /** Allowlisted tenant chrome; `null` when nothing is configured. */
  branding?: StatusBranding | null
  activeIncidents: PublicIncident[]
  recentIncidents: PublicIncident[]
  /**
   * Read through the tenant bridge (single source: `tenant` owns the window
   * table). Allowlisted like everything else here — no route patterns, no
   * role lists, only what the operator wrote for the public.
   */
  maintenance: {
    active: BridgedMaintenanceWindow[]
    upcoming: BridgedMaintenanceWindow[]
  }
  generatedAt: string
}

const SEVERITY_ORDER: ComponentStatus[] = [
  'MAJOR_OUTAGE', 'PARTIAL_OUTAGE', 'DEGRADED', 'MAINTENANCE', 'OPERATIONAL',
]

/**
 * Whether a component's own status leaves room for the maintenance projection.
 * An OPERATIONAL or DEGRADED component under a window reads MAINTENANCE; one
 * the probes call an outage keeps saying outage, because planned work explains
 * an expected failure and must never hide an unexpected one.
 */
export function projectMaintenance(componentStatus: string, windowOpen: boolean): string {
  return windowOpen && isAvailable(componentStatus) ? 'MAINTENANCE' : componentStatus
}

function isAvailable(status: string): boolean {
  return status === 'OPERATIONAL' || status === 'DEGRADED'
}

/** Worst state across the public components (banner line). */
export function deriveOverallStatus(componentStatuses: string[]): ComponentStatus {
  for (const level of SEVERITY_ORDER) {
    if (componentStatuses.includes(level)) return level
  }
  return 'OPERATIONAL'
}


export interface PublicGroup {
  groupId: string
  name: string
  description: string | null
  collapsed: boolean
}

export interface PublicPageComponent {
  componentId: string
  name: string
  description: string | null
  status: string
  groupId: string | null
  showUptime: boolean
  /** Null when the component hides its uptime. */
  uptime: UptimeWindows | null
  /** The 90-day bar; null when the component hides its history. */
  history: DayBar[] | null
  /**
   * Per-region status and uptime (phase 10.5): only the probe locations the tenant chose to expose that a runner really serves; `null` when the
   * component does not show regions, an empty list when none qualifies. Each region is `{ regionId, label, status, uptime }`, nothing else.
   */
  regions?: PublicRegion[] | null
  /**
   * The response-time chart (phase 15.6): one point per day for the last 30 days, the exact daily average and an APPROXIMATE p95 (from fixed
   * latency buckets, never below the true value). Daily aggregates only, never a raw check; `null` when the component does not show it.
   */
  responseTime?: LatencySeries | null
}

export interface PublicPageLanguage {
  /** What the visitor is reading. */
  served: string
  /** The tenant's primary language, the source of truth and the fallback. */
  primary: string
  /** The languages this page offers, primary first. */
  available: string[]
  /** True when some text on this page is shown in the primary language because it has no translation. */
  fallback: boolean
  rtl: boolean
}

export interface PublicPage {
  page: { slug: string; name: string; theme: StatusTheme; isDefault: boolean }
  language: PublicPageLanguage
  overall: ComponentStatus
  groups: PublicGroup[]
  components: PublicPageComponent[]
  branding: StatusBranding | null
  activeIncidents: PublicIncident[]
  recentIncidents: PublicIncident[]
  maintenance: { active: BridgedMaintenanceWindow[]; upcoming: BridgedMaintenanceWindow[] }
  generatedAt: string
}

export interface PublicArchive {
  page: { slug: string; name: string }
  language: PublicPageLanguage
  incidents: PublicIncident[]
  /** Pass back as `before` for the next (older) page; null at the end. */
  nextBefore: string | null
  generatedAt: string
}

type UpdateRow = Pick<IncidentUpdate, 'updateId' | 'incidentId' | 'status' | 'publicMessage' | 'createdAt'>

/**
 * One public incident, field by field. The ONLY projection of an incident that may leave the module: the page, the archive, the feeds,
 * the calendar, the snapshot and the subscriber webhook all read this shape and never an `Incident` row. The internal `reason` (it
 * may name hosts), the monitor id and the alert group are not copied because nothing below mentions them.
 */
export function projectIncident(i: Incident, updates: readonly UpdateRow[], tr?: Translator): PublicIncident {
  return {
    incidentId: i.incidentId,
    title: tr ? tr.name('incident', i.incidentId, i.title) : i.title,
    severity: i.severity,
    startedAt: i.startedAt,
    resolvedAt: i.resolvedAt ?? null,
    publicMessage: tr ? tr.body('incident', i.incidentId, i.publicMessage ?? null) : (i.publicMessage ?? null),
    affectedComponentIds: i.affectedComponentIds ?? [],
    updates: updates
      .filter((u) => u.incidentId === i.incidentId)
      .map((u) => ({
        status: u.status,
        publicMessage: tr ? (tr.body('update', u.updateId, u.publicMessage) ?? u.publicMessage) : u.publicMessage,
        createdAt: u.createdAt,
      })),
  }
}

export interface PageRequestOptions {
  /** The visitor's requested language (`lang` query); honoured only when the page offers it. */
  language?: string | null
  /** Clock override for tests. */
  now?: Date
}

/** A PRIVATE incident flagged for this restricted page. A public incident is not "flagged": it is on every page it touches. */
function flaggedFor(i: Pick<Incident, 'isPublic' | 'audiencePageIds'>, pageId: string | null): boolean {
  return !i.isPublic && pageId !== null && Array.isArray(i.audiencePageIds) && i.audiencePageIds.includes(pageId)
}

const RECENT_INCIDENT_DAYS = 30
const RECENT_INCIDENT_CAP = 20

export default class StatusPublicService {
  static async isEnabled(tenantId: string): Promise<boolean> {
    const value = await SettingService
      .getValue(tenantId, OBSERVABILITY_SETTING_KEYS.STATUS_PAGE_ENABLED)
      .catch(() => null)
    return value === 'true'
  }

  static async assertEnabled(tenantId: string): Promise<void> {
    if (!(await StatusPublicService.isEnabled(tenantId))) {
      // Same body as an unknown tenant/page — a prober learns nothing.
      throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    }
  }

  static async buildPublicStatus(tenantId: string): Promise<PublicStatus> {
    await StatusPublicService.assertEnabled(tenantId)
    // The legacy URL IS the default page. While that page is public and on, it answers as it always did; once an operator restricts
    // it (password, members, addresses) or switches it off, this credential-less endpoint can no longer prove who is asking, so it
    // answers the common 404 and the restricted page is reached through the page API instead.
    const defaultPage = await StatusPageService.getDefault(tenantId)
    if (!defaultPage.enabled || defaultPage.audience !== 'PUBLIC') throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    const allPublic = await withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.find({
      where: { tenantId, isPublic: true },
      order: { order: 'ASC', createdAt: 'ASC' },
    }))
    const components = visibleComponents(allPublic, defaultPage)

    // Read the windows BEFORE the components: a tenant-wide window repaints
    // every component, and the projection has to be applied as they are built.
    const [maintenance, branding] = await Promise.all([
      listMaintenanceForStatus(tenantId),
      loadStatusBranding(tenantId),
    ])
    // A SYSTEM or TENANT window covers the whole tenant, so every component is
    // in maintenance. A ROUTE window is partial by definition and there is no
    // window→component mapping to narrow it with — inventing one would put a
    // second copy of the window's truth in this module, which the bridge exists
    // to prevent. So ROUTE windows repaint nothing and show in the maintenance
    // block instead.
    const tenantWideMaintenance = maintenance.active.some((w) => w.scope !== 'ROUTE')

    const publicComponents: PublicComponent[] = []
    for (const c of components) {
      publicComponents.push({
        componentId: c.componentId,
        name: c.name,
        description: c.description ?? null,
        // PROJECTED, never written back. Persisting MAINTENANCE here would
        // need a reliable un-write when the window ends, would fight the
        // operator's own sticky MAINTENANCE, and would make `tenant`'s window
        // no longer the single source. A derived read has none of those
        // problems and is correct the instant the window opens or closes.
        //
        // A real outage still wins: a component the probes say is MAJOR_OUTAGE
        // keeps saying so during maintenance. Planned work explains an expected
        // outage; it must not hide an unexpected one.
        status: projectMaintenance(c.status, tenantWideMaintenance),
        uptime: await StatusUptimeService.componentUptime(tenantId, c.componentId),
      })
    }

    const recentCutoff = new Date(Date.now() - RECENT_INCIDENT_DAYS * 24 * 60 * 60 * 1000)
    // Incidents and their updates as one snapshot.
    const { shown, updates } = await withTenantTransactionFor(tenantId, async (qr) => {
      const incidents = await qr.manager.getRepository(Incident).find({
        where: { tenantId, isPublic: true },
        order: { startedAt: 'DESC' },
        take: 100,
      })
      const visible = incidents.filter((i) =>
        i.status === 'OPEN' || (i.resolvedAt && i.resolvedAt >= recentCutoff))
      const rows = visible.length
        ? await qr.manager.getRepository(IncidentUpdate).find({
            where: { tenantId, incidentId: In(visible.map((i) => i.incidentId)) },
            order: { createdAt: 'ASC' },
          })
        : []
      return { shown: visible, updates: rows }
    })

    const toPublic = (i: Incident): PublicIncident => projectIncident(i, updates)

    // A non-ROUTE active window folds MAINTENANCE into the banner derivation;
    // SEVERITY_ORDER already ranks a real outage above it, so an incident
    // during maintenance still shows as the outage it is. ROUTE windows are
    // partial by definition and never repaint the whole banner.
    const statusInputs = publicComponents.map((c) => c.status)
    if (tenantWideMaintenance) statusInputs.push('MAINTENANCE')

    return {
      overall: deriveOverallStatus(statusInputs),
      components: publicComponents,
      branding,
      activeIncidents: shown.filter((i) => i.status === 'OPEN').map(toPublic),
      recentIncidents: shown
        .filter((i) => i.status !== 'OPEN')
        .slice(0, RECENT_INCIDENT_CAP)
        .map(toPublic),
      maintenance,
      generatedAt: new Date().toISOString(),
    }
  }

  // ── page-aware builders (phase 15) ─────────────────────────────────────────

  /**
   * The serialized page for ONE status page. The caller has already passed the audience gate; this is what the gate lets through.
   * Same allowlist rule as above: every field is written out by name, nothing is spread from an entity.
   */
  static async buildPublicPage(tenantId: string, page: StatusPageSpec, opts: PageRequestOptions = {}): Promise<PublicPage> {
    await StatusPublicService.assertEnabled(tenantId)
    if (!page.enabled) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    const now = opts.now ?? new Date()

    const [allComponents, groupRows, maintenance, branding, languages] = await Promise.all([
      withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.find({ where: { tenantId }, order: { order: 'ASC', createdAt: 'ASC' } })),
      withTenantRepositoryFor(tenantId, StatusComponentGroup, (repo) => repo.find({ where: { tenantId }, order: { order: 'ASC', createdAt: 'ASC' } })),
      listMaintenanceForStatus(tenantId),
      loadStatusBranding(tenantId),
      resolveTenantLanguages(tenantId),
    ])
    const components = visibleComponents(allComponents, page)
    const pageComponentIds = new Set(components.map((c) => c.componentId))

    const served = pickLanguage(opts.language, languages.defaultLanguage, page.languages)
    const translations = served === languages.defaultLanguage
      ? []
      : await withTenantRepositoryFor(tenantId, StatusTranslation, (repo) => repo.find({ where: { tenantId, locale: served } }))
    const tr = makeTranslator(served, languages.defaultLanguage, translations)

    // A page of a RESTRICTED audience (the caller has passed its gate) may also carry the private incidents flagged for it. A PUBLIC page never does,
    // whatever an incident holds: the id is only handed to the loader for a non-public page, and the loader only reads it then.
    const restrictedPageId = page.audience !== 'PUBLIC' ? page.pageId : null
    const { shown, updates } = await StatusPublicService.loadIncidents(tenantId, now, restrictedPageId)
    const onPage = shown.filter((i) => incidentTouchesPage(i.affectedComponentIds, pageComponentIds))

    const tenantWideMaintenance = maintenance.active.some((w) => w.scope !== 'ROUTE')
    const needHistory = components.filter((c) => c.showHistory)
    const history = needHistory.length > 0
      ? await StatusHistoryService.load(tenantId, needHistory.map((c) => c.componentId), now)
      : null
    const markerInputs = onPage.map((i) => ({ incidentId: i.incidentId, startedAt: i.startedAt, affectedComponentIds: i.affectedComponentIds }))
    const [regionsByComponent, latencyByComponent] = await Promise.all([
      StatusRegionService.load(tenantId, components.filter((c) => c.showRegions).map((c) => ({ componentId: c.componentId, showUptime: c.showUptime })), { now }),
      StatusLatencyService.load(tenantId, components.filter((c) => c.showResponseTime).map((c) => c.componentId), now),
    ])

    const publicComponents: PublicPageComponent[] = []
    for (const c of components) {
      publicComponents.push({
        componentId: c.componentId,
        name: tr.name('component', c.componentId, c.name),
        description: tr.body('component', c.componentId, c.description ?? null),
        status: projectMaintenance(c.status, tenantWideMaintenance),
        groupId: c.groupId ?? null,
        showUptime: c.showUptime,
        uptime: c.showUptime ? await StatusUptimeService.componentUptime(tenantId, c.componentId) : null,
        history: c.showHistory && history
          ? buildDayBars({
              days: history.days,
              monitorIds: history.monitorsByComponent.get(c.componentId) ?? [],
              countsByMonitorDay: history.countsByMonitorDay,
              componentId: c.componentId,
              incidents: markerInputs,
            })
          : null,
        regions: c.showRegions
          ? (regionsByComponent.get(c.componentId) ?? []).map((r) => ({ ...r, status: projectMaintenance(r.status, tenantWideMaintenance) }))
          : null,
        responseTime: c.showResponseTime ? (latencyByComponent.get(c.componentId) ?? null) : null,
      })
    }

    const usedGroupIds = new Set(publicComponents.map((c) => c.groupId).filter((g): g is string => g !== null))
    const groups: PublicGroup[] = groupRows
      .filter((g) => usedGroupIds.has(g.groupId))
      .map((g) => ({
        groupId: g.groupId,
        name: tr.name('group', g.groupId, g.name),
        description: tr.body('group', g.groupId, g.description ?? null),
        collapsed: g.collapsed,
      }))
    // A component whose group is not in the list (deleted, or emptied of visible members) is shown ungrouped, never dropped.
    const knownGroups = new Set(groups.map((g) => g.groupId))
    for (const c of publicComponents) if (c.groupId && !knownGroups.has(c.groupId)) c.groupId = null

    const statusInputs: string[] = publicComponents.map((c) => c.status)
    if (tenantWideMaintenance) statusInputs.push('MAINTENANCE')

    // Translations are public wording: they are applied to PUBLIC incidents only. A private incident flagged for a restricted page is shown in the
    // tenant's primary language, so a stale translation row of an incident that was once public can never surface for it.
    const projected = (i: Incident) => projectIncident(i, updates, i.isPublic ? tr : undefined)
    return {
      page: { slug: page.slug, name: tr.name('page', page.pageId ?? page.slug, page.name), theme: page.theme, isDefault: page.isDefault },
      language: {
        served,
        primary: languages.defaultLanguage,
        available: availableLanguages(languages.defaultLanguage, page.languages),
        fallback: tr.usedFallback,
        rtl: isRtl(served),
      },
      overall: deriveOverallStatus(statusInputs),
      groups,
      components: publicComponents,
      branding,
      activeIncidents: onPage.filter((i) => i.status === 'OPEN').map(projected),
      recentIncidents: onPage.filter((i) => i.status !== 'OPEN').slice(0, RECENT_INCIDENT_CAP).map(projected),
      maintenance,
      generatedAt: now.toISOString(),
    }
  }

  /**
   * The open and recently resolved public incidents with their updates, as one snapshot. With `restrictedPageId` (a page of a restricted audience whose
   * gate has passed) the private incidents flagged for exactly that page are read too; without it, never.
   */
  private static async loadIncidents(tenantId: string, now: Date, restrictedPageId: string | null = null): Promise<{ shown: Incident[]; updates: IncidentUpdate[] }> {
    const recentCutoff = new Date(now.getTime() - RECENT_INCIDENT_DAYS * 24 * 60 * 60 * 1000)
    return withTenantTransactionFor(tenantId, async (qr) => {
      const incidents = await qr.manager.getRepository(Incident).find({
        where: restrictedPageId
          ? [{ tenantId, isPublic: true }, { tenantId, isPublic: false, audiencePageIds: Not(IsNull()) }]
          : { tenantId, isPublic: true },
        order: { startedAt: 'DESC' },
        take: 100,
      })
      const visible = incidents.filter((i) => (i.isPublic || flaggedFor(i, restrictedPageId)) && (i.status === 'OPEN' || (i.resolvedAt && i.resolvedAt >= recentCutoff)))
      const rows = visible.length
        ? await qr.manager.getRepository(IncidentUpdate).find({
            where: { tenantId, incidentId: In(visible.map((i) => i.incidentId)) },
            order: { createdAt: 'ASC' },
          })
        : []
      return { shown: visible, updates: rows }
    })
  }

  /**
   * The full incident archive of a page: every public incident that touches it, newest first, a page at a time (keyset on the start
   * time, so a page is stable while new incidents arrive). Same projection as everything else.
   */
  static async buildPublicArchive(
    tenantId: string,
    page: StatusPageSpec,
    opts: PageRequestOptions & { before?: Date | null; limit?: number } = {},
  ): Promise<PublicArchive> {
    await StatusPublicService.assertEnabled(tenantId)
    if (!page.enabled) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20))
    const now = opts.now ?? new Date()

    const [allComponents, languages] = await Promise.all([
      withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.find({ where: { tenantId } })),
      resolveTenantLanguages(tenantId),
    ])
    const pageComponentIds = new Set(visibleComponents(allComponents, page).map((c) => c.componentId))
    const served = pickLanguage(opts.language, languages.defaultLanguage, page.languages)
    const translations = served === languages.defaultLanguage
      ? []
      : await withTenantRepositoryFor(tenantId, StatusTranslation, (repo) => repo.find({ where: { tenantId, locale: served } }))
    const tr = makeTranslator(served, languages.defaultLanguage, translations)
    // Same rule as the page: only a restricted page (gate passed) carries the private incidents flagged for it.
    const restrictedPageId = page.audience !== 'PUBLIC' ? page.pageId : null

    // Read a window larger than the page and filter by component in memory: the filter is a JSON column match, and the archive of
    // one tenant is small enough that over-reading by a bounded factor is cheaper than a second query shape.
    const { rows, updates } = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Incident)
      const base = (extra: Record<string, unknown>) => ({ tenantId, ...extra, ...(opts.before ? { startedAt: LessThan(opts.before) } : {}) })
      const found = await repo.find({
        where: restrictedPageId
          ? [base({ isPublic: true }), base({ isPublic: false, audiencePageIds: Not(IsNull()) })]
          : base({ isPublic: true }),
        order: { startedAt: 'DESC' }, take: 500,
      })
      const mine = found.filter((i) => (i.isPublic || flaggedFor(i, restrictedPageId)) && incidentTouchesPage(i.affectedComponentIds, pageComponentIds))
      const chosen = mine.slice(0, limit + 1)
      const ups = chosen.length
        ? await qr.manager.getRepository(IncidentUpdate).find({
            where: { tenantId, incidentId: In(chosen.map((i) => i.incidentId)) },
            order: { createdAt: 'ASC' },
          })
        : []
      return { rows: chosen, updates: ups }
    })
    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    return {
      page: { slug: page.slug, name: tr.name('page', page.pageId ?? page.slug, page.name) },
      language: {
        served,
        primary: languages.defaultLanguage,
        available: availableLanguages(languages.defaultLanguage, page.languages),
        fallback: tr.usedFallback,
        rtl: isRtl(served),
      },
      incidents: pageRows.map((i) => projectIncident(i, updates, i.isPublic ? tr : undefined)),
      nextBefore: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].startedAt.toISOString() : null,
      generatedAt: now.toISOString(),
    }
  }
}
