import { NextRequest, NextResponse } from 'next/server'
import { findCommandEntry } from './placement-actions'
import { isElementCommandSource, entryVisible, commandEntryFloor, symbolConfirmOf } from './instance-actions'
import { elementActionsFor, elementSettingsOf } from './element-actions.registry'
import { kindTypeOf } from './widget-kind-groups'
import { z } from 'zod'
import 'reflect-metadata'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import MSG from './dashboard.messages'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import { readStoredActions, StoredBoardContextDTO, commandUsesRow, isCommandRowSource } from './dashboard.dto'
import { PagingRequestSchema } from './query-paging'
import { resolveBoardState, aliasResolverFor } from './query-gates'
import { commandEntityRefs, narrowedPickKeys } from './board-params'
import {
  loadCommand, authorizeCommand, assertConfirmation, commandAsAsked, withConfirmationFloor, resolveCommandParams, commandAliasKeys, checkCommandRateLimit, auditCommand, claimRequestId, releaseRequestId,
  assertReason, assertCommandStepUp, commandStepUpBinding, MAX_COMMAND_REASON,
} from './command.service'
import { STEP_UP_HEADER } from './command-step-up'
import { appLocaleOf } from './board-template.locale'

const RunCommandDTO = z.object({
  /** The placement whose stored `command` action configures this run. */
  instanceId: z.string().uuid(),
  /** Which stored entry to run (phase 16.1). Optional: omitted, the command key must name exactly one entry. */
  sourceKey: z.string().min(1).max(80).optional(),
  actionId: z.string().min(1).max(64).optional(),
  /** A command on an element gesture (27.15): the element the click was on. It must be the one the stored entry hangs off. */
  elementKey: z.string().min(1).max(100).optional(),
  /** The control's current value (`$value` in the stored params). */
  value: z.unknown().optional(),
  /**
   * A row source's entry whose params read the clicked row (phase 35.2, E14): the row's ID only (the value of the slot's
   * id column). The row itself is never accepted: the route re-reads it from the placement's own stored binding.
   */
  rowId: z.string().min(1).max(200).optional(),
  /**
   * Which of the source's slots that row came from, where a source draws two (a 3D model's `markerClick`: its sensors and
   * its things, whose ids may collide). Must be one the source's rows come from (`rowSlotsFor`); only that slot is re-read.
   */
  rowSlot: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  /** The page of a server-paged table that row was on, so the re-read asks the same page (as the placement query route takes it). */
  rowPaging: PagingRequestSchema.optional(),
  /** One fresh id per user action, required (dashboard.07): a repeat inside 10 minutes is a 409 and runs nothing (replay / double submit). */
  requestId: z.string().uuid(),
  confirmed: z.boolean().optional(),
  typed: z.string().max(200).optional(),
  /** Why the caller runs it (phase 35.2): required by a command with `reasonRequired`, kept in the audit row either way. */
  reason: z.string().trim().max(MAX_COMMAND_REASON).optional(),
  boardContext: StoredBoardContextDTO.optional(),
}).strict()

type Ctx = { params: Promise<{ tenantId: string; commandKey: string }> }

