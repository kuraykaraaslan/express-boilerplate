import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService, {
  assertCanWrite, canWrite, type BoardAnchor, type BoardListFilter,
} from './board.crud.service'
import { BoardListQueryDTO, CreateBoardDTO } from './dashboard.dto'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { assertBoardHeadroom, sharedBoardQuota } from './dashboard.entitlement'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import { memberLabels } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * `?anchor=workspace:<id>` | `module:<id>` | `none` (Faz 9, dilim 9.1) — the
 * hub's three questions ("this workspace's boards", "this module's boards",
 * "boards filed under neither") as one query param rather than two
 * (`workspace=`/`moduleId=`) that could both be set and disagree with each
 * other or with `none`.
 */
function parseAnchor(raw: string | null): BoardAnchor | undefined {
  if (!raw) return undefined
  if (raw === 'none') return {}
  const [kind, id] = raw.split(':', 2)
  if (kind === 'workspace' && id) return { workspace: id }
  if (kind === 'module' && id) return { moduleId: id }
  return undefined
}

/**
 * GET …/dashboard/boards?anchor=&scope=&mine= — boards this caller can open (`{ boards, canManage }`, every one at once: the board
 * switcher, the trail and the action editor's board picker read it so). With `page` or `pageSize` it answers one page of the dashboards
 * list instead (`/admin/dashboards`, the phase 43 list contract, `BoardListQueryDTO`): `{ data, total, canManage }`. With `quota=1`
 * either form also carries `sharedQuota: { used, limit }` for a caller holding `dashboard.boards.manage`.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.read',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const sp = new URL(request.url).searchParams
    const scopeParam = sp.get('scope')
    const filter: BoardListFilter = {
      anchor: parseAnchor(sp.get('anchor')),
      scope: scopeParam === 'TENANT' || scopeParam === 'PRIVATE' ? scopeParam : undefined,
      mine: sp.get('mine') === '1',
      // K15: a board anchored to a module this tenant has since disabled is
      // hidden here too, not only in the hub that reads this list.
      enabledIds: ctx.enabledIds,
    }
    const hasManage = ctx.granted.has('dashboard.boards.manage')
    // Who made each shared board (the hub's Owner column, owner request 2026-10-22); a personal board is the caller's own.
    const withOwners = async (boards: Awaited<ReturnType<typeof DashboardBoardService.list>>) => {
      const owners = await memberLabels(tenantId, boards.filter((b) => b.scope === 'TENANT').map((b) => b.createdByUserId)).catch(() => ({} as Record<string, string>))
      return boards.map((b) => ({
        ...b,
        canWrite: canWrite(b, hasManage),
        ownerLabel: b.scope === 'TENANT' && b.createdByUserId ? owners[b.createdByUserId] ?? null : null,
      }))
    }
    // Phase 39 (UX-14), on `?quota=1` (the New board dialog asks one row of the page form): how many shared boards the plan
    // allows and how many there are (the seeded samples count, INC-03), for whoever may create one; `limit` null = unlimited.
    const quota = hasManage && sp.get('quota') === '1' ? { sharedQuota: await sharedBoardQuota(tenantId) } : {}
    if (sp.has('page') || sp.has('pageSize')) {
      const { rows, total } = await DashboardBoardService.page(tenantId, { userId: ctx.userId }, readListQuery(sp, BoardListQueryDTO))
      return NextResponse.json({ data: await withOwners(rows), total, canManage: hasManage, ...quota })
    }
    const boards = await DashboardBoardService.list(tenantId, { userId: ctx.userId }, filter)
    return NextResponse.json({
      boards: await withOwners(boards),
      // The caller's real `dashboard.boards.manage` grant (15.2a): the hub offers
      // the "shared" option from this, not from a guess at `memberRole`.
      canManage: hasManage,
      ...quota,
    })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST …/dashboard/boards — create a board.
 *
 * `dashboard.boards.write` is the entry gate (any USER may reach it, because
 * they may always create their own PRIVATE board); a request for `scope:
 * 'TENANT'` additionally needs `dashboard.boards.manage` (K3) — the same rule
 * every other write route in this module applies, checked here on the DTO's
 * requested scope rather than on a row that does not exist yet.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const dto = CreateBoardDTO.parse(await request.json())
    assertCanWrite({ scope: dto.scope }, ctx.granted.has('dashboard.boards.manage'))
    await assertBoardHeadroom(tenantId, dto.scope, ctx.userId)
    const board = await DashboardBoardService.create(tenantId, dto, { userId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.create', resourceType: 'dashboard_board',
      resourceId: board.boardId, metadata: { scope: board.scope },
    })
    return NextResponse.json({ board }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
