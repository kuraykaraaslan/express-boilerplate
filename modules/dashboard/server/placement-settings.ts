import { zodFromSchema } from '@kuraykaraaslan-labs/common/server/schema-form.zod'
import type { FieldSchema } from '@kuraykaraaslan-labs/common/server/schema-form.types'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { DASHBOARD_ISSUE_CODES, type DashboardWireIssue } from './settings-issue-codes'

/**
 * Check a placement's `settings` against the widget's own field schema (15.4d,
 * POSTURE section 6: nothing from a browser is stored unvalidated).
 *
 * Only the declared keys are checked: a key the schema does not know is not an
 * error here, it is pruned by `extSettingsForSave` (owner decision 2026-10-18 #17).
 * Every field is optional, so a partial settings object is fine; only a present
 * value of the wrong type or outside a declared range or option list fails.
 * Returns the offending field paths (empty = valid).
 */
export function invalidSettingFields(schema: unknown, settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['(settings)']
  if (!schema || typeof schema !== 'object') return []
  const parsed = zodFromSchema(schema as Record<string, FieldSchema>).safeParse(settings)
  if (parsed.success) return []
  return [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '(settings)')))]
}

/** At most this many fields are named in the 422 (a schema has a handful; this only bounds a hostile one). */
const MAX_EXT_ISSUES = 50

/**
 * The 422 for a contributed widget's settings its schema refuses: the English message with the fields (logs, API
 * callers), and one `details.issues` entry per field with the field's schema label, which the board UI words in
 * the viewer's language (`DASHBOARD_ISSUE_CODES.EXT_SETTING_INVALID`).
 */
export function extSettingsInvalidError(fields: string[], schema: unknown): AppError {
  const defs = schema && typeof schema === 'object' ? (schema as Record<string, { label?: unknown } | undefined>) : {}
  const issues: DashboardWireIssue[] = fields.slice(0, MAX_EXT_ISSUES).map((field) => {
    const own = Object.prototype.hasOwnProperty.call(defs, field) ? defs[field] : undefined
    const label = typeof own?.label === 'string' && own.label ? own.label.slice(0, 200) : field === '(settings)' ? undefined : field.slice(0, 200)
    return {
      path: field.slice(0, 300),
      message: MSG.SETTINGS_INVALID,
      code: DASHBOARD_ISSUE_CODES.EXT_SETTING_INVALID,
      ...(label ? { params: { label } } : {}),
    }
  })
  return new AppError(`${MSG.SETTINGS_INVALID}: ${fields.join(', ')}`, 422, ErrorCode.VALIDATION_ERROR, { details: { issues } })
}

/**
 * Owner decision 2026-10-18 #17: the largest serialised (JSON, UTF-8) settings object a placement may store.
 * A real card's settings are a few hundred bytes; a repeater-heavy one a few KiB. The cap bounds what a
 * caller (or a kind with no schema to prune against, the iframe tier) can park on a row.
 */
export const MAX_PLACEMENT_SETTINGS_BYTES = 32 * 1024

/** The serialised size of a settings object, in UTF-8 bytes. */
export function settingsByteSize(settings: unknown): number {
  return Buffer.byteLength(JSON.stringify(settings ?? {}) ?? '', 'utf8')
}

/** The 422 for settings over the cap: the English message with the sizes, one `details.issues` entry the board UI words. */
export function settingsTooLargeError(bytes: number): AppError {
  const issue: DashboardWireIssue = {
    path: '(settings)',
    message: MSG.SETTINGS_TOO_LARGE,
    code: DASHBOARD_ISSUE_CODES.SETTINGS_TOO_LARGE,
    params: { max: MAX_PLACEMENT_SETTINGS_BYTES },
  }
  return new AppError(
    `${MSG.SETTINGS_TOO_LARGE}: ${bytes} bytes (at most ${MAX_PLACEMENT_SETTINGS_BYTES})`,
    422, ErrorCode.VALIDATION_ERROR, { details: { issues: [issue] } },
  )
}

/** Refuses (422) a settings object whose serialised size is over `MAX_PLACEMENT_SETTINGS_BYTES`. */
export function assertSettingsSize(settings: unknown): void {
  const bytes = settingsByteSize(settings)
  if (bytes > MAX_PLACEMENT_SETTINGS_BYTES) throw settingsTooLargeError(bytes)
}

const CARD_STAMP = 'core:card'
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The platform namespaces a non-builtin card declares (decision #17): `$card` (the common card, validated by
 * `prepareCardSettings`) and `$v`, whose stamp keeps only `core:card` and the ids `stampId` accepts (a tenant
 * widget's own `tenant:<type>`). Any other `$` key (`$format`, a `$x:` module part, a made-up one) is not read by
 * such a card and is dropped. Own keys are left to the caller.
 */
export function withDeclaredNamespaces(
  settings: Record<string, unknown>,
  stampId: (id: string) => boolean = () => false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(settings)) {
    if (!k.startsWith('$')) out[k] = v
    else if (k === '$card') out[k] = v
    else if (k === '$v' && isObj(v)) {
      const stamp = Object.fromEntries(Object.entries(v).filter(([id]) => id === CARD_STAMP || stampId(id)))
      if (Object.keys(stamp).length) out[k] = stamp
    }
  }
  return out
}

export interface ExtSaveResult {
  /** Declared own keys (as given), then `$card` and `$v`; refused values left out. */
  settings: Record<string, unknown>
  /** Declared fields whose value the schema refuses (left out of `settings`). */
  invalid: string[]
}

/**
 * A contributed (`ext:`) widget's settings against the schema its contribution declares (18.2, decision #17):
 * a declared key's value is checked (`invalidSettingFields`), an undeclared own key is pruned, and only the
 * `$card` / `$v` namespaces stay. Without a declared schema nothing is known to prune against: the settings are
 * kept as given (the size cap still applies at the caller). The strict write path refuses on `invalid`; the board
 * import repairs (drops and reports).
 */
export function extSettingsForSave(schema: unknown, settings: Record<string, unknown>): ExtSaveResult {
  if (!isObj(schema)) return { settings, invalid: [] }
  const declared = withDeclaredNamespaces(settings)
  const invalid = invalidSettingFields(schema, Object.fromEntries(Object.entries(declared).filter(([k]) => !k.startsWith('$'))))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(declared)) {
    if (k.startsWith('$') || (Object.prototype.hasOwnProperty.call(schema, k) && !invalid.includes(k))) out[k] = v
  }
  return { settings: out, invalid }
}
