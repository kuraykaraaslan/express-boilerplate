import { ext, tenantCtx } from './extensions/ext'
import { commonHolidayLookupLoaders } from './generated/extensions/common.holiday_lookup'

/**
 * Where a lower-edition module asks which days are public holidays. `on_call` makes its rotation holiday-aware (`holidays: 'exclude' | 'only'` on a
 * layer restriction), but `calendar` is a Pro module and a Core module may not import a higher edition (ADR-0001, phase 35/02). `calendar`
 * contributes the lookup (`calendar/server/calendar.holiday-lookup`); without it, or with it switched off for the tenant, nothing is a holiday.
 *
 * Hosted by `common`: `on_call` already contributes to calendar's `calendar:feed`, so a contribution from calendar into an on_call point would be a
 * contribution cycle, which the registry refuses (the `common:price_resolver` precedent). Declared in common/module.json `extensionPoints`.
 */
export const HOLIDAY_LOOKUP_POINT = 'common:holiday_lookup'

export interface HolidayLookup {
  /** The dates (`YYYY-MM-DD`) that are holidays for the tenant's holiday calendars, from `from` to `to` inclusive. */
  datesBetween(tenantId: string, from: string, to: string): Promise<string[]>
}

/**
 * The tenant's contributed lookup, or `null` when no module active for the tenant provides one. A lookup that cannot be loaded is a failure the
 * runtime logs and skips, so it answers `null` as well.
 */
export async function loadHolidayLookup(tenantId: string): Promise<HolidayLookup | null> {
  const found = await ext.first<HolidayLookup, HolidayLookup>(
    HOLIDAY_LOOKUP_POINT, tenantCtx(tenantId), commonHolidayLookupLoaders, (lookup) => lookup,
  )
  return found?.value ?? null
}
