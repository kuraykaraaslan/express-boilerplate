import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import redis, { jitter } from '@kuraykaraaslan-labs/redis'
import Logger from '@kuraykaraaslan-labs/logger'
import { ROOT_TENANT_ID, isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { DashboardWidget } from './entities/dashboard_widget.entity'

/**
 * Widgets the PLATFORM publishes, readable by every tenant without a copy.
 *
 * ## What this replaces, and why a copy was not good enough
 *
 * Before D1 a platform widget could only reach tenants by being seeded into
 * each one. That gives N rows and N versions: the day the platform fixes a
 * widget, the fix reaches nobody who already has it, and there is no way to
 * tell a stale copy from a tenant's deliberate edit. A read-through is the only
 * shape where "the platform improved a widget" is a thing that can happen.
 *
 * ## Why not a nullable `tenantId`
 *
 * The obvious alternative — one row with `tenantId = NULL` meaning "everyone" —
 * stays refused. Rows live in per-tenant databases, so a null-tenant row is
 * simply invisible from a tenant's own connection; and `hasTenantId` is what
 * marketplace's data-deletion map reads to know a table is tenant-scoped.
 * Breaking that is a silent KVKK debt, which is a far worse trade than a second
 * read.
 *
 * ## Only SYSTEM, PUBLISHED, shared rows are published
 *
 * The root tenant is also a real tenant: the platform operator has their own
 * private boards and drafts in it. Publishing everything there would hand every
 * customer the operator's internal dashboards. So three conditions, all
 * required, and the narrowest one (`isSystem`) is the deliberate marker rather
 * than an inference.
 *
 * Root reading root gets nothing here — it is the source, not a consumer, and a
 * self-fallback would double every row in the operator's own catalogue.
 */
const CACHE_TTL = 300
const CACHE_KEY = 'dash:rootwidgets:v1'

/** The platform's published widgets. Empty for the root tenant itself. */
export async function listRootPublishedWidgets(tenantId: string): Promise<DashboardWidget[]> {
  if (isRootTenant(tenantId)) return []

  const cached = await redis.get(CACHE_KEY).catch(() => null)
  if (cached) {
    try { return JSON.parse(cached) as DashboardWidget[] } catch { await redis.del(CACHE_KEY).catch(() => {}) }
  }

  let rows: DashboardWidget[] = []
  try {
    // The ROOT tenant's catalogue, read in a root-scoped block; the
    // degrade-to-empty catch stays outside it.
    rows = await withTenantRepositoryFor(ROOT_TENANT_ID, DashboardWidget, (repo) => repo.find({
      where: {
        tenantId: ROOT_TENANT_ID,
        isSystem: true,
        visibility: 'TENANT',
        status: 'PUBLISHED',
      } as never,
      order: { category: 'ASC', label: 'ASC' },
    }))
  } catch (error) {
    // The platform catalogue being unreachable must not take a tenant's own
    // dashboard down with it: they lose the shared widgets, not their boards.
    Logger.warn(`[dashboard] root widget catalogue unavailable: ${error}`)
    return []
  }

  await redis.setex(CACHE_KEY, jitter(CACHE_TTL), JSON.stringify(rows)).catch(() => {})
  return rows
}

/** One platform widget by id, or `null`. */
export async function findRootPublishedWidget(
  tenantId: string,
  widgetId: string,
): Promise<DashboardWidget | null> {
  const rows = await listRootPublishedWidgets(tenantId)
  return rows.find((w) => w.widgetId === widgetId) ?? null
}

/**
 * Is `type` taken by a platform widget (a published system widget of the root catalogue)? A tenant's
 * own widget of the same type would hide the platform one from that tenant's picker, and `builtin:<type>`
 * refs in templates and imports are looked up by this very type, so the platform's types are reserved
 * to the platform. Empty for the root tenant itself (it owns the catalogue).
 */
export async function isPlatformWidgetType(tenantId: string, type: string): Promise<boolean> {
  return (await listRootPublishedWidgets(tenantId)).some((w) => w.type === type)
}

/** Drop the platform catalogue cache — called whenever a root widget changes. */
export async function bustRootWidgetCache(): Promise<void> {
  await redis.del(CACHE_KEY).catch(() => {})
}
