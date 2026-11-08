import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest, grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardDataSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.data_source'
import {
  DATA_SOURCE_POINT,
  type DashboardDataSource,
  type DataSourceContext,
  type DataSourceQueryDef,
} from './data-source.types'
import { appLocaleOf } from './board-template.locale'
import { contributedLabelTexts } from './contributed-label-texts'
import { dataSourceLabelKey, explicitLabelKey } from './contributed-labels'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/sources — what the binding editor can offer: every
 * discoverable data source with its `describe()` output, narrowed to the
 * queries the caller may RUN (dashboard.13). Metadata only (keys, labels,
 * shapes, param schemas), but the catalogue of an admin-only query is still
 * something a member should not learn; the runner enforces the same permission
 * on every execution. All the queries' permissions are decided in one bulk
 * call. One broken provider is skipped with a log line rather than blanking
 * the whole picker.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const auth = await authorizeRequest({
      request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT',
    })

    const ctx: DataSourceContext = {
      tenantId,
      userId: auth.user.userId,
      // the app language, as the runner reads it (run 3 #14: the sources' and queries' names follow the workspace, not the browser)
      locale: await appLocaleOf(request, tenantId),
      vars: {},
    }

    // Sources of the modules active for this tenant; one whose load or describe() fails is logged and skipped by
    // the host runtime.
    const { results } = await ext.aggregate<DashboardDataSource, DataSourceQueryDef[] | null>(
      DATA_SOURCE_POINT, tenantCtx(tenantId), dashboardDataSourceLoaders,
      (source, _signal, contribution) => (contribution.key ? source.describe(ctx) : null),
    )
    // D551 (phase 39.16): a source's group name in the same language, from its module's dictionary (`<module>.dataSource.<key>`, or the
    // contribution's own `metadata.labelKey`), the English as declared without one
    const text = await contributedLabelTexts(ctx.locale, results.map((r) => r.contribution.moduleId))
    const sources: Array<{ sourceKey: string; label: string; queries: DataSourceQueryDef[] }> = []
    for (const { contribution, value } of results) {
      if (!contribution.key || !value) continue
      const label = contribution.metadata.label
      sources.push({
        sourceKey: contribution.key,
        label: typeof label === 'string' && label
          ? text(explicitLabelKey(contribution.metadata.labelKey, contribution.moduleId) ?? dataSourceLabelKey(contribution.moduleId, contribution.key), label)
          : contribution.key,
        queries: value,
      })
    }

    const granted = await grantedPermissions({
      request, tenantId,
      session: { user: auth.user, tenantMember: auth.tenantMember },
      permissionIds: sources.flatMap((src) => src.queries.map((q) => q.requiredPermission)),
    })
    const permitted = sources.map((src) => ({ ...src, queries: src.queries.filter((q) => granted.has(q.requiredPermission)) }))

    return NextResponse.json({ sources: permitted })
  } catch (e) {
    return normalizeError(e)
  }
}
