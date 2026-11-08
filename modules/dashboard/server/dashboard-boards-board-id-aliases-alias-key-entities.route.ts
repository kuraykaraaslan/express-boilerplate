import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { BoardContextParamsSchema } from './board-window'
import { aliasMembersReader } from './alias-members'

const MembersDTO = z.object({
  /** The viewer's current param values (a state entity, a param root read them). */
  params: BoardContextParamsSchema.optional(),
  search: z.string().max(120).optional(),
}).strict()

type Ctx = { params: Promise<{ tenantId: string; boardId: string; aliasKey: string }> }

/**
 * POST …/dashboard/boards/[boardId]/aliases/[aliasKey]/entities — the entities an alias of this board resolves to, for
 * the toolbar entity select (phase 36, E36-6): 50 at a time by name, narrowed by `search`. The board is read under the
 * same visibility rule as opening it; the entities behind their type's read permission. A board view gets the lists of the
 * board's own defaults with the board when it opens (phase 40, D40-12): both come from `aliasMembersReader`.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId, aliasKey } = await params
    await Limiter.checkRateLimit(request)
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT' })
    const dto = MembersDTO.parse(await request.json().catch(() => ({})))
    const reader = await aliasMembersReader(request, tenantId, auth.user.userId, boardId, dto.params)
    return NextResponse.json(await reader.members(aliasKey, dto.search))
  } catch (e) {
    return normalizeError(e)
  }
}
