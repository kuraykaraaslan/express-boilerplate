import type { ListingActivityProvider } from '@kuraykaraaslan-labs/dashboard/server/dashboard.listing-activity'
import { activeCommunityListingIds } from './broker/active-listings'

/** The plugin runtime as the authority on which community listings are active (point `dashboard:listing_activity`). */
const provider: ListingActivityProvider = { activeListingIds: activeCommunityListingIds }

export default provider
