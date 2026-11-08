// The in-route half of a root or fleet API route's guard (docs/phases/46-module-placement D46-4). The dispatcher already
// answers not-found outside a route's placement; a route of the federation's own console checks the fleet tenant again
// itself, so it stays closed when it is called some other way (a direct import, a test, a future file route). A root route
// keeps its `scope: 'GLOBAL'` guard; `assertRootTenant` is for the root routes whose guard is a tenant-scope permission.
// scripts/registry/placement.mjs fails the build when a fleet or root route has neither.

import { AppError, ErrorCode } from './app-error';
import { isFleetTenant, isRootTenant } from './tenant-constants';

/** Not found (no oracle) unless `tenantId` is the fleet tenant. */
export function assertFleetTenant(tenantId: string): void {
  if (!isFleetTenant(tenantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
}

/** Not found (no oracle) unless `tenantId` is the root tenant. */
export function assertRootTenant(tenantId: string): void {
  if (!isRootTenant(tenantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
}
