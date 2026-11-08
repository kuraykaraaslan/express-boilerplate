// Who is viewing the admin shell: the port of NB's app/tenant/[tenantId]/admin/(shell)/_access.ts. Worked out once per request by the
// caller (no React cache()); every function runs inside `requestContext.run(request, …)` so `headers()` and `cookies()` see the request.
import type { NextRequest } from 'next/server';
import { requestFromHeaders } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.guard.next';
import { authenticateTenantByRequest } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.authenticate.next';
import { installRoleLabels, type InstallRoleLabels } from '@kuraykaraaslan-labs/common/server/install-config/install-config.roles';
import { InstallConfigError } from '@kuraykaraaslan-labs/common/server/install-config/install-config.service';
import { grantedGuardPermissions, guardOpens } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.page-guard.next';
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes';

export type AdminViewer =
  | { ok: true; request: NextRequest; session: SubjectSource; account: SubjectSource; labels: InstallRoleLabels }
  | { ok: false; reason: string };

/** The signed-in member of `tenantId`, or why they could not be worked out. Never throws: each caller fails closed in its own way. */
export async function adminViewer(tenantId: string): Promise<AdminViewer> {
  try {
    const request = await requestFromHeaders();
    const { user, userSession, tenantMember, isGlobalAdmin } = await authenticateTenantByRequest({
      request, tenantId, requiredTenantRole: 'USER', otpVerifyBypass: true,
    });
    return {
      ok: true,
      request,
      session: { user, tenantMember, isGlobalAdmin },
      account: { user, tenantMember: null, userSession, userRole: user.userRole },
      labels: installRoleLabels({ tenantId, memberRole: tenantMember?.memberRole, roleKeys: tenantMember?.roleKeys, isGlobalAdmin }),
    };
  } catch (e) {
    // Name and message only: never the request, its cookies or a token.
    return { ok: false, reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

export type AdminPageAccess = 'granted' | 'denied' | 'unresolved';

/**
 * The admin page guard: may the viewer open a page whose guard is `guard`? Every permission must be granted by the same
 * decision the API makes. `denied` for an empty guard (fail closed); `unresolved` when the session could not be worked out.
 */
export async function adminPageAccess(tenantId: string, guard: readonly string[], viewer?: AdminViewer): Promise<AdminPageAccess> {
  if (!guard.length) return 'denied';
  const v = viewer ?? await adminViewer(tenantId);
  if (!v.ok) return 'unresolved';
  try {
    const granted = await grantedGuardPermissions({
      request: v.request, tenantId, session: v.session, account: v.account, permissionIds: guard,
    });
    return guardOpens(guard, granted) ? 'granted' : 'denied';
  } catch (e) {
    if (e instanceof InstallConfigError) throw e;
    return 'unresolved';
  }
}
