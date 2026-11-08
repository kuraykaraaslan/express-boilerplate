import type { FieldSchema } from '@kuraykaraaslan-labs/common/server/schema-form.types'

/**
 * The `dashboard:command` seam (docs/phases/07-dashboard/12 §12.7, OD-80).
 *
 * A module contributes a COMMAND — "send this to a device", "reset that counter" —
 * and a widget placement names it by key. The dashboard knows no domain concept:
 * it checks the caller's permission, applies the confirmation policy, validates
 * params against the command's own schema, runs `execute`, and writes an audit
 * row. A command is reachable ONLY through `POST /api/dashboard/commands/[key]`
 * with a placement that configures it; there is no way to name a command and
 * supply free-form params from a client.
 */

export const COMMAND_POINT = 'dashboard:command'

export interface CommandContext {
  tenantId: string
  userId: string
  locale: string
}

/**
 * One parameter of a command: the shared `FieldSchema`, plus `resourceId` (phase 35.2, E14): this parameter names the
 * resource `execute()` authorises (a device, an alarm). Only such a parameter may take `{ "$row": column }` from a
 * row source, and the row it reads is the one the run route re-reads itself (POSTURE §9), never one a client sent.
 *
 * The editor draws a parameter's `description` under it as given (run 3 #35, D543). A `remote-select` parameter's endpoint may also answer, beside its
 * rows, `description` (one sentence in the viewer's language: where the listed names come from) and `manageLink: { href, label }` (an app path built
 * with `tenantPath`, to where those names are kept, answered only to a viewer who may edit there); the editor shows them under the parameter, opens the
 * link in a new tab and ignores a link that is no path of this site (`ui/command-field-help.ts`). A text that must be translated comes through that
 * answer: the catalogue's own `description` is not translated.
 */
export type CommandParamField = FieldSchema & {
  resourceId?: boolean
  /**
   * Phase 36: this parameter names ONE entity of these `dashboard:entity_type` keys (an RPC's target device), and may take
   * a board alias (`{ "$alias": key }`), resolved on the server like a query's entity slot. A multiple alias is refused.
   */
  entityTypes?: string[]
  /**
   * The editor's input for a fixed value of this parameter is typed by a tenant endpoint once the siblings its path names are
   * chosen (`{{device}}`, `{{key}}`; e2e run 1, E13 + K2): a switch's on / off, a set-point's number in its range. `dataKey` holds
   * the `FieldSchema` in the answer, `null` when the choice sends no value (a button). Presentation only: the declared `type` is
   * what the server checks, and the command's own module checks the value again.
   */
  schemaFrom?: { endpoint: string; dataKey: string }
}

export interface DashboardCommand {
  /** Stable key; the contribution's manifest `key` is what resolves. */
  key?: string
  label: string
  /** Same `FieldSchema` vocabulary as widget settings and query params (OD-16); `resourceId` marks the resource parameter. */
  paramsSchema: Record<string, CommandParamField>
  /** Enforced by the runner BEFORE `execute()`, like a data source's query permission. */
  requiredPermission: string
  /**
   * `'confirm'` — the caller must pass an explicit confirmation; `'typed'` — they
   * must also type `confirmText` (default: the command's label, `typedConfirmText`). Enforced server-side,
   * never only by the UI. `'stepUp'` (phase 35.2) — the caller must prove a second factor for this run: the run route
   * takes the platform's step-up grant (`requireStepUp` of `auth`, purpose `dashboard.commands.execute`, the command
   * and the placement as the target) after every other check and before `execute()`; the control opens the platform's
   * step-up dialog. An impersonation session never steps up, so it cannot run such a command.
   */
  confirm?: 'none' | 'confirm' | 'typed' | 'stepUp'
  confirmText?: string
  /**
   * The caller must say why (phase 35.2): a non-empty `reason` (at most 500 characters) in the run request, enforced
   * server-side like the confirmation (409 without one). Any run may carry a reason; the audit row keeps it.
   */
  reasonRequired?: boolean
  /**
   * `previous` (phase 35.2): what the target held before this run (a set-point's old value), kept in the audit row so a
   * change can be read back and undone by hand. Bounded like the params, never sent to the client.
   */
  execute(ctx: CommandContext, params: Record<string, unknown>): Promise<{ ok: true; value?: unknown; previous?: unknown } | void>
}

