import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { installModules } from '@kuraykaraaslan-labs/common/server/install-config/install-config.modules';

/**
 * A tenant's own marketplace action (install, switch, remove, the delete preview) on a module the installation hides from
 * the tenants (config/modules.ts `hidden`): refused like a module the platform made unavailable, since the marketplace
 * never lists it. The reserved platform tenants are the operator and pass. The gate asks it for the tenant's own installs
 * and reactivations; the tenant routes and the tenant's uninstall and purge ask it for the rest.
 */
export function assertNotHiddenFromTenant(tenantId: string, moduleIds: readonly string[]): void {
  if (isReservedTenant(tenantId)) return;
  const hidden = moduleIds.find((id) => installModules().hidden.has(id));
  if (hidden) throw new AppError(`Module '${hidden}' is not available.`, 403, ErrorCode.FORBIDDEN);
}
