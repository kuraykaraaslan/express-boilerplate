import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { resolveWsPublicUrl } from '@kuraykaraaslan-labs/websocket/server/websocket.public-url'
import { wsTicketSubject } from '@kuraykaraaslan-labs/websocket/server/websocket.session-binding';
import MSG from './dashboard.messages'
import { authorizeQuery, resolveBoardState, prepareParams, aliasResolverFor, aliasValuesFor, type BoardContextInput, type BoardState } from './query-gates'
import { TimeWindowSchema, WindowOffsetSchema, toVars } from './board-window'
import { liveTicketService } from './live.ticket.service'
import { BoardContextDTO } from './dashboard.dto'
import {
  LIVE_NAMESPACE_PATH, MAX_TICKET_BINDINGS, MAX_TICKET_CONTEXTS, MAX_TICKET_TOPICS, liveSessionSeconds, type LiveTicketPayload,
} from './live.types'
import type { DataSourceContext } from './data-source.types'
import { appLocaleOf } from './board-template.locale'

const BindingDTO = z.object({
  sourceKey: z.string().min(1).max(100),
  queryKey: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).default({}),
  window: z.union([z.literal('board'), TimeWindowSchema]).optional(),
  /** The stored binding's 24.2b offset, accepted as the query routes accept it: a previous-period slot is answered "poll". */
  windowOffset: WindowOffsetSchema.optional(),
  /** Which of `contexts` this binding runs in (default 0). Only together with `contexts`. */
  ctx: z.number().int().min(0).max(MAX_TICKET_CONTEXTS - 1).optional(),
}).strict()

/**
 * Either the lone `boardContext` (a board showing one page, unchanged) or `contexts` (page frames, docs/phases/07-dashboard/29:
 * the base page and its open layers, each with its own parameter values) with `bindings[i].ctx` pointing into it. Never
 * both. Every context names the SAME board or template: one ticket feeds one socket, and one socket is one board (11 §11.3).
 */
const LiveTicketDTO = z.object({
  bindings: z.array(BindingDTO).min(1).max(MAX_TICKET_BINDINGS),
  boardContext: BoardContextDTO.optional(),
  contexts: z.array(BoardContextDTO).min(1).max(MAX_TICKET_CONTEXTS).optional(),
}).strict().superRefine((dto, issues) => {
  if (dto.boardContext && dto.contexts) {
    issues.addIssue({ code: 'custom', path: ['contexts'], message: 'Send boardContext or contexts, not both' })
    return
  }
  const count = dto.contexts?.length ?? 0
  dto.bindings.forEach((b, i) => {
    if (b.ctx !== undefined && b.ctx >= count) {
      issues.addIssue({ code: 'custom', path: ['bindings', i, 'ctx'], message: count ? 'ctx points past contexts' : 'ctx needs contexts' })
    }
  })
  const first = dto.contexts?.[0]
  if (first && dto.contexts!.some((c) => c.boardId !== first.boardId || c.templateKey !== first.templateKey)) {
    issues.addIssue({ code: 'custom', path: ['contexts'], message: 'Every context must name the same board' })
  }
})

