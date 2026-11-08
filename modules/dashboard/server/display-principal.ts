import type { NextRequest } from 'next/server'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import type { ModuleScope } from '@kuraykaraaslan-labs/common/server/module-manifest.types'
import { enforcePermission, FLOOR_RANK, minRoleOf } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.core.next'
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes'
import TenantService from '@kuraykaraaslan-labs/tenant/server/tenant.service'
import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service'
import { assertIpAllowed } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.policy'
import { trustedClientIp } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.client-ip'
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next'
import DashboardBoardService from './board.crud.service'
import DashboardDisplayLinkService from './display-link.service'
import type { DashboardDisplayLink } from './entities/dashboard_display_link.entity'
import type { DashboardBoard } from './entities/dashboard_board.entity'
import { auditDisplay } from './dashboard.audit'
import MSG from './dashboard.messages'

/**
 * The display principal (owner decision 2026-10-17 #10; docs/phases/07-dashboard/20 items 20.2c and 20.2d).
 *
 * ENGINEERING READING, which the owner may reverse: a display link has no identity of its own. It acts with the
 * authority of the member who issued it, CAPPED by that member on every request: the issuer must still be an active
 * member with an active user account, and must still hold `dashboard.boards.manage`, `dashboard.boards.read` and
 * `dashboard.query.execute`, so demoting, suspending or removing them stops every screen they issued on the next
 * request. The alternative (option b) is a real `auth_abac` service principal with its own role; that is the
 * follow-up if the owner prefers it.
 *
 * Every refusal is an AppError. A refusal of a link that resolved also leaves a (throttled) `dashboard.display.denied`
 * audit row; an unknown token only reaches the log. Nothing is cached in v1, so a revocation or a demotion takes
 * effect on the very next request.
 */

/** The permissions the issuer must still hold for the link to work at all. */
export const ISSUER_PERMISSIONS = ['dashboard.boards.manage', 'dashboard.boards.read', 'dashboard.query.execute'] as const

/** `module.resource.verb` → `module.resource` (a copy of the PDP's private helper, for the resource bag). */
const resourceTypeOf = (permission: string): string => {
  const parts = permission.split('.')
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : permission
}

export interface DisplayIssuer {
  userId: string
  session: SubjectSource
}

export interface DisplayContext {
  link: DashboardDisplayLink
  board: DashboardBoard
  issuer: DisplayIssuer
  scope?: ModuleScope
  enabledIds: Set<string>
  /** Gate a permission as the issuer, through the display (`resource.via: 'display'`); throws 403. */
  authorize: (permission: string) => Promise<void>
}

const issuerRevoked = () => new AppError(MSG.DISPLAY_LINK_ISSUER_REVOKED, 403, ErrorCode.FORBIDDEN)

/**
 * The issuer as a policy subject, or null when they may no longer lend their authority: no membership row (removed,
 * soft-deleted, never a member: a global admin or a delegate has none), a membership that is not ACTIVE (INACTIVE,
 * SUSPENDED, PENDING), or a user account that is not ACTIVE (suspended, deactivated by the inactivity job, deleted).
 * Mirrors `tenant_session`'s `validateMemberStatus` inline, as a null answer instead of a thrown one.
 */
export async function resolveIssuer(tenantId: string, userId: string): Promise<DisplayIssuer | null> {
  const member = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId })
  if (!member || member.memberStatus !== 'ACTIVE') return null
  const user = (await TenantMemberService.getByIdWithUser(member.tenantMemberId, tenantId).catch(() => null))?.user
  if (!user || user.userStatus !== 'ACTIVE') return null
  return {
    userId,
    session: {
      user: { userId: user.userId, email: user.email, userProfile: (user as { userProfile?: unknown }).userProfile },
      tenantMember: { memberRole: member.memberRole, roleKeys: member.roleKeys ?? [] },
    },
  }
}

/**
 * Decide `permission` for the issuer, through this display: the catalog floor first (the member's role must reach the
 * permission's `minRole`, exactly as `authenticateAtFloor` would for a session), then the PDP with a resource bag
 * that says `via: 'display'`, so a policy can treat screens apart from people.
 */
