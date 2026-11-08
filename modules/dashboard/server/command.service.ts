import type { NextRequest } from 'next/server'
import { commandActionsOf } from './placement-actions'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ext, ProviderUnavailableError, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardCommandLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.command'
import { zodFromSchema } from '@kuraykaraaslan-labs/common/server/schema-form.zod'
import { missingRequired } from './data-source.validate'
import redis from '@kuraykaraaslan-labs/redis'
import Logger from '@kuraykaraaslan-labs/logger'
import MSG from './dashboard.messages'
import { requestLabelTexts } from './contributed-label-texts'
import { commandLabelKey, localizeCommand } from './contributed-labels'
import { isParamRef } from './board-window'
import { aliasRefKey, aliasSlotValue, isAliasRef, type ResolvedAliasValue } from './board-aliases'
import { COMMAND_POINT, VALUE_REF, commandParamReads, isFieldRef, isMapRef, isRowRef, isScaleRef, isValueRef, typedConfirmText, type CommandParamField, type DashboardCommand } from './command.types'

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Executions one user may run per minute across all commands (the route also has the IP limiter). */
export const COMMANDS_PER_MINUTE = 30

/**
 * Resolve a command contribution for this tenant. A key no contribution in this build has is a 404; a known
 * command whose module is not active here (disabled, not entitled) or that fails to load is the typed 409
 * `ProviderUnavailable` with its reason.
 */
