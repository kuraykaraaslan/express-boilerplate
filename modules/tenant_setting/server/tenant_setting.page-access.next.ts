// Which admin pages a viewer may open, by the admin renderer's own check (app/tenant/[tenantId]/admin/(shell)/[[...slug]]):
// the page's route in its placement (docs/phases/46-module-placement D46-4), its module on for the tenant, and every
// permission of its guard held (docs/phases/45-install-config D45-5). The settings hub builds its cards from it, so a
// card shows exactly when its page would open, and a page closed by config/access.ts or a switched-off module has none.
import type { NextRequest } from 'next/server';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { grantedGuardPermissions, guardOpens } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.page-guard.next';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import { getEnabledModuleIds } from './module-activation.service.next';

/**
 * The paths of `paths` (admin paths, `/admin/...`) the authenticated caller may open. A path no page serves here, a page
 * of a module that is off, and a page without a guard are closed. Throws what the permission decision throws.
 */
export async function openAdminPages(args: {
  request: NextRequest;
  tenantId: string;
  auth: Pick<TenantAuthResult, 'user' | 'userSession' | 'tenantMember' | 'isGlobalAdmin'>;
  paths: readonly string[];
}): Promise<string[]> {
  const { request, tenantId, auth } = args;
  const enabled = await getEnabledModuleIds(tenantId);
  const guards = new Map<string, readonly string[]>();
  for (const path of new Set(args.paths)) {
    const match = moduleRegistry.findPageRoute(path, { tenantId });
    if (!match || !enabled.has(match.route.moduleId)) continue;
    const guard = match.route.guard ?? [];
    if (guard.length) guards.set(path, guard);
  }
  if (guards.size === 0) return [];
  const granted = await grantedGuardPermissions({
    request,
    tenantId,
    session: { user: auth.user, tenantMember: auth.tenantMember, isGlobalAdmin: auth.isGlobalAdmin },
    account: { user: auth.user, tenantMember: null, userSession: auth.userSession, userRole: auth.user.userRole },
    permissionIds: [...guards.values()].flat(),
  });
  return [...guards].filter(([, guard]) => guardOpens(guard, granted)).map(([path]) => path);
}
