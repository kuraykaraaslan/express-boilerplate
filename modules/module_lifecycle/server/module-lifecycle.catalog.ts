// Read side of module lifecycle: every built-in module with this tenant's
// install + active state. Lives next to the writers because both answer from the
// `installs` ledger; the storefront (marketplace) renders it and owns none of it.

import {
  listModulesWithState,
  isModulePlacedIn,
  type ModuleState,
} from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Install } from './entities/install.entity';
import { listAvailability } from './module-lifecycle.availability';
import { listPolicies } from './module-lifecycle.policy';
import { checkEntitlement } from './module-lifecycle.entitlement';
import type { AvailabilityState, InstallOrigin } from './module-lifecycle.types';

export interface CatalogEntry extends ModuleState {
  /** An `installs` ledger row exists for this tenant (or the module is core/default-on). */
  installed: boolean;
  installedAt: string | null;
  installedVersion: string | null;
  /** Who installed it (06); 'tenant' for rows older than the column; null when there is no row. */
  origin: InstallOrigin | null;
  /** Platform-wide availability (03). */
  availability: AvailabilityState;
  /** The operator blocked it for this tenant (04). */
  blocked: boolean;
  /** A plan the tenant holds covers it (entitlement source 'plan'); null when the billing rail could not answer. */
  includedInPlan: boolean | null;
  /** Installed by a plan that still covers it: the tenant may deactivate it but not uninstall it (MG-7). */
  planLocked: boolean;
  /** Uninstalled, data kept: activating it before this time restores it (docs/phases/37-extensions/08). */
  restorableUntil: string | null;
}

/**
 * Catalog of the built-in modules with per-tenant install + active state.
 * Install state comes from the single `installs` ledger (one query); a module
 * additionally counts as `installed` when it is core/protected or currently
 * enabled — protected and default-on modules are installed out of the box and
 * only get a ledger row once someone actually touches them. The UI splits
 * Installed vs Available on this flag; install/uninstall/toggle remain gated
 * server-side (protected modules reject those operations).
 *
 * For a customer tenant (docs/phases/25-marketplace/03-module-governance) the
 * catalog never lists an operator-only module, and lists an unlisted, hidden,
 * retired or blocked module only once the tenant already has it — so it can still
 * see and switch off what it has. A module the installation includes in every
 * tenant or hides from them (config/modules.ts) is never listed to a customer: the
 * first is part of the product, the second is the operator's to give. The reserved
 * platform tenants see everything.
 */
export async function listCatalog(tenantId: string): Promise<CatalogEntry[]> {
  const operator = isReservedTenant(tenantId);
  const [states, installs, availability, policies] = await Promise.all([
    listModulesWithState(tenantId),
    withTenantRepositoryFor(tenantId, Install, (repo) => repo.find({ where: { tenantId, artifactType: 'module' } })),
    listAvailability(),
    operator ? Promise.resolve([]) : listPolicies(tenantId),
  ]);
  const byId = new Map(installs.map((i) => [i.artifactId, i]));
  const blocked = new Set(policies.filter((p) => p.policy === 'block').map((p) => p.moduleId));

  const entries = states
    // Only what may be on here (docs/phases/46-module-placement): ROOT sees its own and the business modules, the fleet
    // tenant the fleet and core ones, a customer never a root or fleet module.
    .filter((m) => isModulePlacedIn(m.id, tenantId))
    .filter((m) => operator || (!m.included && !m.marketplaceHidden))
    .map((m) => {
      const row = byId.get(m.id);
      return {
        ...m,
        installed: m.protected || m.enabled || (!!row && !row.uninstalledAt),
        installedAt: row ? row.installedAt.toISOString() : null,
        installedVersion: row ? row.version : null,
        origin: row ? (row.origin ?? 'tenant') : null,
        availability: availability.get(m.id)?.state ?? 'available',
        blocked: blocked.has(m.id),
        // Uninstalled but restorable with its data until this time (docs/phases/37-extensions/08).
        restorableUntil: row?.uninstalledAt && row.restorableUntil ? row.restorableUntil.toISOString() : null,
      };
    })
    .filter((m) => operator || m.installed || (m.availability === 'available' && !m.blocked));

  // "Included in your plan" — asked once per module, in parallel; the entitlement resolution is
  // cached per tenant (tenant_subscription), so this is cheap. A rail that cannot answer shows
  // as unknown here rather than failing the store.
  return Promise.all(entries.map(async (m): Promise<CatalogEntry> => {
    let includedInPlan: boolean | null = false;
    if (!m.protected) {
      try {
        const verdict = await checkEntitlement(tenantId, m.id);
        includedInPlan = verdict.entitled && verdict.source === 'plan';
      } catch {
        includedInPlan = null;
      }
    }
    return { ...m, includedInPlan, planLocked: m.origin === 'plan' && includedInPlan === true };
  }));
}