export async function loadCommand(tenantId: string, key: string): Promise<DashboardCommand> {
  let selected: { impl: DashboardCommand } | null
  try {
    selected = await ext.select<DashboardCommand>(COMMAND_POINT, tenantCtx(tenantId), dashboardCommandLoaders, { key })
  } catch (e) {
    if (e instanceof ProviderUnavailableError && e.state === 'not_installed') throw new AppError(MSG.COMMAND_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    throw e
  }
  if (!selected) throw new AppError(MSG.COMMAND_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  return { ...selected.impl, key }
}

/** One command of the caller's catalogue: what a control needs to render live, and the editor to draw a form per parameter. */
export interface PermittedCommandInfo {
  key: string
  label: string
  confirm: 'none' | 'confirm' | 'typed' | 'stepUp'
  confirmText?: string
  /** The run must carry a reason (phase 35.2): the control asks for one before it sends. */
  reasonRequired?: boolean
  /** The command's own parameter schema (phase 35.2), plain data: the editor's per-parameter form and its source picker. */
  paramsSchema: Record<string, CommandParamField>
}

/**
 * A command's parameter schema as plain JSON data: what the catalogue may show of it. A contribution's schema is data
 * by contract; anything that does not survive JSON (a function, a cycle) is not sent, so a malformed contribution
 * shows an empty form rather than failing the whole list.
 */
function publicParamsSchema(schema: unknown): Record<string, CommandParamField> {
  try {
    const plain = JSON.parse(JSON.stringify(schema ?? {}))
    return plain && typeof plain === 'object' && !Array.isArray(plain) ? plain : {}
  } catch {
    return {}
  }
}

/**
 * Every command this caller may run (permission check per command), for the widget to know read-only vs live and for the
 * editor to draw each parameter. The route answers an empty list to a caller without `dashboard.commands.execute`.
 */
export async function listPermittedCommands(
  request: NextRequest,
  tenantId: string,
  grantedFor: (permissionIds: string[]) => Promise<Set<string>>,
): Promise<PermittedCommandInfo[]> {
  // Commands of modules active for this tenant; one that fails to load is logged and skipped by the host runtime.
  const { loaded: all } = await ext.loadAll<DashboardCommand>(COMMAND_POINT, tenantCtx(tenantId), dashboardCommandLoaders)
  const loaded: Array<DashboardCommand & { moduleId: string }> = all
    .filter(({ contribution }) => !!contribution.key)
    .map(({ contribution, impl }) => ({ ...impl, key: contribution.key!, moduleId: contribution.moduleId }))
  const granted = await grantedFor([...new Set(loaded.map((c) => c.requiredPermission))])
  const permitted = loaded.filter((c) => granted.has(c.requiredPermission))
  // D551 / D576 (phase 39.16): the command's name and its parameters' words in the workspace's language, from the contributing module's
  // dictionary (`<module>.dashboardCommand.<key>`), English as declared without one. A typed confirmation's phrase stays the declared one:
  // the run route checks the typed text against it.
  const text = await requestLabelTexts(request, tenantId, permitted.map((c) => c.moduleId))
  return permitted.map((c) => {
    const words = localizeCommand({ key: c.key!, label: c.label, paramsSchema: publicParamsSchema(c.paramsSchema) }, c.moduleId, text)
    return {
      key: c.key!, label: words.label, confirm: c.confirm ?? 'none',
      // The phrase a typed confirmation asks for (41-ui-fixes/18 1.4): also for a command that declares one without asking for it
      // itself, since a symbol's entry can raise its confirmation to typed (`withConfirmationFloor`) and is then checked against it.
      // Without a declared confirm text the phrase is the name the person reads, as the run route asks it (`commandAsAsked`).
      ...(c.confirm === 'typed' || c.confirmText ? { confirmText: typedConfirmText({ ...c, label: words.label }) } : {}),
      ...(c.reasonRequired === true ? { reasonRequired: true } : {}),
      paramsSchema: words.paramsSchema,
    }
  })
}

/**
 * The command as the person was asked about it (D551, phase 39.16): a typed confirmation without a declared confirm text asks for the
 * command's name, and the catalogue names it in the person's app language (`listPermittedCommands`), so the run checks the typed phrase
 * against that name. A declared confirm text, or a command no module owns, is checked as declared.
 */
export async function commandAsAsked(request: NextRequest, tenantId: string, command: DashboardCommand): Promise<DashboardCommand> {
  if (command.confirmText?.trim() || !command.key) return command
  const owner = (await ext.contributions(COMMAND_POINT, tenantCtx(tenantId))).find((c) => c.key === command.key)?.moduleId
  if (!owner) return command
  const text = await requestLabelTexts(request, tenantId, [owner])
  return { ...command, label: text(commandLabelKey(owner, command.key), command.label) }
}

/** The command's own permission, before anything else about it runs. */
export async function authorizeCommand(request: NextRequest, tenantId: string, command: DashboardCommand): Promise<void> {
  await authorizeRequest({ request, tenantId, requiredPermission: command.requiredPermission, scope: 'TENANT' })
}

/**
 * Enforce the confirmation policy SERVER-SIDE: a client that skips its own dialog
 * (or never had one) is refused, because the policy belongs to the command, not
 * to the widget that happens to render it.
 */
export function assertConfirmation(
  command: DashboardCommand,
  body: { confirmed?: boolean; typed?: string },
): void {
  const mode = command.confirm ?? 'none'
  // A step-up is its own proof of intent, taken by the run route (`assertCommandStepUp`), not a flag in the body.
  if (mode === 'none' || mode === 'stepUp') return
  if (body.confirmed !== true) throw new AppError(MSG.COMMAND_CONFIRMATION_REQUIRED, 409, ErrorCode.CONFLICT)
  if (mode === 'typed' && (body.typed ?? '').trim() !== typedConfirmText(command)) {
    throw new AppError(MSG.COMMAND_CONFIRMATION_REQUIRED, 409, ErrorCode.CONFLICT)
  }
}

/**
 * The command as an element gesture runs it (decision 49): confirmed whatever the command's own policy says. `floor` is what
 * the widget kind's `dashboard:element_actions` provider asks for (`confirmFloor`). A command whose policy is `none` is asked
 * for a plain confirmation; `typed` on either side (the command or the floor) asks for the command's confirmation text.
 * Enforced here, server-side, like the command's own policy.
 */
export function withConfirmationFloor(command: DashboardCommand, floor: 'confirm' | 'typed'): DashboardCommand {
  const typed = command.confirm === 'typed' || floor === 'typed'
  // A `stepUp` command keeps its step-up (the route asks the ORIGINAL command for it); the floor's dialog comes on top.
  return { ...command, confirm: typed ? 'typed' : 'confirm' }
}

/** The longest reason a run may carry (phase 35.2); the DTO bounds it, the audit row keeps it whole. */
export const MAX_COMMAND_REASON = 500

/**
 * A command that asks for a reason (`reasonRequired`, phase 35.2) runs only with a non-empty one: enforced here,
 * server-side, like the confirmation, so a client that skips its prompt is refused (409, nothing runs).
 */
export function assertReason(command: DashboardCommand, body: { reason?: string }): void {
  if (command.reasonRequired === true && !(body.reason ?? '').trim()) {
    throw new AppError(`${MSG.COMMAND_CONFIRMATION_REQUIRED}: 'reason'`, 409, ErrorCode.CONFLICT)
  }
}

/** What a step-up grant is good for on this path: one command on one placement (the target), for the run route's own permission. */
export function commandStepUpBinding(tenantId: string, commandKey: string, instanceId: string): { tenantId: string; purpose: string; target: string } {
  return { tenantId, purpose: 'dashboard.commands.execute', target: `${commandKey}:${instanceId}` }
}

/**
 * A `stepUp` command (phase 35.2): take the platform's request-bound step-up grant (`x-step-up-token`, single use, bound
 * to this user, session, tenant, purpose and target) or refuse. `requireStepUp` answers 401 with `details.stepUp` when
 * the request carries none (the client opens the step-up dialog and repeats the request once with the grant), 401 for
 * a bad or spent one, 403 for an impersonation session and 503 when its store cannot answer: never a pass. `auth` is a
 * protected platform module; it is reached with `import()` so this module loads it only for a command that asks.
 */
export async function assertCommandStepUp(
  request: { headers: Headers },
  subject: unknown,
  binding: { tenantId: string; purpose: string; target: string },
): Promise<{ method: string; verifiedAt: Date }> {
  const { requireStepUp } = await import('@kuraykaraaslan-labs/auth/server/auth.step-up.service')
  return requireStepUp(request, subject as Parameters<typeof requireStepUp>[1], binding)
}

/** What a command param resolved to: a value, or nothing (the param is then absent and the command's schema decides). */
const ABSENT = Symbol('absent')
type Resolved = unknown | typeof ABSENT

/** What a stored command param may read: the board's values, the control's value, and (a row source, E14) the row the server re-read. */
export interface CommandParamScope {
  boardValues: Record<string, unknown>
  hasBoard: boolean
  widgetValue: unknown
  /** The row the run route fetched itself from the placement's own binding (phase 35.2, E14); never a row a client sent. */
  row?: Record<string, unknown>
  /** The board aliases the stored params name, resolved by the run route for this viewer (phase 36). */
  aliasValues?: ReadonlyMap<string, ResolvedAliasValue>
}

const invalid = (key: string) => new AppError(`${MSG.COMMAND_PARAMS_INVALID}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
const isPlainScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/**
 * One bare reference (`$param`, `$value`, `$field`, `$row`) as a value. `key` is the command param it fills, for the
 * refusals. A `{ $field }` the form did not send (an empty optional field, a field gated off) or sent as `null` is
 * nothing (B6): the param is left out and the command's own schema says whether it was required. A `{ $row }` reads
 * the server-fetched row only, and only on a parameter the command marks `resourceId` (checked again here, whatever
 * the write let through).
 */
function resolveBareRef(command: DashboardCommand, key: string, ref: unknown, scope: CommandParamScope): Resolved {
  // E14 (POSTURE §9): the parameter that names the resource `execute()` authorises never takes what the request carries
  // (the control's value or a form field, bare or through a `$map` / `$scale`): the client names no target. Checked here
  // again whatever the write let through (a row stored before the rule).
  if ((isValueRef(ref) || isFieldRef(ref)) && command.paramsSchema[key]?.resourceId === true) throw invalid(key)
  if (isAliasRef(ref)) {
    // Phase 36: one entity of the types the parameter declares; the alias was resolved by the run route, never sent by the client.
    const entityTypes = command.paramsSchema[key]?.entityTypes
    if (!entityTypes?.length) throw invalid(key)
    const resolved = scope.aliasValues?.get(aliasRefKey(ref))
    if (!resolved) throw new AppError(`${MSG.ALIAS_UNKNOWN}: '${ref.$alias}'`, 422, ErrorCode.VALIDATION_ERROR)
    // A command stays strict (49a): a parameter of many is refused whatever it holds, never narrowed to its one entity, so a command
    // never reaches a device its author did not name.
    const id = aliasSlotValue(key, { entityTypes, multiple: false }, resolved, { strict: true })
    return id === '' ? ABSENT : id
  }
  if (isParamRef(ref)) {
    // A board filter narrows an entity parameter; those reach here as the resolver's form (`commandEntityRefs`), so one left on
    // a `$param` names a value, which has no set to narrow.
    if (ref.filter !== undefined) throw invalid(key)
    // Own-property test: `'toString' in {}` is true, which let `{ $param: 'toString' }` resolve to a function.
    if (!scope.hasBoard || !Object.hasOwn(scope.boardValues, ref.$param)) {
      throw new AppError(`${MSG.BOARD_PARAM_UNRESOLVED}: '${ref.$param}'`, 422, ErrorCode.VALIDATION_ERROR)
    }
    return scope.boardValues[ref.$param]
  }
  if (isValueRef(ref)) {
    if (scope.widgetValue === undefined) throw new AppError(MSG.COMMAND_VALUE_REQUIRED, 422, ErrorCode.VALIDATION_ERROR)
    return scope.widgetValue
  }
  if (isFieldRef(ref)) {
    // One field of a form's value: an own key of a plain object, never a prototype member, and a plain scalar.
    const field = ref.$field
    const v = scope.widgetValue
    const isObject = typeof v === 'object' && v !== null && !Array.isArray(v)
    if (UNSAFE_KEYS.has(field) || !isObject) throw new AppError(`${MSG.COMMAND_VALUE_REQUIRED}: '${field}'`, 422, ErrorCode.VALIDATION_ERROR)
    if (!Object.hasOwn(v as object, field)) return ABSENT
    const picked = (v as Record<string, unknown>)[field]
    if (picked === null) return ABSENT
    if (!isPlainScalar(picked)) throw invalid(field)
    return picked
  }
  if (isRowRef(ref)) {
    const column = ref.$row
    if (command.paramsSchema[key]?.resourceId !== true || !scope.row) throw invalid(key)
    if (UNSAFE_KEYS.has(column) || !Object.hasOwn(scope.row, column)) throw invalid(key)
    const cell = scope.row[column]
    // A resource id is a plain value: a row without one (null, a structure) names no resource, so nothing runs.
    if (typeof cell !== 'string' && typeof cell !== 'number') throw invalid(key)
    return cell
  }
  throw invalid(key)
}

/** The text a `$map` looks a value up by: a structure as its JSON, anything else as `String()`, like the client's map. */
const mapKeyOf = (v: unknown): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

/** One stored command param as the value `execute` receives, or nothing. */
function resolveCommandParam(command: DashboardCommand, key: string, value: unknown, scope: CommandParamScope): Resolved {
  if (isMapRef(value)) {
    const { from, cases, else: fallback } = value.$map
    const read = resolveBareRef(command, key, from === undefined ? { [VALUE_REF]: true } : from, scope)
    if (read === ABSENT) return ABSENT
    // Own cases only: a value of `constructor` or `__proto__` never reads the prototype of the cases object.
    const text = mapKeyOf(read)
    if (cases && typeof cases === 'object' && Object.hasOwn(cases, text)) return cases[text]
    if (Object.hasOwn(value.$map, 'else')) return fallback
    // An unmatched value with no `else`: the command never runs with a value nobody mapped.
    throw invalid(key)
  }
  if (isScaleRef(value)) {
    const { factor, offset, round } = value.$scale
    const read = resolveBareRef(command, key, { [VALUE_REF]: true }, scope)
    // A control's number (a slider, a set-point); a numeric text is taken as its number, anything else is refused.
    const n = typeof read === 'number' ? read : typeof read === 'string' && read.trim() !== '' ? Number(read) : NaN
    if (!Number.isFinite(n) || !Number.isFinite(factor)) throw invalid(key)
    const scaled = n * factor + (typeof offset === 'number' && Number.isFinite(offset) ? offset : 0)
    if (typeof round === 'number' && Number.isInteger(round) && round >= 0 && round <= 6) {
      const p = 10 ** round
      return Math.round(scaled * p) / p
    }
    // Unrounded: drop the binary noise of the multiply (100 × 40.95 is 4095.0000000000005), which would otherwise push a
    // value the author meant to land exactly on the schema's `max` past it. 15 significant digits are exact for a double.
    return Number(scaled.toPrecision(15))
  }
  if (isParamRef(value) || isValueRef(value) || isFieldRef(value) || isRowRef(value) || isAliasRef(value)) return resolveBareRef(command, key, value, scope)
  return value
}

/**
 * Turn a placement's stored params into the literal params `execute` receives:
 * `$param` → the board's value, `$value` → what the widget just sent, `$field` → one field of a form's value (absent
 * or null: left out), `$map` → a case of its `from` (phase 35.2), `$scale` → the control's value scaled, `$row` → a
 * column of the row the server re-read (E14, `resourceId` params only); then validate against the command's own
 * schema, unknown keys REJECTED (a typo or a probe, same rule as query params). No expression is ever evaluated.
 */
export function resolveCommandParams(
  command: DashboardCommand,
  stored: Record<string, unknown>,
  boardValues: Record<string, unknown>,
  hasBoard: boolean,
  widgetValue: unknown,
  row?: Record<string, unknown>,
  aliasValues?: ReadonlyMap<string, ResolvedAliasValue>,
): Record<string, unknown> {
  const scope: CommandParamScope = { boardValues, hasBoard, widgetValue, ...(row ? { row } : {}), ...(aliasValues ? { aliasValues } : {}) }
  // Null-prototype: a stored key such as `__proto__` is an own, inert property here, and
  // nothing is ever read through an inherited one (`constructor`, `toString` …).
  const literal: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(stored)) {
    if (UNSAFE_KEYS.has(key)) throw invalid(key)
    const resolved = resolveCommandParam(command, key, value, scope)
    if (resolved !== ABSENT) literal[key] = resolved
  }
  const allowed = new Set(Object.keys(command.paramsSchema))
  for (const key of Object.keys(literal)) {
    if (!allowed.has(key)) throw invalid(key)
  }
  const parsed = zodFromSchema(command.paramsSchema).safeParse({ ...literal })
  if (!parsed.success) throw new AppError(MSG.COMMAND_PARAMS_INVALID, 422, ErrorCode.VALIDATION_ERROR)
  const missing = missingRequired(command.paramsSchema, parsed.data)
  if (missing) throw invalid(missing)
  return parsed.data
}

/**
 * At most `COMMANDS_PER_MINUTE` executions per user and tenant. This path writes to
 * the outside world, so it FAILS CLOSED: with Redis unavailable the per-user cap
 * cannot be enforced and the run is refused (503) rather than waved through on the
 * IP limiter alone. (The minute bucket in the key makes a missed `expire` harmless.)
 */
export async function checkCommandRateLimit(tenantId: string, userId: string): Promise<void> {
  const key = `dash:cmd:rl:${tenantId}:${userId}:${Math.floor(Date.now() / 60_000)}`
  let n: number
  try {
    n = await redis.incr(key)
    if (n === 1) await redis.expire(key, 70)
  } catch (e) {
    Logger.warn(`[dashboard] command rate limiter unavailable: ${e instanceof Error ? e.message : String(e)}`)
    throw new AppError(MSG.COMMAND_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR)
  }
  if (n > COMMANDS_PER_MINUTE) throw new AppError(MSG.COMMAND_RATE_LIMITED, 429, ErrorCode.RATE_LIMIT_EXCEEDED)
}

/**
 * Replay / double-submit protection. A client sends a fresh `requestId` per user
 * action; the first sight of `(tenant, user, requestId)` wins and every repeat
 * inside the window is a 409 with nothing executed — a replayed request, a
 * retrying proxy or a double click cannot fire the command twice. The route
 * requires it (dashboard.07); the empty-id early return only serves other callers.
 * Fails closed like the rate limit.
 */
export const REQUEST_ID_TTL_SECONDS = 600
export async function claimRequestId(tenantId: string, userId: string, requestId: string | undefined): Promise<void> {
  if (!requestId) return
  let first: unknown
  try {
    first = await redis.set(`dash:cmd:req:${tenantId}:${userId}:${requestId}`, '1', 'EX', REQUEST_ID_TTL_SECONDS, 'NX')
  } catch (e) {
    Logger.warn(`[dashboard] command replay guard unavailable: ${e instanceof Error ? e.message : String(e)}`)
    throw new AppError(MSG.COMMAND_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR)
  }
  if (first !== 'OK') throw new AppError(MSG.COMMAND_REPLAYED, 409, ErrorCode.CONFLICT)
}

/**
 * Give a claimed requestId back after the command FAILED (dashboard.16), so the client's or a
 * proxy's retry with the same id runs instead of being refused as a replay of something that
 * never completed. Best effort: if the delete fails, the claim simply expires with its TTL.
 * A command that may have acted before failing (a timeout after the device moved) should make
 * its own `execute()` idempotent; the replay guard only stops duplicates of a SUCCESS.
 */
export async function releaseRequestId(tenantId: string, userId: string, requestId: string | undefined): Promise<void> {
  if (!requestId) return
  try {
    await redis.del(`dash:cmd:req:${tenantId}:${userId}:${requestId}`)
  } catch (e) {
    Logger.warn(`[dashboard] command replay claim not released: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Is a stored command param a reference the server resolves at run time (not a literal the command receives as it is)? An
 * entity alias is one (phase 36: the run resolves it, `resolveBareRef`); without it here an alias device was type-checked as a
 * literal text and every save refused it (phase 39, UX-20).
 */
function isCommandRef(value: unknown): boolean {
  return isParamRef(value) || isValueRef(value) || isFieldRef(value) || isRowRef(value) || isMapRef(value) || isScaleRef(value) || isAliasRef(value)
}

/** Does `value` pass the command's own validator for the one field `key` (the run's check, asked at save)? */
function literalFits(command: DashboardCommand, key: string, value: unknown): boolean {
  const field = command.paramsSchema[key]
  return !!field && zodFromSchema({ [key]: field }).safeParse({ [key]: value }).success
}

/**
 * The literals a stored param puts in front of the command (phase 35.2): the param itself when it is a literal, a
 * `$map`'s case values and its `else`. Each must pass the command's `FieldSchema` for that param, so a mistyped value
 * ("5" for a number, an option the select does not have) is refused when it is saved instead of on every press.
 */
function assertLiteralTypes(command: DashboardCommand, key: string, value: unknown): void {
  const literals = isMapRef(value)
    ? [...Object.values(value.$map.cases ?? {}), ...(Object.hasOwn(value.$map, 'else') ? [value.$map.else] : [])]
    : isCommandRef(value) ? [] : [value]
  for (const literal of literals) {
    if (!literalFits(command, key, literal)) throw invalid(key)
  }
}

/**
 * Authoring gate: a command action may only be SAVED by someone who could run it
 * themselves, for a command that exists and is enabled here, with params naming
 * only keys the command declares, and (phase 35.2) literals of the types the command's schema takes and a `{ $row }`
 * only on a parameter the command marks `resourceId` (E14; which SOURCE may hold one is the DTO's rule), a parameter that
 * in turn never reads the control's value or a form field (the review of 35.2, F1). Without it a
 * board editor could wire any command key to a card and rely on a more privileged viewer to press it.
 */
export async function assertCommandAuthoring(
  request: NextRequest,
  tenantId: string,
  actions: unknown,
): Promise<void> {
  // Every trigger, not just `onClick` (15.4c): a command on any slot is checked.
  for (const action of commandActionsOf(actions)) {
    const command = await loadCommand(tenantId, action.commandKey)
    await authorizeCommand(request, tenantId, command)
    const allowed = new Set(Object.keys(command.paramsSchema))
    for (const [key, value] of Object.entries(action.params ?? {})) {
      if (UNSAFE_KEYS.has(key) || !allowed.has(key)) throw invalid(key)
      // An alias names an entity, so only a parameter that declares the entity types it takes may read one (the run refuses
      // any other on every press: refused here once, at save). That the alias is the board's is `assertPlacementEntityRefs`.
      if (isAliasRef(value) && !command.paramsSchema[key]?.entityTypes?.length) throw invalid(key)
      assertLiteralTypes(command, key, value)
      const reads = commandParamReads(value)
      const resource = command.paramsSchema[key]?.resourceId === true
      // E14: the clicked row only for the parameter that names the resource `execute()` authorises, and that parameter
      // never from what the request carries (the control's value, a form field, a `$scale` or a value-reading `$map`):
      // a literal, a board parameter, the server-read row, or a map from one of those.
      if (reads === 'row' && !resource) throw invalid(key)
      if (resource && (reads === 'value' || reads === 'field')) throw invalid(key)
    }
  }
}

/** Audit the params, but bounded: long strings are cut and the whole object is capped. */
function boundParams(params: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(params, (_k, v) => (typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v))
  return json.length > 2000 ? { truncated: true } : JSON.parse(json)
}

/** One audit row per attempt that reached the command: success, failure, and (since the review) refusals after the placement matched. `audit_log` stays off the hard `requires` graph. */
export async function auditCommand(entry: {
  tenantId: string
  userId: string
  commandKey: string
  instanceId: string
  boardId: string
  outcome: 'ok' | 'error' | 'denied' | 'rejected'
  error?: string
  /** The literal params the command ran with (resolved), when there were any. */
  params?: Record<string, unknown>
  /** A command run from an element gesture: the fields the widget kind's `dashboard:element_actions` provider adds (`auditFields`). */
  elementFields?: Record<string, unknown>
  /** Why the caller ran it (phase 35.2), as they typed it (at most 500 characters). */
  reason?: string
  /** What the target held before the run, as `execute()` reported it (phase 35.2); bounded like the params. */
  previous?: unknown
  /** How and when a `stepUp` command's second factor was proved (phase 35.2). */
  stepUp?: { method: string; verifiedAt: Date }
  /** The id of the row a `{ $row }` param was read from (phase 35.2, E14), as the client named it. */
  rowId?: string
}): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    await AuditLogService.log({
      tenantId: entry.tenantId,
      actorId: entry.userId,
      action: `dashboard.command.${entry.commandKey}`,
      resourceType: 'dashboard_command',
      resourceId: entry.instanceId,
      metadata: {
        ...(entry.elementFields ?? {}),
        boardId: entry.boardId, outcome: entry.outcome,
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.params ? { params: boundParams(entry.params) } : {}),
        ...(entry.reason ? { reason: entry.reason.slice(0, MAX_COMMAND_REASON) } : {}),
        ...(entry.previous !== undefined ? { previous: boundParams({ value: entry.previous }).value ?? { truncated: true } } : {}),
        ...(entry.stepUp ? { stepUp: { method: entry.stepUp.method, verifiedAt: entry.stepUp.verifiedAt.toISOString() } } : {}),
        ...(entry.rowId ? { rowId: entry.rowId.slice(0, 200) } : {}),
      },
    })
  } catch (err) {
    Logger.warn(`[dashboard] command audit failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The alias references (by memo key) a command's stored params make, bare or as a `$map`'s `from` (phase 36). */
export function commandAliasKeys(stored: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const v of Object.values(stored)) {
    if (isAliasRef(v)) out.add(aliasRefKey(v))
    else if (isMapRef(v) && isAliasRef(v.$map.from)) out.add(aliasRefKey(v.$map.from))
  }
  return [...out]
}
