import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { tenantMemberSeatAllowanceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant_member.seat_allowance'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'

/** Declared in tenant_member/module.json `extensionPoints`. */
export const SEAT_ALLOWANCE_POINT = 'tenant_member:seat_allowance'

/**
 * A source of seat ceilings beyond the plan's `max_members` feature limit: what the tenant's entitlements include, plus any
 * admin override. `tenant_subscription` contributes it; `tenant_member` never learns that products or entitlements exist.
 * `null` means "this source states no ceiling".
 */
export interface SeatAllowanceProvider {
  effectiveLimit(tenantId: string): Promise<number | null>
}

/**
 * The tightest ceiling any contributor declares for the tenant, or `null` when none does (no contributor installed, monetization off,
 * or an unmetered tenant). A contributor that cannot answer refuses (503, naming it): this enforces what was paid for, and a seat check
 * that silently allowed everything on an outage would be a billing hole.
 *
 * Asked whatever modules the tenant has switched on (the point's `platform` gate): the ceiling is what the tenant paid for, and switching the
 * module that sells seats off must not lift it (the reasoning of `module_lifecycle:entitlement`).
 */
export async function seatAllowance(tenantId: string): Promise<number | null> {
  const { results, unverifiable, blocked } = await ext.guard<SeatAllowanceProvider, number | null>(
    SEAT_ALLOWANCE_POINT, tenantCtx(tenantId), tenantMemberSeatAllowanceLoaders,
    (provider) => provider.effectiveLimit(tenantId),
    { validate: (n) => n == null || (typeof n === 'number' && Number.isFinite(n)) },
  )
  if (blocked) {
    throw new AppError(
      `Cannot verify the seat allowance: could not verify ${unverifiable.map((f) => f.moduleId).join(', ')}`,
      503,
      ErrorCode.INTERNAL_ERROR,
    )
  }
  let limit: number | null = null
  for (const { value: n } of results) {
    if (n != null && (limit == null || n < limit)) limit = n
  }
  return limit
}