/**
 * The phrase a `typed` confirmation asks for (41-ui-fixes/18 1.4): the command's own `confirmText`, else its label, else its key.
 * One rule for the server's check (`assertConfirmation`), the catalogue and every dialog, so what a person is asked to type
 * is a name they can read (the label, "Send a command to a device") rather than an internal key (`iot_rpc.call`), and the
 * dialog and the server never disagree on it.
 */
export function typedConfirmText(command: { key?: string; label?: string; confirmText?: string | null }): string {
  return command.confirmText?.trim() || command.label?.trim() || command.key || ''
}

/** A stored command-action param is a literal, a board parameter, or the widget's current value. */
export const VALUE_REF = '$value'
export const isValueRef = (v: unknown): v is { $value: true } =>
  typeof v === 'object' && v !== null && Object.keys(v).length === 1 && (v as Record<string, unknown>)[VALUE_REF] === true

/**
 * A stored command-action param that takes ONE field of a form widget's value (`control.form` sends
 * `{ <field key>: <value>, … }` as the widget's value): `{ "$field": "low" }`. `$value` still gives the whole object.
 */
export const FIELD_REF = '$field'
export const isFieldRef = (v: unknown): v is { $field: string } =>
  typeof v === 'object' && v !== null && Object.keys(v).length === 1 && typeof (v as Record<string, unknown>)[FIELD_REF] === 'string'

/**
 * A value mapped without an expression (phase 35.2): `from` (a `$param`, `$value`, `$field` or `$row` reference; absent =
 * the control's value) resolved like a bare reference, looked up in `cases` by its text, `else` when no case matches.
 * An unmatched value with no `else` is a 422: a command never runs with a value nobody mapped.
 */
export const MAP_REF = '$map'
export const isMapRef = (v: unknown): v is { $map: { from?: unknown; cases: Record<string, unknown>; else?: unknown } } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1
  && typeof (v as Record<string, unknown>)[MAP_REF] === 'object' && (v as Record<string, unknown>)[MAP_REF] !== null

/** The control's value scaled linearly (phase 35.2): `value * factor + offset`, rounded to `round` decimals when given. */
export const SCALE_REF = '$scale'
export const isScaleRef = (v: unknown): v is { $scale: { factor: number; offset?: number; round?: number } } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1
  && typeof (v as Record<string, unknown>)[SCALE_REF] === 'object' && (v as Record<string, unknown>)[SCALE_REF] !== null

/** A column of the row a row source's click is on (phase 35.2, E14): only on a `resourceId` parameter, read from the row the server re-read. */
export const ROW_REF = '$row'
export const isRowRef = (v: unknown): v is { $row: string } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as Record<string, unknown>)[ROW_REF] === 'string'

/**
 * What a stored command param reads, through a `$map`'s `from` (absent = the control's value) and a `$scale` (always the
 * control's value): `param`, `value`, `field`, `row`, or null for a literal. The one place the source rules (a symbol
 * carries no value, field or row; a `$row` needs a row source) look a reference up.
 */
export function commandParamReads(v: unknown): 'param' | 'value' | 'field' | 'row' | null {
  if (isScaleRef(v)) return 'value'
  const head = isMapRef(v) ? (v.$map.from === undefined ? { $value: true } : v.$map.from) : v
  if (!head || typeof head !== 'object' || Array.isArray(head)) return null
  const keys = Object.keys(head)
  if (keys.length !== 1) return null
  return keys[0] === '$param' ? 'param' : keys[0] === VALUE_REF ? 'value' : keys[0] === FIELD_REF ? 'field' : keys[0] === ROW_REF ? 'row' : null
}
