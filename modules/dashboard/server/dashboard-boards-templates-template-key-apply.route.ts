import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import { assertBoardHeadroom } from './dashboard.entitlement'
import { VALUE_CHAIN_WIDGET_REF, placeableAnywhere, requiredModulesOn } from './board-templates'
import { findBoardTemplate } from './board-template.registry'
import { resolveTemplateWidgets, expandTemplate } from './board-template.resolve'
import { z } from 'zod'
import BoardTemplateService from './board-template.service'
import MSG from './dashboard.messages'
import { commandVerdictsFor, stripUnauthorisedCommands } from './command-verdicts'
import { elementAuthoringFor } from './element-authoring'
import { CreateBoardDTO } from './dashboard.dto'
import { TemplateAnswersSchema, answeredParams, assertAnswerExists } from './board-template.answers'
import { selectEntityType } from './entity-types'
import { templateInLocale } from './board-template.texts'
import { templateLocaleOf } from './board-template.locale'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { appLocaleOf } from './board-template.locale'

const ApplyDTO = z.object({
  /** "Duplicate" from a transient render: a personal copy, not the anchor's default. */
  asCopy: z.boolean().optional(),
  /** The viewer's parameter values, saved as the copy's defaults. */
  params: z.record(z.string(), z.unknown()).optional(),
  /**
   * Place the template's cards onto this EXISTING board instead of creating one (owner decision 15): below what is
   * already there, rescaled to the board's columns. Not combined with `asCopy` / `params`, which describe a new board.
   */
  boardId: z.string().uuid().optional(),
  /**
   * Phase 49b, the "New dashboard" dialog: a new board of its own made from the template, with the person's title, description, sharing and
   * workspace (the fields a plain create takes, `CreateBoardDTO`). Never the anchor's default, never idempotent.
   */
  asNew: z.object({
    title: CreateBoardDTO.shape.title,
    description: CreateBoardDTO.shape.description,
    scope: z.enum(['TENANT', 'PRIVATE']),
    workspace: CreateBoardDTO.shape.workspace,
  }).strict().optional(),
  /** Phase 49b: the answer to the template's question (only with `asNew`). */
  answers: TemplateAnswersSchema.optional(),
}).strict()
  .refine((b) => !b.boardId || (!b.asCopy && b.params === undefined), { message: 'boardId cannot be combined with asCopy or params', path: ['boardId'] })
  .refine((b) => !b.asNew || (!b.asCopy && b.params === undefined && !b.boardId), { message: 'asNew cannot be combined with asCopy, params or boardId', path: ['asNew'] })
  .refine((b) => b.answers === undefined || !!b.asNew, { message: 'answers go with asNew', path: ['answers'] })

type Ctx = { params: Promise<{ tenantId: string; templateKey: string }> }

