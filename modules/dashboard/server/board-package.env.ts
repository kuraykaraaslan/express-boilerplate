import type { NextRequest } from 'next/server'
import { ext, ProviderUnavailableError, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import type { BoardPackage } from './board-package'
import { widgetLookupKey, type ImportEnv, type ImportWidget } from './board-package.import'
import { resolvePlacedWidgets } from './widget-catalog.service'
import { listRootPublishedWidgets } from './widget.root-catalog'
import DashboardWidgetService from './widget.crud.service'
import DashboardBoardService from './board.crud.service'
import { commandVerdictsFor } from './command-verdicts'
import { DATA_SOURCE_POINT, type DashboardDataSource, type DataSourceContext } from './data-source.types'
import { dashboardDataSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.data_source'
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import Logger from '@kuraykaraaslan-labs/logger'
import type { dashboardContext } from './dashboard.route.helpers'
import { appLocaleOf } from './board-template.locale'

type Ctx = Awaited<ReturnType<typeof dashboardContext>>

/**
 * Answer, for ONE importing caller, every question the import planner asks (19.2): which widgets
 * of the package exist here and may be placed, which data sources and boards exist, and which
 * command actions the caller could author. Widgets go through `resolvePlacedWidgets`, exactly as a
 * manual placement does (enabled module, permission, published snapshot, paused listing, framing),
 * so an import can never place something the caller could not place by hand. A package is only ever
 * a request: nothing it says is believed, everything is looked up here.
 */
export async function buildImportEnv(args: {
  request: NextRequest
  tenantId: string
  ctx: Ctx
  /** One package, or every member of a bundle (19.6): one environment answers for all of them. */
  pkg: BoardPackage | BoardPackage[]
}): Promise<ImportEnv> {
  const { request, tenantId, ctx } = args
  const placements = (Array.isArray(args.pkg) ? args.pkg : [args.pkg]).flatMap((p) => p.placements)

  // 1. Package widget → candidate local ref.
  const candidates = new Map<string, string | null>()
  const needs = (kind: 'builtin' | 'tenant') => placements.some((p) => p.widget.kind === kind)
  const root = needs('builtin') ? await listRootPublishedWidgets(tenantId) : []
  // A builtin also looks at the tenant's own system rows: in the root tenant the platform widgets ARE
  // its own rows (`listRootPublishedWidgets` is empty there), so without this a root-tenant board
  // could not even be re-imported where it was exported (found in the 19.6 browser pass).
  const own = needs('tenant') || needs('builtin') ? await DashboardWidgetService.list(tenantId, { userId: ctx.userId }) : []
  for (const p of placements) {
    const lookup = widgetLookupKey(p.widget)
    if (candidates.has(lookup)) continue
    const { kind, key } = p.widget
    if (kind === 'manifest') candidates.set(lookup, `manifest:${key}`)
    else if (kind === 'ext') candidates.set(lookup, `ext:${key}`)
    else if (kind === 'builtin') {
      const row = root.find((w) => w.type === key && w.isSystem) ?? own.find((w) => w.type === key && w.isSystem)
      candidates.set(lookup, row ? `db:${row.widgetId}` : null)
    } else {
      const row = own.find((w) => w.type === key && !w.isSystem)
      candidates.set(lookup, row ? `db:${row.widgetId}` : null)
    }
  }

  // 2. The same resolution a manual placement gets.
  const descriptors = await resolvePlacedWidgets({
    request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
    refs: [...new Set([...candidates.values()].filter((r): r is string => !!r))],
  })
  const widgets = new Map<string, ImportWidget | null>()
  for (const [lookup, ref] of candidates) {
    const d = ref ? descriptors.get(ref) : undefined
    widgets.set(lookup, d ? {
      ref: d.ref, visibility: d.visibility, schema: d.schema, dataSpec: d.dataSpec ?? null,
      componentId: d.componentId, renderTier: d.renderTier, defaultProps: d.defaultProps ?? null,
      type: d.key, settingsTemplate: d.settingsTemplate ?? null, settingsMigrations: d.settingsMigrations ?? null,
    } : null)
  }

  // 3. Data sources, boards, commands.
  const sources = new Set(
    (await ext.contributions(DATA_SOURCE_POINT, tenantCtx(tenantId))).map((e) => e.key).filter((k): k is string => typeof k === 'string'),
  )
  const boardTitles = new Map<string, string>(
    (await DashboardBoardService.list(tenantId, { userId: ctx.userId }, { enabledIds: ctx.enabledIds }))
      .map((b: { boardId: string; title?: string }) => [b.boardId.toLowerCase(), b.title ?? ''] as const),
  )
  const boards = new Set(boardTitles.keys())
  const queries = await describeReferencedQueries(request, tenantId, ctx, placements)
  const commands = await commandVerdictsFor(request, tenantId, placements.map((p) => p.actions))
  return {
    widgets, sources, boards, boardTitles, queries,
    commandAllowed: commands.allowed,
    commandStatus: commands.status,
  }
}

/**
 * The queries of every data source the package binds to, narrowed to what this caller may run (19.3) —
 * the same `describe()` plus one bulk permission decision as `GET …/dashboard/sources`, but only for the
 * sources the package names. A source whose `describe()` throws maps to null (not checked), so one broken
 * provider neither crashes the import nor strips bindings the runner might still accept later.
 */
async function describeReferencedQueries(
  request: NextRequest,
  tenantId: string,
  ctx: Ctx,
  placements: BoardPackage['placements'],
): Promise<Map<string, Map<string, Set<string>> | null>> {
  const wanted = new Set(placements.flatMap((p) => Object.values(p.dataBinding ?? {}).map((q) => q.sourceKey)))
  const out = new Map<string, Map<string, Set<string>> | null>()
  if (wanted.size === 0) return out
  const dsCtx: DataSourceContext = {
    // the person's app language (D576), never the browser's
    tenantId, userId: ctx.userId, locale: await appLocaleOf(request, tenantId), vars: {},
  }
  // Each source the package names, selected for this tenant like a binding is at run time: one that is not installed or
  // not active here is simply not described; one that fails to load (logged by the host runtime) or whose describe()
  // throws maps to null.
  const described: Array<{ sourceKey: string; queries: Array<{ key: string; requiredPermission: string; params: Record<string, unknown> }> }> = []
  for (const sourceKey of wanted) {
    let source: DashboardDataSource
    try {
      const selected = await ext.select<DashboardDataSource>(DATA_SOURCE_POINT, tenantCtx(tenantId), dashboardDataSourceLoaders, { key: sourceKey })
      if (!selected) continue
      source = selected.impl
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error
      if (error.state === 'failed') out.set(sourceKey, null)
      continue
    }
    try {
      described.push({ sourceKey, queries: await source.describe(dsCtx) })
    } catch (error) {
      Logger.warn(`[dashboard] import: data source '${sourceKey}' failed to describe: ${error}`)
      out.set(sourceKey, null)
    }
  }
  const granted = await grantedPermissions({
    request, tenantId, session: ctx.session,
    permissionIds: [...new Set(described.flatMap((d) => d.queries.map((q) => q.requiredPermission)))],
  })
  for (const d of described) {
    out.set(d.sourceKey, new Map(d.queries.filter((q) => granted.has(q.requiredPermission)).map((q) => [q.key, new Set(Object.keys(q.params ?? {}))])))
  }
  return out
}

