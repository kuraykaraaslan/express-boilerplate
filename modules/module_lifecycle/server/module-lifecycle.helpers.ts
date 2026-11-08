// Shared plumbing of the lifecycle orchestrator: install-state, the installable
// closure, dependents and table lookups. One source of truth for both the
// mutations and the read side (marketplace's catalog).

import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { getEnabledModuleIds, isAlwaysOnModule, isModulePlacedIn } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import {
  tenantTablesFor as tenantTables,
  nonTenantTablesFor as nonTenantTables,
} from '@kuraykaraaslan-labs/common/server/module-entities';
import { Install } from './entities/install.entity';

/**
 * Module is installable iff it is known and not always on: neither protected infra nor placed `core`, which is never
 * switched per tenant (docs/phases/46-module-placement D46-1).
 */
export function isInstallableModule(id: string): boolean {
  return !isAlwaysOnModule(id) && !!moduleRegistry.getModule(id);
}

/**
 * Transitive `requires` closure of a module, restricted to feature modules that
 * are not always on: protected infra and core modules never need installing, and
 * their own requirements are not the installer's concern. Excludes the module itself.
 * The walk is the registry's — the activation store uses the same one without
 * the protected cut-off.
 */
export function resolveRequiresClosure(moduleId: string): string[] {
  return moduleRegistry.getRequiresClosure(moduleId, { stopAt: isAlwaysOnModule });
}

/**
 * The dependencies an install of `moduleId` switches on in `tenantId`. A platform tenant's module may require a module of
 * the other platform place for its code alone (docs/phases/46-module-placement): `fleet`'s root agent lanes import
 * `fleet_compliance`'s rules, but `fleet_compliance` is placed fleet and so is never on in ROOT, and the dispatcher serves a
 * route by its own module only. Such a dependency is left out for ROOT and the fleet tenant instead of refusing the
 * install. A customer tenant keeps every dependency, so one outside its placement still refuses the whole install.
 */
export function resolveInstallClosure(tenantId: string, moduleId: string): string[] {
  const closure = resolveRequiresClosure(moduleId);
  return isReservedTenant(tenantId) ? closure.filter((dep) => isModulePlacedIn(dep, tenantId)) : closure;
}

/**
 * Active modules whose requires-closure includes `moduleId`. Candidates are everything
 * installed OR enabled — default-on modules (blog, seo, dynamic_page) hold no ledger row until
 * someone touches them, yet blog really does require comments, and purging comments under it
 * would delete its data and leave blog running on a missing dependency. Protected and core
 * modules are never dependents here: they are always on, and counting them would make any
 * module they happen to require impossible to remove.
 */
export async function activeDependents(tenantId: string, moduleId: string): Promise<string[]> {
  const installed = await installedIds(tenantId);
  const enabled = await getEnabledModuleIds(tenantId);
  const candidates = new Set([...installed, ...enabled]);
  return [...candidates].filter(
    (id) => id !== moduleId && enabled.has(id) && !isAlwaysOnModule(id) && resolveRequiresClosure(id).includes(moduleId),
  );
}

export async function installedIds(tenantId: string): Promise<Set<string>> {
  const rows = await withTenantRepositoryFor(tenantId, Install, (repo) =>
    repo.find({ where: { tenantId, artifactType: 'module' }, select: ['artifactId'] }));
  return new Set(rows.map((r) => r.artifactId));
}

/** Tenant-owned tables (carry a tenantId column) for a module, for purge/preview. */
export function tenantTablesFor(moduleId: string): { tableName: string; schema: string }[] {
  return tenantTables(moduleId).map((e) => ({ tableName: e.tableName, schema: e.schema }));
}

/** Module tables that have NO tenantId column — cannot be auto-purged per tenant. */
export function nonTenantTablesFor(moduleId: string): string[] {
  return nonTenantTables(moduleId).map((e) => e.tableName);
}
