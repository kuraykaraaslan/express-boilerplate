import type { NextRequest } from 'next/server'
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes'
import { elementAuthoringPermissions, type ElementAuthoring } from './element-actions.registry'

/**
 * The caller's side of `ElementActionsProvider.authoringPermission`: does THIS caller hold a permission a provider names?
 * Answered with the same resolver the route guards and the admin shell use (`grantedPermissions`: the role floor, a custom
 * group's lift and the PDP, on the session the route already authenticated), so a permission is decided the same way here as
 * on a route that guards it. Asked lazily (a route only pays for it when a command entry is new or changed) and once per
 * permission per request. The dashboard never names the permission: the provider does.
 */
export function elementAuthoringFor(request: NextRequest, tenantId: string, session: SubjectSource): ElementAuthoring {
  const asked = new Map<string, Promise<boolean>>()
  return (permission) => {
    let answer = asked.get(permission)
    if (!answer) {
      answer = grantedPermissions({ request, tenantId, session, permissionIds: [permission] }).then((granted) => granted.has(permission))
      asked.set(permission, answer)
    }
    return answer
  }
}

/**
 * Per widget type, may THIS caller author a command entry on its elements? Only types whose provider names an
 * `authoringPermission` appear (absent = no extra permission is asked). A hint for the editor to hide the option: the save
 * re-checks it either way.
 */
export async function elementAuthoringMapFor(request: NextRequest, tenantId: string, session: SubjectSource): Promise<Record<string, boolean>> {
  const permissions = await elementAuthoringPermissions(tenantId)
  const ask = elementAuthoringFor(request, tenantId, session)
  const out: Record<string, boolean> = {}
  for (const [widgetType, permission] of Object.entries(permissions)) out[widgetType] = await ask(permission)
  return out
}
