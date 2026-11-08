// The generic settings API's check on keys another module owns (tenant_setting.key-owners.ts): the owner module must be
// on for the tenant and the caller must also hold the owner's permission, so a switched-off module, a role or a
// config/access.ts without that permission neither reads nor writes that module's settings here. Decided as the owner's
// settings page is (auth_abac.page-guard.next.ts), on the session the route already authenticated: one bulk decision,
// and a permission the caller lacks writes no denial row of its own, as a second authentication would.
import type { NextRequest } from 'next/server';
import { grantedGuardPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.page-guard.next';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import { ownersOfKeys, settingKeyOwner, type SettingKeyOwner } from './tenant_setting.key-owners';
import { getEnabledModuleIds } from './module-activation.service.next';

/** The authenticated caller, as the route's own `authorizeRequest` answered it. */
export type SettingsCaller = Pick<TenantAuthResult, 'user' | 'userSession' | 'tenantMember' | 'isGlobalAdmin'>;

/**
 * The owners of `owners` the caller may not use for `need` (`read`, or `read` and `update`): the owner module is off
 * for the tenant, or one of its permissions is not held. Owners are judged together, in one read of each.
 */
async function closedOwners(
  request: NextRequest,
  tenantId: string,
  auth: SettingsCaller,
  owners: readonly SettingKeyOwner[],
  need: (owner: SettingKeyOwner) => readonly string[],
): Promise<Set<SettingKeyOwner>> {
  if (owners.length === 0) return new Set();
  const enabled = await getEnabledModuleIds(tenantId);
  const on = owners.filter((owner) => enabled.has(owner.moduleId));
  const granted = on.length
    ? await grantedGuardPermissions({
      request,
      tenantId,
      session: { user: auth.user, tenantMember: auth.tenantMember, isGlobalAdmin: auth.isGlobalAdmin },
      account: { user: auth.user, tenantMember: null, userSession: auth.userSession, userRole: auth.user.userRole },
      permissionIds: on.flatMap(need),
    })
    : new Set<string>();
  return new Set(owners.filter((owner) => !enabled.has(owner.moduleId) || !need(owner).every((id) => granted.has(id))));
}

/**
 * `records` without the keys of an owner that is off or whose read permission the caller lacks. A record set with no
 * owned key costs nothing.
 */
export async function withoutUnreadableOwnedKeys(
  request: NextRequest,
  tenantId: string,
  auth: SettingsCaller,
  records: ReadonlyArray<Record<string, string>>,
): Promise<Array<Record<string, string>>> {
  const owners = ownersOfKeys(records.flatMap((r) => Object.keys(r)));
  const closed = await closedOwners(request, tenantId, auth, owners, (owner) => owner.read);
  if (closed.size === 0) return records.map((r) => ({ ...r }));
  return records.map((r) => Object.fromEntries(Object.entries(r).filter(([key]) => {
    const owner = settingKeyOwner(key);
    return !owner || !closed.has(owner);
  })));
}

/** Refuses (403) a write or delete of `keys` unless every owner is on and the caller holds its read and update permissions. */
export async function assertOwnedKeysWritable(
  request: NextRequest,
  tenantId: string,
  auth: SettingsCaller,
  keys: Iterable<string>,
): Promise<void> {
  const list = [...keys];
  const owners = ownersOfKeys(list);
  const closed = await closedOwners(request, tenantId, auth, owners, (owner) => [...owner.read, ...owner.update]);
  for (const owner of owners) {
    if (!closed.has(owner)) continue;
    const named = list.filter((key) => settingKeyOwner(key) === owner);
    throw new AppError(
      `These settings belong to the ${owner.moduleId} module, whose settings you may not change: ${named.slice(0, 20).join(', ')}.`,
      403,
      ErrorCode.FORBIDDEN,
      { details: { reason: 'MODULE_SETTINGS_FORBIDDEN', moduleId: owner.moduleId, keys: named.slice(0, 20) } },
    );
  }
}
