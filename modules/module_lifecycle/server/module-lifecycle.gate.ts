// The governance gate (docs/phases/25-marketplace/03-module-governance 02–04, 06):
// may this module be installed or switched on for this tenant, given who is
// asking? Asked before the entitlement seam by `install` and `setActive(…, true)`.
// The plan question stays the seam's; this one is the platform operator's:
//
//   placement (46)      never outside it: a root or fleet module for a customer,
//                       a business module for the fleet tenant
//                       (docs/phases/46-module-placement D46-4)
//   retired / hidden    no new install, no reactivation (03)
//   unlisted            not by the tenant's own hand; a plan, the operator or the
//                       default list may (03, 06). Reactivating a copy the tenant
//                       already has is fine.
//   blocked (04)        not for this tenant, whoever asks
//   hidden by config    not by the tenant's own hand (config/modules.ts `hidden`):
//                       the marketplace never lists it; a plan, the operator, the
//                       default list or a module that requires it may
//
// The reserved platform tenants (ROOT, Fleet) are the operator and pass.

import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { isModulePlacedIn, isPlatformOnlyModule } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { assertNotHiddenFromTenant } from './module-lifecycle.hidden';
import { getAvailability } from './module-lifecycle.availability';
import { getPolicy } from './module-lifecycle.policy';
import type { InstallOrigin } from './module-lifecycle.types';

export interface GateRequest {
  /**
   * Who asked. 'dependency' = pulled in by another module's install: an unlisted
   * dependency comes with the module that needs it, whoever installed that one.
   */
  origin: InstallOrigin | 'dependency';
  /** Switching an installed copy back on (setActive) rather than installing. */
  reactivate?: boolean;
}

const refuse = (message: string): never => {
  throw new AppError(message, 403, ErrorCode.FORBIDDEN);
};

export async function assertModuleAllowed(tenantId: string, moduleId: string, req: GateRequest): Promise<void> {
  if (!isModulePlacedIn(moduleId, tenantId)) {
    // The platform tenants are the operator: tell them the module is not placed here rather than that it is theirs.
    refuse(isPlatformOnlyModule(moduleId) && !isReservedTenant(tenantId)
      ? `Module '${moduleId}' is reserved for the platform operator.`
      : `Module '${moduleId}' is not available in this tenant: it is not placed here.`);
  }
  if (isReservedTenant(tenantId)) return;
  if (req.origin === 'tenant') assertNotHiddenFromTenant(tenantId, [moduleId]);

  const availability = await getAvailability(moduleId);
  const why = availability.reason ? ` ${availability.reason}` : '';
  if (availability.state === 'retired') refuse(`Module '${moduleId}' has been retired by the platform.${why}`);
  if (availability.state === 'hidden') refuse(`Module '${moduleId}' is not available.${why}`);
  if (availability.state === 'unlisted' && req.origin === 'tenant' && !req.reactivate) {
    refuse(`Module '${moduleId}' comes with a plan and cannot be installed on its own.`);
  }

  const policy = await getPolicy(tenantId, moduleId);
  if (policy?.policy === 'block') {
    refuse(`Module '${moduleId}' is blocked for this workspace by the platform.${policy.reason ? ` ${policy.reason}` : ''}`);
  }
}
