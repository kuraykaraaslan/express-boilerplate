import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { communityInstallKeys } from './install-keys';

/**
 * Which installed community listings are currently ACTIVE for a tenant.
 *
 * It lives here, next to `communityInstallKeys`, because this module owns those
 * keys — a consumer that read them itself would be reaching into another
 * module's storage convention, and there is already more than one consumer.
 *
 * The question exists because deactivating a plugin does NOT un-materialize what
 * it wrote. `setCommunityActive` flips one setting on purpose: it is a cheap,
 * reversible pause, not an uninstall. But anything a listing materialized into a
 * host module's tables — a page-builder block, a dashboard widget — carries that
 * host's `moduleId`, not the listing's, so the enabled-module filter cannot see
 * it and a paused plugin kept rendering. Hosts call this and drop rows whose
 * listing is not active; reactivating brings them straight back.
 */
export async function activeCommunityListingIds(
  tenantId: string,
  listingIds: string[],
): Promise<Set<string>> {
  const wanted = [...new Set(listingIds)];
  if (wanted.length === 0) return new Set();
  const rec = await SettingService.getByKeys(tenantId, wanted.map(communityInstallKeys.active));
  return new Set(wanted.filter((id) => rec[communityInstallKeys.active(id)] === 'true'));
}