export async function displayAuthorize(args: {
  request: NextRequest
  tenantId: string
  session: SubjectSource
  permission: string
  link: Pick<DashboardDisplayLink, 'displayLinkId' | 'boardId'>
}): Promise<void> {
  const role = args.session.tenantMember?.memberRole
  const floor = minRoleOf(args.permission)
  if (!role || (FLOOR_RANK[role as keyof typeof FLOOR_RANK] ?? -1) < FLOOR_RANK[floor]) throw issuerRevoked()
  try {
    await enforcePermission({
      request: args.request,
      requiredPermission: args.permission,
      resource: { type: resourceTypeOf(args.permission), via: 'display', displayLinkId: args.link.displayLinkId, boardId: args.link.boardId },
    }, args.tenantId, args.session)
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 403) throw issuerRevoked()
    throw e
  }
}

/** Whether the issuer would still pass every check of `resolveDisplayContext` (for the management list). */
export async function issuerEligible(request: NextRequest, tenantId: string, link: Pick<DashboardDisplayLink, 'displayLinkId' | 'boardId' | 'createdByUserId'>): Promise<boolean> {
  try {
    const issuer = await resolveIssuer(tenantId, link.createdByUserId)
    if (!issuer) return false
    for (const p of ISSUER_PERMISSIONS) await displayAuthorize({ request, tenantId, session: issuer.session, permission: p, link })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a display request (its token already read from its header, `display-token.ts`) into the context its route runs in.
 * In order: the link (tenant-scoped lookup by hash: 404 unknown, 410 revoked or expired), the tenant (not ACTIVE →
 * 403), the tenant's IP allow/deny lists (→ 403 `TENANT_IP_NOT_ALLOWED`), the board (gone, or private to someone other than the issuer → 404), the issuer (→ 403) and the issuer's permissions (→ 403). Every refusal
 * after the lookup is audited; an unknown token is not (there is no link to name).
 */
export async function resolveDisplayContext(request: NextRequest, tenantId: string, rawToken: string): Promise<DisplayContext> {
  const link = await DashboardDisplayLinkService.lookup(tenantId, rawToken)
  if (!link) throw new AppError(MSG.DISPLAY_LINK_INVALID, 404, ErrorCode.NOT_FOUND)
  try {
    DashboardDisplayLinkService.assertLive(link)
    const tenant = await TenantService.getById(tenantId).catch(() => null)
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') throw new AppError(MSG.DISPLAY_TENANT_UNAVAILABLE, 403, ErrorCode.FORBIDDEN)
    // The tenant's IP allow/deny lists, exactly as for a signed-in member (tenant_session.authenticate.next.ts): a screen
    // is no exemption, so a link carried outside an allowed network stops there (403 TENANT_IP_NOT_ALLOWED).
    await assertIpAllowed(tenantId, trustedClientIp(request))

    const board = await DashboardBoardService.get(tenantId, link.boardId, { userId: link.createdByUserId })
    // A private board shows only for its owner's links (INC-03, 2026-10-27); the issuer checks below still ask boards.manage.
    if (board.scope !== 'TENANT' && board.ownerUserId !== link.createdByUserId) throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)

    const issuer = await resolveIssuer(tenantId, link.createdByUserId)
    if (!issuer) throw issuerRevoked()
    const authorize = (permission: string) => displayAuthorize({ request, tenantId, session: issuer.session, permission, link })
    for (const p of ISSUER_PERMISSIONS) await authorize(p)

    return {
      link,
      board,
      issuer,
      scope: isRootTenant(tenantId) ? undefined : 'tenant',
      enabledIds: await getEnabledModuleIds(tenantId),
      authorize,
    }
  } catch (e) {
    await auditDisplay({
      tenantId, action: 'dashboard.display.denied', linkId: link.displayLinkId, boardId: link.boardId,
      issuerUserId: link.createdByUserId, request,
      metadata: { status: e instanceof AppError ? e.statusCode : 500, reason: e instanceof AppError ? e.message : 'error' },
    })
    throw e
  }
}
