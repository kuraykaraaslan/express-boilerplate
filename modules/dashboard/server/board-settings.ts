import { CORE_BOARD } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/core'
import { prepareForSave } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/engine'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { settingsInvalidError } from './widget-settings'

/**
 * A board's own settings as stored (phase 21, `core:board`): migrated, validated, pruned to what differs
 * from the template defaults and stamped `$v` by the server. `null` / empty = the defaults. Settings
 * from a newer template version are refused (409), invalid values with their path (422).
 */
export function prepareBoardSettings(
  incoming: Record<string, unknown> | null | undefined,
  previous?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (incoming === null || incoming === undefined) return null
  const res = prepareForSave(incoming, { type: CORE_BOARD }, { previous: previous ?? null })
  if (res.newer.length) {
    throw new AppError(`${MSG.SETTINGS_FROM_NEWER_VERSION}: ${res.newer.map((n) => `${n.id} v${n.stored}`).join(', ')}`, 409, ErrorCode.CONFLICT)
  }
  if (res.issues.length) {
    throw settingsInvalidError(res.issues)
  }
  const keys = Object.keys(res.settings).filter((k) => k !== '$v')
  return keys.length ? res.settings : null
}
