import Logger from '@kuraykaraaslan-labs/logger'
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module'
import type { BrandIdentity } from '@kuraykaraaslan-labs/common/server/brand-identity.types'

/**
 * The status page's branding, as an ALLOWLIST (observability phase 3's last
 * open item).
 *
 * A tenant's status page carrying somebody else's chrome is the one page where
 * that matters most: it is read by a customer who cannot reach the product, on
 * a URL they were given during an outage, and an unbranded page looks like the
 * wrong page.
 *
 * ## Served from the status payload, not fetched separately
 *
 * The status page is built to keep working while everything else burns. A
 * second client fetch is a second thing that can fail on exactly the day it
 * must not, so branding rides the same allowlisted response the components do.
 *
 * ## Three fields, and the omissions are the design
 *
 * `customCss` and `customJs` are NOT here, and never will be. Tenant-authored
 * script injected into the status page means the page goes down with whatever
 * broke — the page whose entire job is to still be standing. It is also an
 * anonymous, unauthenticated surface, which is the worst place to evaluate
 * strings a tenant admin typed.
 *
 * `brandPrimaryColor` colours the HEADER only, never a status indicator. The
 * greens and reds are semantic: repainting an outage in a brand colour makes a
 * broken service look fine, which is the opposite of what the page is for.
 *
 * `brandFavicon`, `authWallpaper`, `privacyPolicyUrl` and `termsOfServiceUrl`
 * are omitted because the page does not use them; a field is added here when a
 * consumer exists, not in advance.
 *
 * `tenant_branding` being absent degrades to `null` and the page renders its
 * plain self — the same rule the maintenance bridge follows.
 */

/** The shared four-field brand allowlist (`common/server/brand-identity.types`). */
export type StatusBranding = BrandIdentity

export async function loadStatusBranding(tenantId: string): Promise<StatusBranding | null> {
  try {
    // Only while tenant_branding is on for the tenant (optional, EXT-14); otherwise the plain page, as when it is absent.
    const brandingModule = await ifActive(tenantId, 'tenant_branding', () => import('@kuraykaraaslan-labs/tenant_branding/server/tenant_branding.service'))
    if (!brandingModule) return null
    const b = await brandingModule.default.get(tenantId)
    const branding: StatusBranding = {
      name: b.brandName || null,
      logoLight: b.brandLogoLight || null,
      logoDark: b.brandLogoDark || null,
      primaryColor: b.brandPrimaryColor || null,
    }
    // Nothing configured is not the same as "branding unavailable", but the
    // page treats them identically, so collapse rather than ship an object of
    // four nulls.
    return Object.values(branding).some(Boolean) ? branding : null
  } catch (err) {
    Logger.warn(`[observability] status branding unavailable: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
