import { moduleRegistry, type RuntimePermission } from '@kuraykaraaslan-labs/common/server/module-registry';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import ApiKeyMessages from './api_key.messages';

/**
 * Which module permissions an API key may hold (docs/phases/48-api-key-scopes, D11, D12, D48-3).
 *
 * A key acts on module routes through the key lane of auth_abac's tenant guard, as its holder and never beyond the holder's
 * current rights. On top of that ceiling some permissions are never a key's:
 *  - an OWNER floor (ownership, deleting the workspace): a custom group cannot lift one either;
 *  - a GUEST floor (public routes, no key needed) and account-scope ones (the person outside any tenant: no key lane there);
 *  - the identity and access modules: a leaked key must not mint keys, change members, roles, groups, policies, sessions or
 *    sign-in methods, or bind a push device to a session that does not exist.
 * The same rule is applied when a key is created or edited AND on every call, so a permission that stops being grantable
 * stops working on the keys that hold it.
 */
const KEY_EXCLUDED_MODULES: ReadonlySet<string> = new Set([
  'api_key', 'account', 'notification_push', 'scim', 'tenant', 'tenant_member', 'tenant_session', 'user', 'user_session',
  // Review fixes: invitations add members (an ADMIN invite to an outside address is a takeover); the tenant settings write
  // the sign-in policy, the IP lists, the module switches and api_key's own policy (no owner gates those keys); the socket
  // sessions are a person's.
  'tenant_invitation', 'tenant_setting', 'websocket_session',
]);

/** A module whose permissions no key may hold: the list above, `auth` and every `auth_*` sign-in or access module, every `user_*` module of the person. */
export function isKeyExcludedModule(moduleId: string): boolean {
  return KEY_EXCLUDED_MODULES.has(moduleId) || moduleId === 'auth' || moduleId.startsWith('auth_') || moduleId.startsWith('user_');
}

/** A socket ticket is a signed-in person's (websocket 04 §4.8); a key is refused one, so its permission would do nothing. */
const isSocketTicketPermission = (permissionId: string) => permissionId.endsWith('.ws_ticket.create');

/** May an API key hold this permission at all (before the holder's rights and the tenant's modules are asked)? */
export function isKeyGrantable(p: Pick<RuntimePermission, 'moduleId' | 'minRole' | 'scope'> & { id?: string }): boolean {
  if (p.scope === 'account' || isSocketTicketPermission(p.id ?? '')) return false;
  const floor = p.minRole ?? 'ADMIN';
  if (floor !== 'USER' && floor !== 'ADMIN') return false;
  return !isKeyExcludedModule(p.moduleId);
}

/** The "read only" preset of a module (D11): permissions whose last segment only reads (`read`, `read_all`, `view`, `list`). */
const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set(['read', 'read_all', 'view', 'list']);
export function isReadOnlyPermission(permissionId: string): boolean {
  return READ_ONLY_ACTIONS.has(permissionId.slice(permissionId.lastIndexOf('.') + 1));
}

let BY_ID: Map<string, RuntimePermission> | null = null;
/** The catalogue entry of a permission id (the registry is static at runtime). */
export function permissionEntry(permissionId: string): RuntimePermission | undefined {
  if (!BY_ID) BY_ID = new Map(moduleRegistry.getPermissions().map((p) => [p.id, p]));
  return BY_ID.get(permissionId);
}

/** Every permission a key may hold in this build (editions decide which modules are in the registry at all). */
export function keyGrantableCatalog(): RuntimePermission[] {
  return moduleRegistry.getPermissions().filter(isKeyGrantable);
}

/**
 * The key-grantable permissions of the modules enabled for the tenant now (placement, the platform's bans, the tenant's
 * own switches). The catalogue the create screen offers before the caller's own rights narrow it.
 */
export async function tenantKeyCatalog(tenantId: string): Promise<RuntimePermission[]> {
  const enabled = await getEnabledModuleIds(tenantId);
  return keyGrantableCatalog().filter((p) => enabled.has(p.moduleId));
}

/**
 * Refuse (403) any id that names no permission, is not key-grantable, or belongs to a module the tenant has not enabled.
 * The message names no id: the caller only learns that the list was refused.
 */
export async function assertKeyGrantable(tenantId: string, permissionIds: readonly string[]): Promise<void> {
  if (permissionIds.length === 0) return;
  const enabled = await getEnabledModuleIds(tenantId);
  for (const id of permissionIds) {
    const p = permissionEntry(id);
    if (!p || !isKeyGrantable(p) || !enabled.has(p.moduleId)) {
      throw new AppError(ApiKeyMessages.PERMISSION_NOT_GRANTABLE, 403, ErrorCode.FORBIDDEN);
    }
  }
}

/** Refuse (403) unless the caller holds every one of these permissions now (D12: a key's set is a subset of its creator's). */
export function assertHeld(permissionIds: readonly string[], held: ReadonlySet<string> | undefined): void {
  if (permissionIds.length === 0) return;
  if (!held || permissionIds.some((id) => !held.has(id))) {
    throw new AppError(ApiKeyMessages.PERMISSION_NOT_HELD, 403, ErrorCode.FORBIDDEN);
  }
}

/** Distinct ids, sorted, so a stored list reads the same however it was sent. */
export function normalisePermissions(permissionIds: readonly string[]): string[] {
  return [...new Set(permissionIds)].sort();
}
