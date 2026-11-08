import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { TimeWindowSchema, WindowOffsetSchema } from './board-window'
import type { DataSourceResult } from './data-source.types'
import { PagingRequestSchema } from './query-paging'
import { runQuery } from './query-runner'
import { BoardContextDTO } from './dashboard.dto'

const ExecuteQueryDTO = z.object({
  sourceKey: z.string().min(1).max(100),
  queryKey: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).default({}),
  /** Placement-level window: `'board'` (default) or a window this placement pins. */
  window: z.union([z.literal('board'), TimeWindowSchema]).optional(),
  windowOffset: WindowOffsetSchema.optional(),
  /** Page, sort and search of a table query that declared `paging` (18.1); refused for any other query. */
  paging: PagingRequestSchema.optional(),
  /**
   * The board the query runs on, with the VIEWER's overrides. The board is read
   * under the same visibility rule as opening it (someone else's private board
   * is a 404), saved defaults are merged under the overrides, and every override
   * is validated against the board's own parameter schema.
   */
  boardContext: BoardContextDTO.optional(),
}).strict()

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST …/dashboard/query — THE one query runner (phase 4b §3.4). Three gates,
 * in order, before any provider code runs:
 *
 *   ① the route's own permission (`dashboard.query.execute`);
 *   ② the contribution must be DISCOVERABLE for this caller (enabled module
 *      set + scope) — `sourceKey` resolves in the build-time map or nothing
 *      happens;
 *   ③ the QUERY's own declared permission, enforced HERE, before execute() —
 *      so a provider that forgot its own guard is still unreachable to an
 *      unauthorized caller.
 *
 * Params are validated against the query's FieldSchema with unknown keys
 * REJECTED. There is no URL anywhere in this model. The cache (`dash:q:*`)
 * sits BEHIND all three gates and is keyed by `cacheScope`, which now DEFAULTS
 * to `'tenant'` (D2, owner decision 2026-09-03).
 *
 * That default is the cheap direction and also the leaking one, so it does not
 * stand alone: `ctx.userId` is a watched getter, and a query that read it under
 * tenant scope is answered LIVE and never cached. Forgetting to declare
 * `'user'` therefore costs a cache miss instead of showing one member's data to
 * another — and the log says which query to fix.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    // ① the route's own permission.
    const auth = await authorizeRequest({
      request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT',
    })
    const dto = ExecuteQueryDTO.parse(await request.json())

    return NextResponse.json(await runQuery({
      request, tenantId, userId: auth.user.userId,
      query: { sourceKey: dto.sourceKey, queryKey: dto.queryKey, params: dto.params, window: dto.window, windowOffset: dto.windowOffset, paging: dto.paging },
      boardContext: dto.boardContext,
    }))
  } catch (e) {
    return normalizeError(e)
  }
}

/** Exposed for provider discovery UIs later (phase 5); result mirrors describe(). */
export type { DataSourceResult }
