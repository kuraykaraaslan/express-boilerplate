// The admin page guard's permission decision (docs/phases/45-install-config D45-5), in one place for the admin renderer
// (app/tenant/[tenantId]/admin/(shell)/_access.ts) and for a page that lists links to other admin pages (the settings
// hub, tenant_setting.page-access.next.ts), so a link shows exactly when its page would open.
import type { NextRequest } from 'next/server';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { permissionsExemptFromGroupLift } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.group-floor.next';
import type { SubjectSource } from './auth_abac.attributes';

/** Permissions only system-scope menu entries name: a group or a config grant never lifts them (group-floor.next). */
let systemOnly: Set<string> | null = null;
const systemOnlyPermissions = (): Set<string> => (systemOnly ??= new Set(permissionsExemptFromGroupLift(moduleRegistry.getMenuItems())));

/** Account permissions (module.json `scope: "account"`): their APIs decide them outside any tenant. */
let accountScoped: Set<string> | null = null;
const accountPermissions = (): Set<string> =>
  (accountScoped ??= new Set(moduleRegistry.getPermissions().filter((p) => p.scope === 'account').map((p) => p.id)));

/**
 * Which of `permissionIds` (page guard permissions) the viewer holds, by the same decision the API makes (role floor,
 * custom groups, the role matrix, policies, config/access.ts). An account permission is decided as its ACCOUNT-scope
 * API decides it: in the root tenant, without a membership, by the platform role (`account`), so a config/access.ts
 * rule on it closes the page and the API for the same people. Throws what the decision throws.
 */
export async function grantedGuardPermissions(args: {
  request: NextRequest;
  tenantId: string;
  /** The member as a TENANT-scope route sees them. */
  session: SubjectSource;
  /** The same person as an ACCOUNT-scope route sees them: no membership, their platform role. */
  account: SubjectSource;
  permissionIds: readonly string[];
}): Promise<Set<string>> {
  const exempt = systemOnlyPermissions();
  const account = accountPermissions();
  const ids = [...new Set(args.permissionIds)];
  const inTenant = ids.filter((p) => !account.has(p));
  const ofAccount = ids.filter((p) => account.has(p));
  const granted = new Set<string>();
  if (inTenant.length) {
    for (const p of await grantedPermissions({
      request: args.request, tenantId: args.tenantId, session: args.session, permissionIds: inTenant,
      noGroupLift: inTenant.filter((p) => exempt.has(p)),
    })) granted.add(p);
  }
  if (ofAccount.length) {
    for (const p of await grantedPermissions({
      request: args.request, tenantId: ROOT_TENANT_ID, session: args.account, permissionIds: ofAccount,
    })) granted.add(p);
  }
  return granted;
}

/** May a viewer holding `granted` open a page guarded by `guard`? Every permission must be held; an empty guard never opens. */
export const guardOpens = (guard: readonly string[], granted: ReadonlySet<string>): boolean =>
  guard.length > 0 && guard.every((p) => granted.has(p));