/**
 * POST …/dashboard/boards/templates/[templateKey]/apply — one-click board setup
 * (erp Faz 10 — "hazır 'Değer zinciri' pano şablonu").
 *
 * Idempotent exactly like `dashboard-workspaces-workspace-board.route.ts`'s
 * "customise": if the template's anchor already has a default board — hand
 * customised, or from an earlier apply — this hands that board back instead of
 * creating a second one nobody could reach (there is still no board switcher).
 * Only when the anchor has none does this seed the template AS the default,
 * so it is immediately visible with no new navigation UI required.
 *
 * Faz 9, K4: without `dashboard.boards.manage` this seeds the caller's OWN
 * personal default rather than the workspace's shared one — see
 * `BoardTemplateService.apply`'s `hasManage` note.
 *
 * A template's `command` actions pass the same authoring gate as a hand-made placement:
 * entries for a command the caller could not run themselves are dropped before the copy
 * and counted in `droppedCommands`.
 *
 * `{ boardId }` (owner decision 15) places the template's cards onto that existing board instead (`applyOnto`):
 * rescaled from the template's `gridCols` to the board's, below its current cards, 200 with `created: false`. A template that asks a
 * question (phase 49b) makes a board of its own and is never placed onto another one (409): its cards read the asked parameter, which the
 * other board does not have, and re-applying a template on an edited board is not offered (phase 13).
 *
 * `{ asNew, answers? }` (phase 49b, the "New dashboard" dialog): a NEW board of the person's own (title, description, sharing, workspace), never
 * the anchor's default: a shared one needs `dashboard.boards.manage` (403), the plan's headroom is checked, and the answer to the template's
 * question becomes the asked parameter's choice; an answer naming an entity is looked up with the caller's read permission of its type in
 * the caller's tenant (another tenant's id is a 422, an option the template does not offer a 400).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, templateKey } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })

    // Built-ins plus contributions of ENABLED modules only (K15): a disabled
    // module's template is a 404, exactly as if it did not exist.
    const found = await findBoardTemplate(templateKey, tenantId)
    // R49b-3: a template whose cards read a module the tenant has off (`requires`) is a 404 on every path, as one of a disabled module is
    const expanded = found && requiredModulesOn(found, ctx.enabledIds) ? await expandTemplate(tenantId, found) : null
    if (!expanded) throw new AppError(MSG.TEMPLATE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    // D118 (e): every path stores the template's words in the creator's language (card titles, page titles, parameter labels, the board's title)
    const template = await templateInLocale(expanded, await templateLocaleOf(request, tenantId))
    const body = ApplyDTO.parse(await request.json().catch(() => ({})))

    if (body.boardId) {
      if (template.ask) throw new AppError(MSG.TEMPLATE_MAKES_OWN_BOARD, 409, ErrorCode.CONFLICT)
      return await applyOnto(request, tenantId, ctx, template, templateKey, body.boardId)
    }
    if (body.asNew) return await applyAsNew(request, tenantId, ctx, template, templateKey, body.asNew, body.answers)

    const existing = body.asCopy
      ? null
      : await DashboardBoardService.findDefault(tenantId, { userId: ctx.userId }, template.anchor)
    if (existing) return NextResponse.json({ board: existing, created: false, skipped: [] })

    // Re-resolved for THIS caller before anything is placed — the same rule
    // `dashboard-boards-board-id-instances.route.ts` applies to a manual
    // placement: a template is a shortcut for the same action, not an
    // exemption from the same check.
    const hasManage = ctx.granted.has('dashboard.boards.manage')
    const targetScope = body.asCopy || !hasManage ? 'PRIVATE' : 'TENANT'
    const { resolvable } = await resolveTemplateWidgets({ request, tenantId, ctx, template, targetScope })
    // A sections template places ONE known widget: if the caller cannot see it the
    // whole apply is refused (as before). A placements template reports the ones
    // it had to leave out BY NAME instead, and refuses only when none can be placed.
    if (!template.placements?.length && !resolvable.has(VALUE_CHAIN_WIDGET_REF)) {
      throw new AppError(MSG.WIDGET_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
    }
    if (template.placements?.length && resolvable.size === 0) {
      throw new AppError(MSG.WIDGET_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
    }

    await assertBoardHeadroom(tenantId, targetScope, ctx.userId)
    const { gated, droppedCommands } = await gateCommands(request, tenantId, template)
    const { board, skipped } = await BoardTemplateService.apply(
      tenantId, { userId: ctx.userId }, gated, hasManage,
      { resolvable, asCopy: body.asCopy, paramValues: body.params, authoring: elementAuthoringFor(request, tenantId, ctx.session) },
    )
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.template_apply', resourceType: 'dashboard_board',
      resourceId: board.boardId, metadata: { templateKey, skipped: skipped.length, droppedCommands },
    })
    return NextResponse.json({ board, created: true, skipped, droppedCommands }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}

type Template = NonNullable<Awaited<ReturnType<typeof findBoardTemplate>>>

/**
 * `{ asNew }` (phase 49b): a new board of the caller's own made from the template. The gates of a plain create (`POST …/boards`: a shared board
 * needs `dashboard.boards.manage`, the plan's headroom) and of a template apply (each widget re-resolved for this caller, a private widget kept off
 * a shared board, unauthorised commands dropped); the answer checked against the template's question (400) and against what the caller may read
 * in this tenant (`assertAnswerExists`: 403 / 422).
 */
