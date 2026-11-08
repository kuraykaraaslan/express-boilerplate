import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys'
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'
import { assertHeadroomFor, limitOf } from './observability.limits'
import { refusalDetails, refusalForLimit, refusalForReason } from './observability.refusals'

/**
 * Is a workspace allowed to have BROWSER checks at all (D-OBS-8)? Two independent switches, BOTH must allow it:
 *  - the plan: `observability.limit.type_browser` = 0 means "not in the plan". An undeclared key is unlimited by this module's rule, so the plan alone cannot keep a headless
 *    browser from being offered by accident;
 *  - the workspace: `observabilityBrowserChecksEnabled`, default OFF, switched on by an admin.
 * The lease service asks the same question for every leased BROWSER check, so switching either off stops checks that already exist, not only new ones.
 */
type SettingReader = (tenantId: string) => Promise<boolean>

const defaultReader: SettingReader = async (tenantId) => {
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')
    const raw = await SettingService.getValue(tenantId, OBSERVABILITY_SETTING_KEYS.BROWSER_CHECKS_ENABLED)
    return String(raw ?? '').trim().toLowerCase() === 'true'
  } catch { return false } // fails CLOSED: an unreadable switch is off, because the safe state of an expensive, sandboxed feature is "not running"
}
let reader: SettingReader = defaultReader
/** Test seam. */
export function setBrowserSettingReader(fn?: SettingReader): void { reader = fn ?? defaultReader }

export async function browserChecksEnabled(tenantId: string): Promise<boolean> {
  if (!(await reader(tenantId))) return false
  return (await limitOf(tenantId, K.TYPE_BROWSER)) !== 0
}

/** Refuse (403) when this workspace may not have BROWSER checks; the details name which switch is off. */
export async function assertBrowserChecksEnabled(tenantId: string): Promise<void> {
  if (!(await reader(tenantId))) {
    throw new AppError('Browser checks are switched off for this workspace. An admin can turn them on in the observability settings.', 403, ErrorCode.FORBIDDEN,
      { details: { setting: OBSERVABILITY_SETTING_KEYS.BROWSER_CHECKS_ENABLED, ...refusalDetails(refusalForReason('browser_off')) } })
  }
  if ((await limitOf(tenantId, K.TYPE_BROWSER)) === 0) {
    throw new AppError('The BROWSER monitor type is not part of your plan.', 403, ErrorCode.FORBIDDEN, { details: { key: K.TYPE_BROWSER, limit: 0, ...refusalDetails(refusalForLimit(K.TYPE_BROWSER)) } })
  }
}

/** Adding `adding` more BROWSER monitors must stay inside the plan's browser-monitor count (undeclared = unlimited). */
export function assertBrowserHeadroom(tenantId: string, count: () => Promise<number>, adding = 1): Promise<void> {
  return assertHeadroomFor(tenantId, K.BROWSER_MONITORS, 'browser monitors', count, adding)
}
