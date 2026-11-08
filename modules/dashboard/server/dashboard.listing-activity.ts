import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardListingActivityLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.listing_activity'

/** Declared in dashboard/module.json `extensionPoints`. */
export const LISTING_ACTIVITY_POINT = 'dashboard:listing_activity'

/**
 * Which marketplace listings may show for a tenant. Each provider vouches for its own part: plugin_runtime owns the install
 * markers (switched on), marketplace owns revocation (taken down, version withdrawn or yanked, publisher suspended, not
 * paid for, blocked by the workspace's policy).
 */
export interface ListingActivityProvider {
  activeListingIds(tenantId: string, listingIds: string[]): Promise<Set<string>>
}

/**
 * The listings among `listingIds` that every provider vouches for (docs/phases/37-extensions/07). With no provider, or
 * when one cannot answer (throws, times out), NONE are: a widget that frames third-party UI is not shown when nothing can
 * vouch for the plugin behind it. That costs the board its plugin widgets, never the whole widget catalogue.
 */
export async function activeListingIds(tenantId: string, listingIds: string[]): Promise<Set<string>> {
  const { results, failed } = await ext.aggregate<ListingActivityProvider, Set<string>>(
    LISTING_ACTIVITY_POINT, tenantCtx(tenantId), dashboardListingActivityLoaders,
    (provider) => provider.activeListingIds(tenantId, listingIds),
  )
  if (results.length === 0 || failed.length > 0) return new Set()
  return new Set(listingIds.filter((id) => results.every((r) => r.value.has(id))))
}
