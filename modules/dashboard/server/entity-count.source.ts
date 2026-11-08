import 'reflect-metadata'
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardCountableLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.countable'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { contributedLabelTexts } from './contributed-label-texts'
import { countableLabelKey, explicitLabelKey } from './contributed-labels'
import {
  COUNTABLE_POINT,
  type DashboardDataSource,
  type DashboardCountable,
  type DataSourceContext,
  type DataSourceQueryDef,
  type DataSourceResult,
  type ResolvedQuery,
} from './data-source.types'

/**
 * The curated count source (phase 4b §3.7): `describe()` returns one scalar
 * query per registered countable. Countables arrive as `dashboard:countable`
 * contributions — a module exports an array of `DashboardCountable` and each
 * shows up as `<moduleId>.<key>`, gated by that countable's own permission.
 * Nothing here takes a URL or a table name; what cannot be named cannot be
 * fetched. This is what lets the hardcoded TENANT_STATS/ROOT_STATS cards
 * become portable, permission-checked widgets.
 */

async function collectCountables(tenantId: string): Promise<Map<string, DashboardCountable & { moduleId: string }>> {
  // Same rule the sidebar uses for its own root-only items (`workspace.context.tsx`):
  // root sees everything (`scope: undefined`), a regular tenant only `'tenant'`/`'both'`.
  // This is what keeps a platform-only count (e.g. audit_log's own trail) off every
  // tenant's card without the countable's own permission check having to know who is
  // asking — `dashboard-query.route` only ever authorizes at TENANT scope, so a
  // countable that needs the stricter GLOBAL gate (`tenant`, `user`) cannot be
  // expressed here at all and stays out of this registry.
  const ctx = isRootTenant(tenantId) ? tenantCtx(tenantId) : tenantCtx(tenantId, { scope: 'tenant' })
  // Only modules active for this tenant count; one broken contributor is logged and
  // skipped by the host runtime, so it never blanks every other module's counters.
  const { loaded } = await ext.loadAll<DashboardCountable[]>(COUNTABLE_POINT, ctx, dashboardCountableLoaders)
  const out = new Map<string, DashboardCountable & { moduleId: string }>()
  for (const { contribution, impl } of loaded) {
    for (const c of Array.isArray(impl) ? impl : []) {
      out.set(`${contribution.moduleId}.${c.key}`, { ...c, moduleId: contribution.moduleId })
    }
  }
  return out
}

/**
 * The qualified countable keys (`<moduleId>.<key>`) ONE module contributes —
 * Faz 9, K13's module-board summary card. Empty when the module publishes no
 * `dashboard:countable` contribution, which is the signal that no summary
 * card should be materialized for it (`00-master-plan.md` §10.2's "no empty
 * shell for a missing capability", the same rule that keeps `hr` out of the
 * board-template gallery today).
 */
export async function countableKeysForModule(tenantId: string, moduleId: string): Promise<string[]> {
  const countables = await collectCountables(tenantId)
  const prefix = `${moduleId}.`
  return [...countables.keys()].filter((key) => key.startsWith(prefix))
}

const EntityCountSource: DashboardDataSource = {
  key: 'entity_count',

  async describe(ctx: DataSourceContext): Promise<DataSourceQueryDef[]> {
    const countables = await collectCountables(ctx.tenantId)
    // D551 (phase 39.16): each count's name in the caller's language (the sources route passes the app language), from its module's
    // dictionary: `<module>.countable.<key>` (the home tiles' key since e2e run 1) or the countable's own `labelKey`
    const text = await contributedLabelTexts(ctx.locale ?? 'en', [...countables.values()].map((c) => c.moduleId))
    return [...countables.entries()].map(([key, c]) => ({
      key,
      label: text(explicitLabelKey(c.labelKey, c.moduleId) ?? countableLabelKey(c.moduleId, c.key), c.label),
      shape: 'scalar' as const,
      requiredPermission: c.requiredPermission,
      params: {},
      defaultTtlSeconds: 60,
      // A row count is a tenant-level fact; per-user visibility is enforced by
      // the query's permission gate, not by the number itself.
      cacheScope: 'tenant' as const,
    }))
  },

  async execute(ctx: DataSourceContext, q: ResolvedQuery): Promise<DataSourceResult> {
    const countables = await collectCountables(ctx.tenantId)
    const countable = countables.get(q.queryKey)
    if (!countable) throw new AppError(MSG.QUERY_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return {
      shape: 'scalar',
      value: await countable.count(ctx.tenantId),
      fetchedAt: new Date().toISOString(),
      ttlSeconds: 60,
    }
  },
}

export default EntityCountSource
