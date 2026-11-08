import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import type { QueryRunner } from 'typeorm'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import {
  listRootPublishedWidgets, findRootPublishedWidget, bustRootWidgetCache, isPlatformWidgetType,
} from './widget.root-catalog'
import type { DataBinding } from './data-source.types'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import { DashboardWidgetFavorite } from './entities/dashboard_widget_favorite.entity'
import type { CreateWidgetInput, UpdateWidgetInput } from './widget.dto'
import MSG from './dashboard.messages'
import { assertKindAvailable, kindTypeOf, withoutBlockedKinds } from './widget-kind-groups'
import { kindForWidget } from './widget-settings'
import { assertPlacementGuards, effectiveKindSettings, isGuardedType } from './placement-guard'

export interface WidgetViewer {
  userId: string
}

/** `db:<uuid>` — the reference a placement stores for a definition row. */
export const dbRef = (widgetId: string): string => `db:${widgetId}`

/**
 * Take the per-tenant widget-quota lock on `qr` and re-count under it: a new statement after the lock,
 * so under READ COMMITTED it sees every create that committed while this one waited. The same two
 * budgets as `assertWidgetHeadroom` (shared limit for `TENANT`, the owner's own count for `PRIVATE`).
 * Exported for the package import, which creates shared rows. Lazy import: the entitlement module
 * imports this service for its counts.
 */
