/**
 * A tenant-authored widget's `allowedRoles` (owner decision 2026-10-16: enforced on placement and on render).
 *
 * An empty or missing list admits everyone; a caller with no membership is outside every list. Two kinds of entry:
 * - a built-in role name (`OWNER`, `ADMIN`, `USER`, any case, the `dynamic_page` meaning) matches the member's
 *   built-in `memberRole` only. A custom role that happens to be called `owner` never passes as an OWNER;
 * - any other entry is a custom role key (auth_abac 6.2) and matches, exactly, a key the member holds that is still an
 *   ACTIVE role of the tenant (`activeCustomKeys`), the rule `TenantRoleService.permissionsFor` applies: a deleted or
 *   switched-off group grants nothing. Without `activeCustomKeys` no custom entry matches (fails closed).
 *
 * Pure and free of service/db imports, like `widget-placement.acl.ts`, so it can be unit-tested without env.
 */
export const BUILTIN_MEMBER_ROLES = ['OWNER', 'ADMIN', 'USER'] as const
const BUILTIN = new Set<string>(BUILTIN_MEMBER_ROLES)

export function widgetAllowsMember(
  widget: { allowedRoles?: string[] | null },
  member: { memberRole?: string | null; roleKeys?: string[] | null } | null | undefined,
  activeCustomKeys?: ReadonlySet<string>,
): boolean {
  const roles = widget.allowedRoles
  if (!roles || roles.length === 0) return true
  if (!member) return false
  const memberRole = member.memberRole?.toUpperCase()
  const held = new Set((member.roleKeys ?? []).filter((k) => activeCustomKeys?.has(k)))
  return roles.some((r) => (BUILTIN.has(r.toUpperCase()) ? r.toUpperCase() === memberRole : held.has(r)))
}

/** Does any of these widgets name a custom role (so the tenant's active role keys are worth reading)? */
export function needsCustomRoles(widgets: Array<{ allowedRoles?: string[] | null }>): boolean {
  return widgets.some((w) => (w.allowedRoles ?? []).some((r) => !BUILTIN.has(r.toUpperCase())))
}
