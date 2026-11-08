import Logger from '@kuraykaraaslan-labs/logger'
import type { ScopeMode } from '@kuraykaraaslan-labs/common/server/common.crm-contracts'

export interface TeamScope {
  mode: ScopeMode
  scopeIds?: string[]
}

/**
 * The body every `auth_abac:record_scope` resolver in this codebase shares.
 *
 * The per-module resolvers differ in exactly one thing — which permission ids
 * they own — so that is all they should have to say. Copying the team lookup
 * into each of them would mean four places to fix when "team" changes meaning,
 * and four chances for one of them to disagree with the others about who a
 * salesperson's colleagues are.
 *
 * It lives in `organization` rather than in `auth_abac` on purpose: this is the
 * one module that knows what a team IS. `auth_abac` deliberately does not, and
 * a resolver here keeps that ignorance intact.
 */
export async function teamScopeFor(
  tenantId: string,
  userId: string,
  permissionId: string,
  ownedPrefix: string,
): Promise<TeamScope | null> {
  // Not my permission. A `startsWith` is the whole cost of being asked about
  // somebody else's module.
  if (!permissionId.startsWith(ownedPrefix)) return null

  const { default: OrganizationTeamService } = await import('./organization.team.service')
  const scopeIds = await OrganizationTeamService.teammateIdsFor(tenantId, userId)

  // One id means the user is in no team, and "my team is me" is just OWN said
  // the long way. Returning TEAM with a single id would build a pointless
  // `IN (...)` on every list query for every unteamed user in the tenant.
  if (scopeIds.length <= 1) return { mode: 'OWN' }

  return { mode: 'TEAM', scopeIds }
}

/**
 * Build a resolver for one module's permission namespace.
 *
 * Errors are RE-THROWN, not swallowed. It is tempting to catch here and return
 * OWN, which looks like the same fail-closed outcome — but it would hide the
 * failure from `VisibilityService`, which is the thing that logs it and the
 * thing that must not let a second resolver overrule a broken first one. A
 * resolver that quietly degrades is a resolver nobody knows is broken.
 */
export function recordScopeResolver(ownedPrefix: string) {
  return async (tenantId: string, userId: string, permissionId: string): Promise<TeamScope | null> => {
    const scope = await teamScopeFor(tenantId, userId, permissionId, ownedPrefix)
    if (scope?.mode === 'TEAM') {
      Logger.debug?.(`[organization] ${ownedPrefix} scope for ${userId}: ${scope.scopeIds?.length} ids`)
    }
    return scope
  }
}
