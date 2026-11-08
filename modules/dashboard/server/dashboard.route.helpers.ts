import type { NextRequest } from 'next/server'
import { authorizeRequest, grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next'
import type { ModuleScope } from '@kuraykaraaslan-labs/common/server/module-manifest.types'
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes'

/**
 * The things every dashboard route needs after authorizing: the caller's
 * session (so the permission resolver never re-authenticates), the contribution
 * scope, the tenant's enabled-module set, and — when asked — which of a set of
 * EXTRA permissions the caller also holds, without requiring any of them.
 *
 * Kept together because getting the scope wrong is silent — the root tenant sees
 * system AND tenant contributions, everyone else only tenant ones, which is what
 * the page did before the module existed.
 *
 * `alsoCheck` exists for `dashboard.boards.manage` (Faz 9, K3): a write route's
 * ENTRY gate stays `dashboard.boards.write` (any USER may reach it, because they
 * may write their own PRIVATE board), and `granted` is how the route then learns
 * whether THIS caller may also write a TENANT one — `grantedPermissions` answers
 * that without throwing, exactly the way the widget catalog asks "which of these
 * may this caller see" instead of guarding one fixed permission.
 */
export async function dashboardContext(args: {
  request: NextRequest
  tenantId: string
  requiredPermission: string
  alsoCheck?: string[]
}): Promise<{
  session: SubjectSource
  userId: string
  scope?: ModuleScope
  enabledIds: Set<string>
  granted: Set<string>
  /** How the caller reached the tenant: a display link may only be minted by a member acting as themselves (#10). */
  auth: { isGlobalAdmin?: boolean; isImpersonating?: boolean }
}> {
  const auth = await authorizeRequest({
    request: args.request,
    tenantId: args.tenantId,
    requiredPermission: args.requiredPermission,
    scope: 'TENANT',
  })
  const session: SubjectSource = { user: auth.user, tenantMember: auth.tenantMember }
  const granted = args.alsoCheck?.length
    ? await grantedPermissions({
        request: args.request, tenantId: args.tenantId, session, permissionIds: args.alsoCheck,
      })
    : new Set<string>()
  return {
    session,
    userId: auth.user.userId,
    scope: isRootTenant(args.tenantId) ? undefined : 'tenant',
    enabledIds: await getEnabledModuleIds(args.tenantId),
    granted,
    auth: { isGlobalAdmin: auth.isGlobalAdmin, isImpersonating: auth.isImpersonating },
  }
}