export async function assertWidgetHeadroomUnderLock(
  qr: QueryRunner,
  tenantId: string,
  visibility: 'TENANT' | 'PRIVATE',
  userId: string | undefined,
): Promise<void> {
  await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:widget-quota:${tenantId}`])
  const { resolveWidgetLimit } = await import('./widget.entitlement')
  const limit = await resolveWidgetLimit(tenantId)
  if (limit === Infinity) return
  const where = visibility === 'PRIVATE' && userId
    ? { tenantId, isSystem: false, visibility: 'PRIVATE', ownerUserId: userId }
    : { tenantId, isSystem: false, visibility: 'TENANT' }
  if ((await qr.manager.getRepository(DashboardWidget).count({ where })) >= limit) {
    throw new AppError(MSG.WIDGET_LIMIT_REACHED, 403, ErrorCode.FORBIDDEN)
  }
}

export default class DashboardWidgetService {
  /**
   * The widget definitions this viewer may see: the tenant's own (shared, plus
   * their own private ones) AND the platform's published catalogue read through
   * from the root tenant (D1).
   *
   * Someone else's private widget is absent, not forbidden.
   *
   * **A tenant's own row WINS on a `type` collision.** A tenant that copied a
   * platform widget and changed it must keep seeing theirs — the alternative is
   * the platform silently overwriting an edit somebody made on purpose. The
   * collision is resolved on `type` rather than id because that is what a
   * placement and a duplicate check key on.
   */
  static async list(
    tenantId: string,
    viewer: WidgetViewer,
    filter: { status?: string; category?: string; search?: string; includeUnavailable?: boolean } = {},
  ): Promise<DashboardWidget[]> {
    const own = await withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => {
      const qb = repo
        .createQueryBuilder('w')
        .where('w.tenantId = :tenantId', { tenantId })
        .andWhere('(w.visibility = :shared OR w.ownerUserId = :userId)', { shared: 'TENANT', userId: viewer.userId })
        .orderBy('w.category', 'ASC')
        .addOrderBy('w.label', 'ASC')
      if (filter.status) qb.andWhere('w.status = :status', { status: filter.status })
      if (filter.category) qb.andWhere('w.category = :category', { category: filter.category })
      if (filter.search) qb.andWhere('(w.label ILIKE :s OR w.type ILIKE :s)', { s: `%${filter.search}%` })
      return qb.getMany()
    })

    const ownTypes = new Set(own.map((w) => w.type))
    const platform = (await listRootPublishedWidgets(tenantId))
      .filter((w) => !ownTypes.has(w.type))
      .filter((w) => (!filter.status || w.status === filter.status))
      .filter((w) => (!filter.category || w.category === filter.category))
      .filter((w) => {
        if (!filter.search) return true
        const s = filter.search.toLowerCase()
        return w.label.toLowerCase().includes(s) || w.type.toLowerCase().includes(s)
      })

    const merged = [...own, ...platform]
      .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
    // `dashboard:widget_kinds`: the kinds of a group whose module is not active for this tenant are not offered, whether the
    // row is the platform's or a preset of one. A caller that must still resolve placed cards asks for them (they render inert).
    return filter.includeUnavailable ? merged : withoutBlockedKinds(tenantId, merged, (w) => kindTypeOf(w))
  }

  static async get(tenantId: string, widgetId: string, viewer: WidgetViewer): Promise<DashboardWidget> {
    const widget = await withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => repo.findOne({ where: { tenantId, widgetId } }))
    if (widget) {
      if (widget.visibility === 'PRIVATE' && widget.ownerUserId !== viewer.userId) {
        throw new AppError(MSG.WIDGET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      }
      return widget
    }
    // The platform catalogue, second: a tenant's own row always answers first,
    // so a local edit is never shadowed by the shared one.
    const platform = await findRootPublishedWidget(tenantId, widgetId)
    if (!platform) throw new AppError(MSG.WIDGET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return platform
  }

  static async create(
    tenantId: string,
    dto: CreateWidgetInput,
    viewer: WidgetViewer,
  ): Promise<DashboardWidget> {
    // K12: a preset's renderable shape is the base's, copied here once and
    // never re-taken from the request — the same discipline that keeps
    // `componentId` out of this DTO entirely, applied to a widget that names
    // its base by reference instead of typing the shape out by hand.
    // Resolved through the builtin/root catalogues BEFORE the block.
    const base = dto.baseWidgetRef ? await resolvePresetBase(tenantId, dto.baseWidgetRef) : null
    // A preset of a kind whose module is off for this tenant cannot be made (`dashboard:widget_kinds`).
    if (base) await assertKindAvailable(tenantId, kindTypeOf(base))
    // A preset's defaults are what each of its placements draws: the kind's `dashboard:placement_guard` guards judge them (31, C4).
    const baseKind = base ? kindForWidget(base) : undefined
    if (baseKind && await isGuardedType(baseKind.type)) {
      await assertPlacementGuards({ tenantId, widgetType: baseKind.type, settings: effectiveKindSettings(baseKind, null, dto.defaultProps), previous: null })
    }
    // Type check + insert under a per-(tenant, type) lock: two creates of one
    // type no longer both pass the check and hit the unique index as a 500.
    return withTenantTransactionFor(tenantId, async (qr) => {
    // The quota again, under a per-tenant lock taken BEFORE the per-type one (dashboard.14): two creates
    // of DIFFERENT types do not share the type lock, so both passed the route's count at the last slot.
    await assertWidgetHeadroomUnderLock(qr, tenantId, dto.visibility, viewer.userId)
    await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:widget-type:${tenantId}:${dto.type}`])
    const repo = qr.manager.getRepository(DashboardWidget)
    if (await repo.findOne({ where: { tenantId, type: dto.type } })) {
      throw new AppError(MSG.WIDGET_TYPE_TAKEN, 409, ErrorCode.CONFLICT)
    }
    // A platform widget's type is the platform's: a tenant widget of the same type would hide it from
    // this tenant's picker and answer `builtin:<type>` lookups wrongly (15.4a leftover).
    if (await isPlatformWidgetType(tenantId, dto.type)) {
      throw new AppError(MSG.WIDGET_TYPE_RESERVED, 409, ErrorCode.CONFLICT)
    }
    return repo.save(repo.create({
      tenantId,
      type: dto.type,
      label: dto.label,
      category: dto.category,
      description: dto.description ?? undefined,
      renderTier: base?.renderTier ?? dto.renderTier,
      componentId: base?.componentId ?? null,
      template: base ? '' : dto.template,
      schema: base?.schema ?? dto.schema,
      defaultProps: dto.defaultProps,
      dataSpec: base ? (base.dataSpec ?? null) : (dto.dataSpec ?? null),
      visibility: dto.visibility,
      ownerUserId: dto.visibility === 'PRIVATE' ? viewer.userId : null,
      defaultW: base?.defaultW ?? dto.defaultW,
      defaultH: base?.defaultH ?? dto.defaultH,
      icon: dto.icon ?? base?.icon ?? null,
      tags: dto.tags ?? null,
      allowedRoles: dto.allowedRoles ?? null,
      baseWidgetRef: dto.baseWidgetRef ?? null,
      defaultDataBinding: (dto.defaultDataBinding as DataBinding | null | undefined) ?? null,
      status: 'DRAFT',
    }))
    })
  }

  static async update(
    tenantId: string,
    widgetId: string,
    dto: UpdateWidgetInput,
    viewer: WidgetViewer,
  ): Promise<DashboardWidget> {
    // The revision gate on the LOCKED row: two editors saving the same
    // revision used to both pass and the later silently overwrote the other.
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
    const widget = await lockOwnWidget(qr, tenantId, widgetId, viewer)
    assertNotSystem(widget)
    if (dto.expectedRevision !== undefined && dto.expectedRevision !== widget.revision) {
      throw new AppError(MSG.WIDGET_CONFLICT, 409, ErrorCode.CONFLICT)
    }
    if (dto.type && dto.type !== widget.type) {
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:widget-type:${tenantId}:${dto.type}`])
      const clash = await qr.manager.getRepository(DashboardWidget).findOne({ where: { tenantId, type: dto.type } })
      if (clash) throw new AppError(MSG.WIDGET_TYPE_TAKEN, 409, ErrorCode.CONFLICT)
    }

    // Editing a published widget edits the DRAFT of its next version; the version
    // that placements follow only moves when someone publishes. Otherwise a typo
    // in the editor would reach every board the moment it was typed.
    if (dto.type !== undefined) widget.type = dto.type
    if (dto.label !== undefined) widget.label = dto.label
    if (dto.category !== undefined) widget.category = dto.category
    if (dto.renderTier !== undefined) widget.renderTier = dto.renderTier
    if (dto.template !== undefined) widget.template = dto.template
    if (dto.defaultW !== undefined) widget.defaultW = dto.defaultW
    if (dto.defaultH !== undefined) widget.defaultH = dto.defaultH
    if (dto.description !== undefined) widget.description = dto.description ?? undefined
    if (dto.schema !== undefined) widget.schema = dto.schema
    if (dto.defaultProps !== undefined) {
      // A preset's new defaults against its old ones, for the guards of its kind (31, C4); any other widget has none.
      const kind = widget.baseWidgetRef ? kindForWidget(widget) : undefined
      if (kind && await isGuardedType(kind.type)) {
        await assertPlacementGuards({
          tenantId, widgetType: kind.type,
          settings: effectiveKindSettings(kind, null, dto.defaultProps),
          previous: effectiveKindSettings(kind, null, (widget.defaultProps as Record<string, unknown> | null) ?? {}),
        })
      }
      widget.defaultProps = dto.defaultProps
    }
    if (dto.dataSpec !== undefined) widget.dataSpec = dto.dataSpec ?? null
    if (dto.icon !== undefined) widget.icon = dto.icon
    if (dto.tags !== undefined) widget.tags = dto.tags
    if (dto.allowedRoles !== undefined) widget.allowedRoles = dto.allowedRoles
    // A preset's BASE is set once at creation and not re-pointed here — only
    // its default binding is editable, the same way `defaultProps` is.
    if (dto.defaultDataBinding !== undefined) {
      widget.defaultDataBinding = (dto.defaultDataBinding as DataBinding | null) ?? null
    }
    if (dto.visibility !== undefined) {
      widget.visibility = dto.visibility
      widget.ownerUserId = dto.visibility === 'PRIVATE' ? viewer.userId : null
    }
    widget.revision += 1
    return qr.manager.getRepository(DashboardWidget).save(widget)
    })
    if (isRootTenant(tenantId)) await bustRootWidgetCache()
    return saved
  }

  /**
   * Delete a definition. Refused while placements still reference it: removing it
   * would turn every one of them into an unresolvable ref, i.e. a silent gap on
   * boards the author may not even know about. Archiving is the way to retire a
   * widget that is in use.
   */
  static async remove(tenantId: string, widgetId: string, viewer: WidgetViewer): Promise<void> {
    // Widget LOCKED for the placement count and the delete; a new placement
    // reads it FOR SHARE (instance.crud.service `holdWidget`), so the two
    // serialise — no card is left pointing at a deleted widget.
    await withTenantTransactionFor(tenantId, async (qr) => {
      const widget = await lockOwnWidget(qr, tenantId, widgetId, viewer)
      assertNotSystem(widget)
      const placements = await qr.manager.getRepository(DashboardWidgetInstance)
        .count({ where: { tenantId, widgetRef: dbRef(widgetId) } })
      if (placements > 0) throw new AppError(MSG.WIDGET_IN_USE, 409, ErrorCode.CONFLICT)
      await qr.manager.getRepository(DashboardWidget).delete({ tenantId, widgetId })
    })
    if (isRootTenant(tenantId)) await bustRootWidgetCache()
  }

  /** How many placements reference each of these widgets — the library's "used by". */
  static async usageCounts(tenantId: string, widgetIds: string[]): Promise<Map<string, number>> {
    if (widgetIds.length === 0) return new Map()
    const rows = await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo
      .createQueryBuilder('i')
      .select('i.widgetRef', 'ref')
      .addSelect('COUNT(*)', 'count')
      .where('i.tenantId = :tenantId', { tenantId })
      .andWhere('i.widgetRef IN (:...refs)', { refs: widgetIds.map(dbRef) })
      .groupBy('i.widgetRef')
      .getRawMany<{ ref: string; count: string }>())
    return new Map(rows.map((r) => [r.ref, Number(r.count)]))
  }

  /** Shared (`TENANT`) custom widgets: what the tenant's plan limit counts. A member's PRIVATE rows never spend it (dashboard.05). */
  static async count(tenantId: string): Promise<number> {
    return withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => repo.count({ where: { tenantId, isSystem: false, visibility: 'TENANT' } }))
  }

  /** One member's PRIVATE widgets: their own budget, the way personal boards have one. */
  static async countPrivate(tenantId: string, userId: string): Promise<number> {
    return withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => repo.count({ where: { tenantId, isSystem: false, visibility: 'PRIVATE', ownerUserId: userId } }))
  }

  // ── favourites ────────────────────────────────────────────────────────────

  static async listFavorites(tenantId: string, userId: string): Promise<string[]> {
    const rows = await withTenantRepositoryFor(tenantId, DashboardWidgetFavorite, (repo) => repo.find({ where: { tenantId, userId } }))
    return rows.map((r) => r.widgetRef)
  }

  static async setFavorite(
    tenantId: string,
    userId: string,
    widgetRef: string,
    favorite: boolean,
  ): Promise<void> {
    await withTenantRepositoryFor(tenantId, DashboardWidgetFavorite, async (repo) => {
      if (favorite) {
        // Idempotent: starring twice is the same as starring once.
        await repo.upsert({ tenantId, userId, widgetRef }, ['tenantId', 'userId', 'widgetRef'])
      } else {
        await repo.delete({ tenantId, userId, widgetRef })
      }
    })
  }
}

/**
 * Resolve a preset's `baseWidgetRef` to the platform builtin it names (K12).
 *
 * `source === 'platform'` is the narrower test than `isSystem` alone: a
 * marketplace-materialized row is also `isSystem`, but K12 names "a builtin
 * the platform publishes" (`widget.builtin-catalog.ts`'s chart/stat/table
 * rows) specifically — those are the only rows `builtinWidgetRow()` ever
 * writes `source: 'platform'` onto, so this cannot accidentally let a preset
 * base itself on a third-party listing's widget instead.
 */
async function resolvePresetBase(tenantId: string, baseWidgetRef: string): Promise<DashboardWidget> {
  const widgetId = baseWidgetRef.slice('db:'.length)
  const base = await findRootPublishedWidget(tenantId, widgetId)
  if (!base || base.source !== 'platform') {
    throw new AppError(MSG.WIDGET_BASE_INVALID, 422, ErrorCode.VALIDATION_ERROR)
  }
  return base
}

/** A seeded or marketplace-materialized widget is owned by its source, not the tenant. */
/** The tenant's OWN widget row, LOCKED (a platform widget is not editable here). */
export async function lockOwnWidget(
  qr: import('typeorm').QueryRunner,
  tenantId: string,
  widgetId: string,
  viewer: WidgetViewer,
): Promise<DashboardWidget> {
  const widget = await qr.manager.getRepository(DashboardWidget).findOne({
    where: { tenantId, widgetId },
    lock: { mode: 'pessimistic_write' },
  })
  if (!widget || (widget.visibility === 'PRIVATE' && widget.ownerUserId !== viewer.userId)) {
    // A platform (root-catalogue) widget reads as not-found for writes, as
    // `assertNotSystem` would refuse it anyway.
    const platform = widget ? null : await findRootPublishedWidget(tenantId, widgetId)
    if (platform) assertNotSystem({ isSystem: true })
    throw new AppError(MSG.WIDGET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  }
  return widget
}

export function assertNotSystem(widget: { isSystem: boolean }): void {
  if (widget.isSystem) {
    throw new AppError(MSG.SYSTEM_WIDGET_PROTECTED, 403, ErrorCode.FORBIDDEN)
  }
}

/** What a marketplace listing materializes into this tenant's widget table. */
export interface MaterializedWidgetInput {
  type: string
  label: string
  category?: string
  description?: string
  schema?: object
  defaultProps?: object
  template?: string
  renderTier?: string
  defaultW?: number
  defaultH?: number
  icon?: string | null
  listingId: string
  listingVersion: string
}

/**
 * Write a widget row on behalf of an installed marketplace listing.
 *
 * Deliberately OFF the DTO path. `create()` accepts no provenance and hardcodes
 * `status: 'DRAFT'`, and a draft resolves for nobody — so a listing installed
 * through it would appear to work and then be invisible on every board. This
 * constructor is server-only for the same reason `componentId` and
 * `frameListingId` are refused from clients: provenance is never author-declared.
 */
export async function createMaterializedWidget(
  tenantId: string,
  input: MaterializedWidgetInput,
): Promise<DashboardWidget> {
  return withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => repo.save(repo.create({
    tenantId,
    // Namespaced by listing so a listing can never collide with a widget the
    // tenant authored — `@Unique(['tenantId','type'])` would otherwise throw mid
    // install. `label` is what anyone actually reads.
    type: `mp_${input.listingId.slice(0, 8)}_${input.type}`,
    label: input.label,
    category: input.category ?? 'Marketplace',
    description: input.description,
    schema: input.schema ?? {},
    defaultProps: input.defaultProps ?? {},
    template: input.template ?? '',
    // A third party ships `template` or `iframe`; `component` is first-party code.
    renderTier: input.renderTier === 'iframe' ? 'iframe' : 'template',
    // An iframe widget frames ITS OWN listing. Taking this from the manifest
    // would let one listing frame another — a confused deputy.
    frameListingId: input.renderTier === 'iframe' ? input.listingId : null,
    defaultW: input.defaultW ?? 6,
    defaultH: input.defaultH ?? 4,
    icon: input.icon ?? null,
    visibility: 'TENANT',
    ownerUserId: null,
    // Placeable immediately, and protected from tenant edits: the listing owns it.
    status: 'PUBLISHED',
    publishedVersion: 1,
    isSystem: true,
    source: 'marketplace',
    listingId: input.listingId,
    listingVersion: input.listingVersion,
  })))
}

/**
 * Delete every widget this listing materialized, and the placements pointing at
 * them.
 *
 * Not `remove()`: that throws on `isSystem` rows and 409s while placements exist,
 * and an uninstall must not be blockable by somebody's board. A row pointing at a
 * purged widget would be landfill — `resolvePlacedWidgets` would drop it to a gap
 * forever with nothing to restore it.
 */
export async function purgeMarketplaceWidgets(
  tenantId: string,
  listingId: string,
): Promise<{ widgets: number; placements: number }> {
  // Placements and widgets purged together: a half-done uninstall used to
  // leave either orphaned placements or widgets with no way to re-purge.
  return withTenantTransactionFor(tenantId, async (qr) => {
    const rows = await qr.manager.getRepository(DashboardWidget)
      .find({ where: { tenantId, source: 'marketplace', listingId }, lock: { mode: 'pessimistic_write' } })
    if (rows.length === 0) return { widgets: 0, placements: 0 }

    const refs = rows.map((r) => dbRef(r.widgetId))
    const placements = await qr.manager.getRepository(DashboardWidgetInstance)
      .createQueryBuilder()
      .delete()
      .where('"tenantId" = :tenantId', { tenantId })
      .andWhere('"widgetRef" IN (:...refs)', { refs })
      .execute()
    await qr.manager.getRepository(DashboardWidget).delete({ tenantId, source: 'marketplace', listingId })
    return { widgets: rows.length, placements: placements.affected ?? 0 }
  })
}