/** One distinct context, resolved once: its parameter values and the source context its bindings run under. */
type Frame =
  | { ok: true; paramValues: Record<string, unknown>; hasBoardContext: boolean; ctx: DataSourceContext; state: BoardState }
  | { ok: false; error: AppError }

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST …/dashboard/live-ticket — authorise live subscriptions and mint ONE
 * single-use `/dashboard` handshake ticket (docs/phases/07-dashboard/11 §11.2).
 *
 * Every binding goes through `authorizeQuery` — the SAME discoverability and
 * per-query permission gates the executor applies — and the topics come from the
 * source's own `live.topics()` over VALIDATED params. The ticket's payload is
 * that topic list; the gateway joins exactly those rooms. Bindings that are not
 * live (or whose query the caller may not run) are reported per index so the
 * client can poll them instead; one refused binding never blocks the others.
 * A query that declares `paging` is reported not-live even when it also declares
 * `live`: its deltas would not line up with the page the viewer is on. So is a
 * windowed query read for the period before (`windowOffset: 'previous'`, 24.2b):
 * its topics carry what happens NOW, which belongs to the current window, never
 * to the previous one, so that slot polls (docs/phases/07-dashboard/40 40.10.1).
 *
 * `wsUrl` is `null` when the deployment has no gateway URL: the client then
 * polls, the same degrade the other namespaces follow.
 *
 * The same ticket opens a socket or is presented on the open one (`ticket:replace`, docs/phases/07-dashboard/40 D40-4):
 * the gateway judges both alike. `sessionExpiresIn` says how long that socket then runs before the gateway re-authorises
 * it (`liveSessionSeconds`), so the client presents a fresh ticket about a minute before (D40-5).
 *
 * Several contexts (page frames, 29): each DISTINCT context is resolved once and
 * every binding is prepared with its own context's values, through the same
 * per-binding gates. A context that fails to resolve refuses only its own
 * bindings (`forbidden` / `invalid`); when every context fails, the first one's
 * error is the answer, so a lone context — and a board the caller cannot see —
 * fails exactly as the single `boardContext` always has.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    // ① the route's own permission (running a query is what a live one is).
    const auth = await authorizeRequest({
      request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT',
    })
    const dto = LiveTicketDTO.parse(await request.json())
    // The app language, as the runner reads it (`appLocaleOf`): a live answer must speak the words the first answer spoke.
    const locale = await appLocaleOf(request, tenantId)
    const resolveFrame = async (boardContext: BoardContextInput | undefined): Promise<Frame> => {
      try {
        const state = await resolveBoardState(tenantId, auth.user.userId, boardContext)
        const { paramValues } = state
        return {
          ok: true, paramValues, hasBoardContext: !!boardContext, state,
          ctx: { tenantId, userId: auth.user.userId, locale, vars: toVars(paramValues) },
        }
      } catch (e) {
        if (!(e instanceof AppError)) throw e
        return { ok: false, error: e }
      }
    }
    // The old shape is one context (possibly none); identical contexts share one resolution.
    const requested: Array<BoardContextInput | undefined> = dto.contexts ?? [dto.boardContext]
    const byKey = new Map<string, Promise<Frame>>()
    const frames = await Promise.all(requested.map((c) => {
      const key = JSON.stringify(c ?? null)
      let frame = byKey.get(key)
      if (!frame) { frame = resolveFrame(c); byKey.set(key, frame) }
      return frame
    }))
    if (frames.every((f) => !f.ok)) throw (frames[0] as Extract<Frame, { ok: false }>).error

    const topics = new Set<string>()
    const bindings: Array<
      | { live: false; reason: 'not-live' | 'forbidden' | 'invalid' }
      | { live: true; topics: string[]; merge: 'append' | 'replace' | 'upsert'; maxPoints?: number; upsertKey?: string }
    > = []

    for (const binding of dto.bindings) {
      const frame = frames[binding.ctx ?? 0]
      if (!frame.ok) { bindings.push({ live: false, reason: frame.error.statusCode === 403 ? 'forbidden' : 'invalid' }); continue }
      try {
        const { def } = await authorizeQuery({
          request, tenantId, sourceKey: binding.sourceKey, queryKey: binding.queryKey, ctx: frame.ctx,
        })
        // A paged table (18.1) is never live: a delta cannot be reconciled with one sorted, searched page
        // (an upserted row may belong to another page, an appended one shifts every offset), so it keeps polling.
        if (!def.live || def.paging) { bindings.push({ live: false, reason: 'not-live' }); continue }
        // The period before (24.2b) is shifted only for a query that follows a window: a delta from now is never its data,
        // so its slot polls (the runner keeps sliding a relative one). Without a window the offset changes nothing.
        if (binding.windowOffset === 'previous' && def.window === 'board') { bindings.push({ live: false, reason: 'not-live' }); continue }
        // Entity parameters (phases 36, 41): the same resolution, behind the same entity-type permissions, as the query route.
        const aliasValues = await aliasValuesFor(def, binding.params, frame.state, () => aliasResolverFor(frame.state, {
          tenantId, locale,
          authorize: async (permission) => { await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' }) },
        }))
        const clean = prepareParams(def, binding.params, frame.state, frame.hasBoardContext, aliasValues)
        const own = await def.live.topics(frame.ctx, clean)
        for (const t of own) topics.add(t)
        bindings.push({
          live: true, topics: own, merge: def.live.merge,
          ...(def.live.maxPoints ? { maxPoints: def.live.maxPoints } : {}),
          ...(def.live.upsertKey ? { upsertKey: def.live.upsertKey } : {}),
        })
      } catch (e) {
        if (!(e instanceof AppError)) throw e
        bindings.push({ live: false, reason: e.statusCode === 403 ? 'forbidden' : 'invalid' })
      }
    }

    if (topics.size > MAX_TICKET_TOPICS) {
      throw new AppError(MSG.LIVE_TOO_MANY_TOPICS, 422, ErrorCode.VALIDATION_ERROR)
    }

    const wsUrl = resolveWsPublicUrl().url
    if (topics.size === 0 || !wsUrl) {
      // Nothing to subscribe to, or no gateway: no ticket is minted at all.
      return NextResponse.json({ ticket: null, wsUrl: wsUrl ?? null, path: LIVE_NAMESPACE_PATH, bindings })
    }

    // Only a full user session gets a ticket (websocket 04 §4.8).
    const payload: LiveTicketPayload = { tenantId, topics: [...topics], ...wsTicketSubject({ ...auth, origin: request.headers.get('origin') }), iat: Date.now() }
    const { ticket, expiresIn } = await liveTicketService.mint(payload)
    const sessionExpiresIn = liveSessionSeconds(payload.sessionExpiresAt, payload.iat)
    return NextResponse.json({ ticket, expiresIn, sessionExpiresIn, wsUrl, path: LIVE_NAMESPACE_PATH, bindings }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
