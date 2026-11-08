/**
 * Issue codes the dashboard adds to the engine's (`IssueCode`, vendored WidgetKit) for placement-save refusals
 * the engine does not make: a contributed (`ext:`) widget's own schema check (18.2) and the tenant's embed
 * allow-list (2026-10-17 #9) and the settings size cap (2026-10-18 #17). They travel in a 422's `details.issues` like the engine's, and the board UI words
 * them in the viewer's language (`settings-issues.ts`); the issue's `message` stays English for logs and API
 * callers. Prefixed so they never collide with a kit code.
 */
export const DASHBOARD_ISSUE_CODES = {
  /** `params.label`: the field's label from the contribution's schema (absent: the settings as a whole). */
  EXT_SETTING_INVALID: 'dashboard.extSettingInvalid',
  /** `params.host`: the site the embed card was pointed at. */
  EMBED_HOST_NOT_ALLOWED: 'dashboard.embedHostNotAllowed',
  /** `params.max`: the cap in bytes (decision 2026-10-18 #17). */
  SETTINGS_TOO_LARGE: 'dashboard.settingsTooLarge',
} as const

export type DashboardIssueCode = typeof DASHBOARD_ISSUE_CODES[keyof typeof DASHBOARD_ISSUE_CODES]

/** One issue of those, as the 422 sends it. */
export interface DashboardWireIssue {
  path: string
  message: string
  code: DashboardIssueCode
  params?: { label?: string; host?: string; max?: number }
}
