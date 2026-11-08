import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest, grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { listEntityContributions } from './entity-types'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/entity-types — what the alias editor can offer (phase 36): the entity types and relation providers of
 * the modules active for this tenant, narrowed to the ones the caller may read (their `requiredPermission`, decided in
 * one bulk call like the sources route). Labels, whether a type has subtypes, and each provider's relation types and what each kind holds
 * in it (phase 49b, when the provider declares it).
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT' })
    const locale = await appLocaleOf(request, tenantId)
    const { types, relations } = await listEntityContributions(tenantId)
    const granted = await grantedPermissions({
      request, tenantId,
      session: { user: auth.user, tenantMember: auth.tenantMember },
      permissionIds: [...types.map((t) => t.impl.requiredPermission), ...relations.map((r) => r.impl.requiredPermission)],
    })
    const ctx = { tenantId, locale }
    return NextResponse.json({
      entityTypes: types.filter((t) => granted.has(t.impl.requiredPermission)).map((t) => {
        const labels = t.impl.labels(locale)
        return {
          key: t.key, label: labels.one, labelPlural: labels.many,
          ...(labels.subtype ? { subtypeLabel: labels.subtype } : {}),
          hasSubtypes: typeof t.impl.subtypes === 'function',
        }
      }),
      relationProviders: await Promise.all(relations.filter((r) => granted.has(r.impl.requiredPermission)).map(async (r) => ({
        key: r.key, label: r.impl.label(locale), relationTypes: await r.impl.relationTypes(ctx),
        // 49b (W2-M4): what each kind holds in this graph, so a card's picker offers a parameter only where it can fill the slot
        ...(r.impl.holds ? { holds: r.impl.holds } : {}),
      }))),
    })
  } catch (e) {
    return normalizeError(e)
  }
}
