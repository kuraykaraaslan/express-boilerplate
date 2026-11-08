/**
 * Which access-control changes only the workspace OWNER may make (05-tenant-member 2.2 / 3.2), as pure functions over the
 * stored role set, so the routes (fail fast, against the cached set) and the write service (under the role-set lock) ask
 * the same question. No DB access here.
 */
import { isSensitive } from './tenant_role.helpers';
import type { SetGrantInput, UpdateRoleInput } from './tenant_role.dto';

// A non-owner is refused a CHANGE to a sensitive id, compared against the stored set: adding or removing one, the OWNER
// column, or switching off / deleting a group that holds one. A sensitive id that is already there and stays there is not a
// change, so an admin can still rename a group an owner gave `abac.*`, or save the matrix around an owner's grant.
// The routes ask these against the cached role set (fail fast); the service asks them again under the role-set lock.

/** Whether a permission list holds a sensitive id. */
export function holdsSensitive(permissions: readonly string[] | null | undefined): boolean {
  return (permissions ?? []).some(isSensitive);
}

/** The sensitive ids `next` adds to or removes from `stored`. */
export function sensitiveDelta(stored: readonly string[] | null | undefined, next: readonly string[]): string[] {
  const before = new Set(stored ?? []);
  const after = new Set(next);
  return [...new Set([...before, ...after])].filter((id) => isSensitive(id) && before.has(id) !== after.has(id));
}

const sameSet = (a: readonly string[] | null | undefined, b: readonly string[]): boolean => {
  const x = new Set(a ?? []);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/**
 * The matrix changes only an OWNER may make: a cell of the OWNER column or of a sensitive permission whose requested value
 * differs from the stored one. A change naming a role that is not in `roles` counts as owner-only (fail closed), so a
 * non-owner gets 403 rather than the 404 of the save for such a cell.
 */
export function ownerOnlyMatrixChanges(
  changes: readonly SetGrantInput[],
  roles: ReadonlyArray<{ key: string; permissions: readonly string[] | null }>,
): SetGrantInput[] {
  const byKey = new Map(roles.map((r) => [r.key, new Set(r.permissions ?? [])]));
  return changes.filter((c) => {
    if (c.roleKey !== 'OWNER' && !isSensitive(c.permissionId)) return false;
    const stored = byKey.get(c.roleKey);
    return !stored || stored.has(c.permissionId) !== c.granted;
  });
}

/** Whether `input` changes `stored` in a way only an OWNER may: the OWNER role's grants, a sensitive id, or the active flag of a group holding one. */
export function roleUpdateNeedsOwner(
  roleKey: string,
  stored: { permissions: readonly string[] | null; isActive: boolean; isBuiltin: boolean },
  input: UpdateRoleInput,
): boolean {
  if (input.permissions !== undefined) {
    if (roleKey === 'OWNER' && !sameSet(stored.permissions, input.permissions)) return true;
    if (sensitiveDelta(stored.permissions, input.permissions).length) return true;
  }
  return input.isActive !== undefined && !stored.isBuiltin && input.isActive !== stored.isActive && holdsSensitive(stored.permissions);
}