/**
 * POST …/dashboard/commands/[commandKey] — run ONE configured command.
 *
 * What a client may send is deliberately thin: WHICH placement, the control's
 * current value, and whether the user confirmed. The command's params come from
 * the STORED placement, never from the request, so a viewer cannot run a command
 * with params nobody configured. Gates, in order:
 *
 *   ① `dashboard.commands.execute` (route) + the IP limiter + a per-user cap;
 *   ② the placement exists on a board this caller may SEE and is configured with
 *      THIS command (otherwise 404 — it does not confirm the command exists);
 *   ③ the command is contributed by an enabled module (404 otherwise);
 *   ④ the COMMAND's own permission (403, nothing runs);
 *   ⑤ the command's confirmation policy, enforced here (409), and its reason when it asks for one (409, 35.2);
 *   ⑥ params resolved (`$param` / `$value` / `$field` / `$map` / `$scale`) and validated against the command's
 *      own schema (422); a `resourceId` param never reads the value or a form field (422); on a row source the body
 *      carries no value (400) and only an entry that reads the row runs (404 otherwise, before ③);
 *      a `$row` (35.2, E14) reads the row this route re-reads itself: the client sends the row's id (and its slot where
 *      the source draws two),
 *      the placement's own stored binding runs again as the viewer (`fetchCommandRow`: the placement query route's
 *      gates), and an id that query does not answer is a 404 with nothing run; the entry's `when` is then judged on
 *      that row and the board's parameters;
 *   ⑥b a `stepUp` command (35.2): the platform's step-up grant for this command on this placement, taken once
 *      (`requireStepUp`: 401 with `details.stepUp` asks the client for a second factor; nothing has run);
 *   ⑦ the required `requestId` is claimed once (409 on a replay, nothing runs).
 *
 * A command on an element gesture (27.15, decision 49) takes the same path, addressed by its source
 * (`elementClick`, `elementDoubleClick` or `elementContextClick`) and entry id and by the element it hangs off
 * (`elementKey`, which must be one the placement still has: ②, the `dashboard:element_actions` provider of the widget's kind
 * answers), only runs while its `when` holds (⑤) and is always confirmed, whatever the command's own policy (⑤, the provider's
 * `confirmFloor`). Its audit row carries the element and the gesture (the provider's `auditFields`).
 *
 * Every attempt that reaches ④ leaves one audit row: `ok`, `error`, `denied` (④
 * refused) or `rejected` (⑤/⑥ refused), with the resolved params for ok/error. CSRF is
 * the platform's (proxy) — this is a state-changing POST under the session.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, commandKey } = await params
    await Limiter.checkRateLimit(request)
    const auth = await authorizeRequest({
      request, tenantId, requiredPermission: 'dashboard.commands.execute', scope: 'TENANT',
    })
    const userId = auth.user.userId
    await checkCommandRateLimit(tenantId, userId)
    const dto = RunCommandDTO.parse(await request.json())

    // ② the placement, on a board the caller can see, configured with THIS command.
    const instance = await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) =>
      repo.findOne({ where: { tenantId, instanceId: dto.instanceId } }))
    if (!instance) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    const { placementBoardOr404 } = await import('./placement-board')
    // Someone else's private board or another surface: the same 404 body as a missing placement (dashboard.10).
    await placementBoardOr404(tenantId, instance, { userId })
    // The builtin kind the placement renders: it picks the `dashboard:element_actions` provider that judges an element gesture.
    let kindType: string | undefined
    // A placement whose widget the caller's roles exclude (`allowedRoles`, owner decision 2026-10-16) is not shown to
    // them, so its command is not theirs to run either: the same 404 as a missing placement.
    if (typeof instance.widgetRef === 'string' && instance.widgetRef.startsWith('db:')) {
      const { widgetAllowsMember, needsCustomRoles } = await import('./widget-roles.acl')
      const { DashboardWidget } = await import('./entities/dashboard_widget.entity')
      const widgetId = instance.widgetRef.slice(3)
      const widget = await withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => repo.findOne({ where: { tenantId, widgetId } }))
        ?? await (await import('./widget.root-catalog')).findRootPublishedWidget(tenantId, widgetId)
      kindType = kindTypeOf(widget)
      if (widget) {
        const member = auth.tenantMember as { memberRole?: string | null; roleKeys?: string[] | null } | null
        const { activeCustomRoleKeys } = await import('./widget-catalog.service')
        const active = member?.roleKeys?.length && needsCustomRoles([widget]) ? await activeCustomRoleKeys(tenantId) : undefined
        if (!widgetAllowsMember(widget, member, active)) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      }
    }
    // Read entry by entry: a stale entry the write schema refuses today is dead on its own, its neighbours still run.
    const actions = readStoredActions(instance.actions)
    const found = actions ? findCommandEntry(actions, commandKey,
      dto.sourceKey && dto.actionId ? { sourceKey: dto.sourceKey, actionId: dto.actionId } : undefined) : null
    if (!found) {
      throw new AppError(MSG.COMMAND_NOT_CONFIGURED, 404, ErrorCode.NOT_FOUND)
    }
    const action = found.action
    // A command on an element gesture: the provider of the widget's kind says whether the element is still there, and the
    // request names the element the entry hangs off. No provider (none contributes one for the kind, or its module is off for
    // this tenant), a stale or a foreign id is the same 404 as a command that is not configured.
    let element: { fields: Record<string, unknown>; floor: 'confirm' | 'typed' } | undefined
    if (isElementCommandSource(found.sourceKey)) {
      const entry = { id: found.id, sourceKey: found.sourceKey, elementKey: found.elementKey, confirm: symbolConfirmOf(found.confirm), action: found.action }
      const provider = await elementActionsFor(tenantId, kindType)
      if (!provider || !found.elementKey || dto.elementKey !== found.elementKey || !provider.hasElement(await elementSettingsOf(tenantId, provider, instance.settings), found.elementKey)) {
        throw new AppError(MSG.COMMAND_NOT_CONFIGURED, 404, ErrorCode.NOT_FOUND)
      }
      element = { fields: provider.auditFields(entry), floor: provider.confirmFloor(entry) }
    }
    // A row source (E14) runs one kind of command only: one that reads the clicked row's resource, sent as the row's id.
    // It carries no control value (a value there would be a target the client chose: 400), and an entry whose params read
    // no row is never run by the board (`rowCommandHandler`), so a scripted run of one is the same 404 as an unconfigured one.
    if (isCommandRowSource(found.sourceKey)) {
      if (dto.value !== undefined) throw new AppError(`${MSG.COMMAND_PARAMS_INVALID}: 'value'`, 400, ErrorCode.VALIDATION_ERROR)
      if (!commandUsesRow(action)) throw new AppError(MSG.COMMAND_NOT_CONFIGURED, 404, ErrorCode.NOT_FOUND)
    }

    const reason = dto.reason?.trim() || undefined
    const rowId = dto.rowId
    const audited = (outcome: 'denied' | 'rejected', error: string, params?: Record<string, unknown>) =>
      auditCommand({ tenantId, userId, commandKey, instanceId: instance.instanceId, boardId: instance.entityId, outcome, error, params, elementFields: element?.fields, reason, rowId })

    // ③ + ④ — a refusal here is audited too (who tried to run what they may not).
    const command = await loadCommand(tenantId, commandKey)
    try {
      await authorizeCommand(request, tenantId, command)
    } catch (e) {
      await audited('denied', e instanceof Error ? e.message : 'denied')
      throw e
    }
    // ⑤ + ⑥ — refused after authorisation: audited as `rejected`.
    let literal: Record<string, unknown>
    try {
      const boardState = () => resolveBoardState(tenantId, userId, dto.boardContext
        ? { ...dto.boardContext, boardId: instance.entityId } : { boardId: instance.entityId })
      let board: Awaited<ReturnType<typeof boardState>> | undefined
      if (element) {
        // An element's entry is hidden while its `when` fails: it cannot be run then, whatever the client sends.
        board = await boardState()
        if (!entryVisible(found.when, board.paramValues)) throw new AppError(MSG.COMMAND_NOT_CONFIGURED, 404, ErrorCode.NOT_FOUND)
      }
      // D175: a command a control or a row runs asks first too, unless its entry turned that off (`commandEntryFloor`); a symbol's
      // gesture keeps its provider's floor. Enforced here: a client that skips its dialog is refused (409, nothing runs).
      const floor = element ? element.floor : commandEntryFloor(found)
      const policy = floor ? withConfirmationFloor(command, floor) : command
      // a typed phrase is the command's name as the person read it (D551, `commandAsAsked`); other policies have no phrase
      assertConfirmation(policy.confirm === 'typed' ? await commandAsAsked(request, tenantId, policy) : policy, dto)
      assertReason(command, { reason })
      board ??= await boardState()
      // E14: the row the params read is the one THIS route fetches, never one the client sent (the DTO takes an id only).
      let row: Record<string, unknown> | undefined
      if (commandUsesRow(action)) {
        if (!isCommandRowSource(found.sourceKey) || !dto.rowId) throw new AppError(`${MSG.COMMAND_VALUE_REQUIRED}: 'rowId'`, 422, ErrorCode.VALIDATION_ERROR)
        const { fetchCommandRow } = await import('./command-row')
        row = await fetchCommandRow({
          request, tenantId, userId, instance, kindType, sourceKey: found.sourceKey, rowId: dto.rowId,
          ...(dto.rowSlot ? { rowSlot: dto.rowSlot } : {}),
          ...(dto.rowPaging ? { paging: dto.rowPaging } : {}),
          boardContext: { ...(dto.boardContext ?? {}), boardId: instance.entityId },
        })
        // The entry's show condition, judged on the server's row and the board's parameters: a row term means something here.
        if (!entryVisible(found.when, board.paramValues, row)) throw new AppError(MSG.COMMAND_NOT_CONFIGURED, 404, ErrorCode.NOT_FOUND)
      }
      // Phases 36, 41: a parameter that names its target through an entity parameter is resolved here, for this viewer, behind
      // the entity type's permission (the same resolver a query uses).
      const stored = commandEntityRefs(action.params ?? {}, board, (key) => !!command.paramsSchema[key]?.entityTypes?.length)
      // Phase 41.3: a narrowed pick taken as a plain value is resolved too, so one outside its set is refused before the run.
      const aliasKeys = [...new Set([...commandAliasKeys(stored), ...narrowedPickKeys(stored, board)])]
      const aliasValues = aliasKeys.length > 0
        ? await aliasResolverFor(board, {
          tenantId, locale: await appLocaleOf(request, tenantId),
          authorize: async (permission) => { await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' }) },
        }).values(aliasKeys)
        : undefined
      literal = resolveCommandParams(command, stored, board.paramValues, true, dto.value, row, aliasValues)
    } catch (e) {
      await audited('rejected', e instanceof Error ? e.message.slice(0, 300) : 'rejected')
      throw e
    }
    // ⑥b a second factor for this command on this placement (35.2), after every check that could refuse the run, so a
    // refusal above never spends the person's grant. The first request of the exchange carries no grant and is answered
    // 401 with what to prove: that is the protocol, not an attempt, and is not audited; a grant that is presented and
    // refused (bad, spent, another session's) is, as `rejected`.
    let stepUp: { method: string; verifiedAt: Date } | undefined
    if (command.confirm === 'stepUp') {
      try {
        stepUp = await assertCommandStepUp(request, auth, commandStepUpBinding(tenantId, commandKey, instance.instanceId))
      } catch (e) {
        if (request.headers.get(STEP_UP_HEADER)) await audited('rejected', e instanceof Error ? e.message.slice(0, 300) : 'step-up refused', literal)
        throw e
      }
    }
    // ⑦ replay / double submit: the first sight of this requestId wins.
    await claimRequestId(tenantId, userId, dto.requestId)

    try {
      const result = await command.execute({
        // the person's app language (D576), never the browser's
        tenantId, userId, locale: await appLocaleOf(request, tenantId),
      }, literal)
      // `previous` (35.2) is the audit row's, never the client's: only `value` is answered.
      await auditCommand({
        tenantId, userId, commandKey, instanceId: instance.instanceId, boardId: instance.entityId, outcome: 'ok', params: literal, elementFields: element?.fields,
        reason, stepUp, rowId, ...(result && 'previous' in result ? { previous: result.previous } : {}),
      })
      return NextResponse.json({ ok: true, ...(result && 'value' in result ? { value: result.value } : {}) })
    } catch (e) {
      await auditCommand({
        tenantId, userId, commandKey, instanceId: instance.instanceId, boardId: instance.entityId,
        outcome: 'error', error: e instanceof Error ? e.message.slice(0, 300) : 'error', params: literal, elementFields: element?.fields, reason, stepUp, rowId,
      })
      // A failed run did not happen: its id is free again for the retry (dashboard.16).
      await releaseRequestId(tenantId, userId, dto.requestId)
      throw e
    }
  } catch (e) {
    return normalizeError(e)
  }
}