async function applyAsNew(
  request: NextRequest,
  tenantId: string,
  ctx: Awaited<ReturnType<typeof dashboardContext>>,
  template: Template,
  templateKey: string,
  asNew: NonNullable<z.infer<typeof ApplyDTO>['asNew']>,
  answers: z.infer<typeof ApplyDTO>['answers'],
): Promise<NextResponse> {
  // a template filed under a module the tenant has off is not offered as a board of its own: as if it did not exist (K15)
  if (!placeableAnywhere(template, ctx.enabledIds)) throw new AppError(MSG.TEMPLATE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  const hasManage = ctx.granted.has('dashboard.boards.manage')
  assertCanWrite({ scope: asNew.scope }, hasManage)
  // the answer fits the question before anything is read or written (400), then it names something the caller may read here (403 / 422)
  answeredParams(template, answers)
  await assertAnswerExists(template, answers, {
    ctx: { tenantId, locale: await appLocaleOf(request, tenantId) },
    entityType: (key) => selectEntityType(tenantId, key),
    authorize: async (permission) => { await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' }) },
  })
  const { resolvable } = await resolveTemplateWidgets({ request, tenantId, ctx, template, targetScope: asNew.scope })
  if (!template.placements?.length && !resolvable.has(VALUE_CHAIN_WIDGET_REF)) {
    throw new AppError(MSG.WIDGET_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
  }
  if (template.placements?.length && resolvable.size === 0) {
    throw new AppError(MSG.WIDGET_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
  }
  await assertBoardHeadroom(tenantId, asNew.scope, ctx.userId)
  const { gated, droppedCommands } = await gateCommands(request, tenantId, template)
  const { board, skipped } = await BoardTemplateService.apply(
    tenantId, { userId: ctx.userId }, gated, hasManage,
    { resolvable, asNew, answers, authoring: elementAuthoringFor(request, tenantId, ctx.session) },
  )
  await auditBoardWrite({
    tenantId, userId: ctx.userId, action: 'dashboard.board.template_apply', resourceType: 'dashboard_board',
    resourceId: board.boardId, metadata: { templateKey, asNew: true, scope: board.scope, skipped: skipped.length, droppedCommands, answered: Object.keys(answers ?? {}).length },
  })
  return NextResponse.json({ board, created: true, skipped, droppedCommands }, { status: 201 })
}

/**
 * Drop the `command` action entries the caller could not run themselves (15 review d), counting them. A card's fallback (phase 49b) is
 * placed with its own actions, so its entries pass the same gate (49b review, R49b-4).
 */
async function gateCommands(request: NextRequest, tenantId: string, template: Template): Promise<{ gated: Template; droppedCommands: number }> {
  if (!template.placements) return { gated: template, droppedCommands: 0 }
  const commands = await commandVerdictsFor(request, tenantId, template.placements.flatMap((p) => [p.actions, ...(p.fallback ? [p.fallback.actions] : [])]))
  let droppedCommands = 0
  const placements = template.placements.map((p) => {
    const out = stripUnauthorisedCommands(p.actions, commands.allowed)
    const back = p.fallback ? stripUnauthorisedCommands(p.fallback.actions, commands.allowed) : null
    droppedCommands += out.dropped + (back?.dropped ?? 0)
    if (!out.dropped && !back?.dropped) return p
    return {
      ...p,
      ...(out.dropped ? { actions: out.actions as typeof p.actions } : {}),
      ...(p.fallback && back?.dropped ? { fallback: { ...p.fallback, actions: back.actions as typeof p.actions } } : {}),
    }
  })
  return { gated: { ...template, placements }, droppedCommands }
}

/**
 * `{ boardId }`: the template's cards onto an existing board the caller may write (owner decision 15). The same gates
 * as a manual placement: the board is read with the caller's visibility (404 otherwise), `assertCanWrite` (K3), each
 * widget re-resolved for this caller and a PRIVATE widget kept off a shared board (K10), unauthorised commands
 * dropped. No board is created, so no plan headroom is spent.
 */
async function applyOnto(
  request: NextRequest,
  tenantId: string,
  ctx: Awaited<ReturnType<typeof dashboardContext>>,
  template: Template,
  templateKey: string,
  boardId: string,
): Promise<NextResponse> {
  const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
  assertCanWrite(board, ctx.granted.has('dashboard.boards.manage'))
  const targetScope = board.scope === 'TENANT' ? 'TENANT' : 'PRIVATE'
  const { resolvable } = await resolveTemplateWidgets({ request, tenantId, ctx, template, targetScope })
  if (!template.placements?.length && !resolvable.has(VALUE_CHAIN_WIDGET_REF)) {
    throw new AppError(MSG.WIDGET_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
  }
  if (template.placements?.length && resolvable.size === 0) {
    throw new AppError(MSG.WIDGET_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
  }
  const { gated, droppedCommands } = await gateCommands(request, tenantId, template)
  const { skipped, placed } = await BoardTemplateService.applyOnto(tenantId, board, gated, { resolvable, authoring: elementAuthoringFor(request, tenantId, ctx.session), byUserId: ctx.userId })
  // The touch's new revision goes back with the board (decision 15): the pre-touch read would leave the client one
  // revision behind, and its next If-Match save would 409 against its own apply.
  const revision = await DashboardBoardService.touch(tenantId, board.boardId, { byUserId: ctx.userId })
  await auditBoardWrite({
    tenantId, userId: ctx.userId, action: 'dashboard.board.template_apply', resourceType: 'dashboard_board',
    resourceId: board.boardId, metadata: { templateKey, onto: true, placed, skipped: skipped.length, droppedCommands },
  })
  return NextResponse.json({ board: { ...board, revision }, created: false, placed, skipped, droppedCommands })
}
