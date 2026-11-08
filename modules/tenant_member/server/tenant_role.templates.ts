import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantMemberRoleTemplateLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant_member.role_template';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import TenantRoleService from './tenant_role.service';
import type { RoleView } from './tenant_role.types';
import { TENANT_ROLE_MESSAGES as MSG } from './tenant_role.messages';

/**
 * Role templates: ready-made custom groups a tenant can add in one click.
 *
 * ## Why this exists instead of lowering `minRole`
 *
 * Commerce plan 09 §5.2 asked for store operators (read and ship orders,
 * receive returns, moderate reviews) by lowering those permissions' `minRole`
 * from ADMIN to USER. That is unsafe here: signing up on a tenant's storefront
 * makes the shopper a TenantMember with `memberRole` USER
 * (`auth-register.route.ts`, `defaultMemberRole`). "USER = staff" does not
 * hold, and the lowering would have let every registered customer read every
 * order and its address and mark parcels shipped.
 *
 * A custom group grants a permission to exactly the members it is assigned to
 * (migration 118, `roleKeys`), and that is the right tool. What was missing was
 * a way to get a sensible operator group without ticking twenty boxes. A
 * template is that box set.
 *
 * ## Contributions merge by key
 *
 * `tenant_member:role_template` contributions export
 * `{ key, label, description?, permissions }`. Several modules contribute to
 * the SAME key, each listing only its own permissions: `commerce_order`,
 * `commerce_fulfillment`, `commerce_return` and `commerce_review` together make
 * `store_operator`. No module names another module's permission, and a tenant
 * without returns simply gets an operator template without them.
 *
 * Offered permissions are filtered to what the registry declares for the
 * tenant's ENABLED modules. A template never creates a grant that points at
 * nothing, and a template left with no permissions is not offered.
 */

export const ROLE_TEMPLATE_POINT = 'tenant_member:role_template';

export interface RoleTemplateContribution {
  key: string;
  label: string;
  description?: string;
  permissions: string[];
}

export interface RoleTemplate extends RoleTemplateContribution {
  /** Modules that contributed to it, for the picker's "includes …" line. */
  moduleIds: string[];
}

export async function listRoleTemplates(tenantId: string): Promise<RoleTemplate[]> {
  const enabled = await getEnabledModuleIds(tenantId);
  const known = new Set(
    moduleRegistry.getPermissions().filter((p) => enabled.has(p.moduleId)).map((p) => p.id),
  );
  const merged = new Map<string, RoleTemplate>();
  // One that fails to load, or is not a template, is logged by the runtime and left out.
  const { loaded } = await ext.loadAll<RoleTemplateContribution>(
    ROLE_TEMPLATE_POINT, tenantCtx(tenantId), tenantMemberRoleTemplateLoaders,
    { validate: (c) => !!c?.key && Array.isArray(c.permissions) },
  );
  for (const { contribution: from, impl: contribution } of loaded) {
    const t = merged.get(contribution.key) ?? {
      key: contribution.key, label: contribution.label, description: contribution.description,
      permissions: [], moduleIds: [],
    };
    for (const p of contribution.permissions) if (known.has(p) && !t.permissions.includes(p)) t.permissions.push(p);
    if (!t.moduleIds.includes(from.moduleId)) t.moduleIds.push(from.moduleId);
    merged.set(contribution.key, t);
  }
  return [...merged.values()].filter((t) => t.permissions.length > 0).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Create the tenant's own custom group from a template. After that it is an
 * ordinary group: editable, assignable, deletable. A key already taken is the
 * same 409 a hand-made group gets.
 */
export async function createRoleFromTemplate(
  tenantId: string,
  templateKey: string,
  opts: { isOwner: boolean; actorId?: string },
): Promise<RoleView> {
  const template = (await listRoleTemplates(tenantId)).find((t) => t.key === templateKey);
  if (!template) throw new AppError(MSG.TEMPLATE_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  return TenantRoleService.createRole(tenantId, {
    key: template.key,
    label: template.label,
    description: template.description,
    permissions: template.permissions,
  }, opts);
}
