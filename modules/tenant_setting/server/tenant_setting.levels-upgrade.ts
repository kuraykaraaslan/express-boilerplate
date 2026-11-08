// Setting levels on an existing installation (docs/phases/53-setting-levels, 53.7, D167). Before phase 53 every provider key
// fell back to the root tenant's key by key, and a tenant's own installed plugin providers (AI, enrichment, …) were the only
// ones it had. The new default is `platform` for every selectable module, so on the first deploy:
//   - a tenant that configured its own keys or providers stops using them: the upgrade pins it to `tenant_first` (`pin`);
//   - a tenant left on the platform is served by the root tenant's installed plugin providers, which it never had before, and
//     its use of them counts against its plan (`platform_serves`, the operator's new cost);
//   - at a `tenant` level the operator chose, a tenant without its own configuration loses a module that ran on the root
//     tenant's keys before (`loses`).
// Pure: scripts/setting-levels-upgrade.mts gathers the facts and writes the pins.

import type { SettingLevelView } from './tenant_setting.read.service';

/** What the root tenant itself provides for each selectable module. */
export interface RootLevelFacts {
  /** Whether ROOT set any key of the module's group. */
  group: Record<string, boolean>;
  /** ROOT's installed providers with their credentials set, for the module's plugin points. */
  providers: Record<string, string[]>;
}

/** One tenant: its resolved levels (getSettingLevelsView) and its own configured providers per module. */
export interface TenantLevelFacts {
  tenantId: string;
  name: string;
  levels: Record<string, SettingLevelView>;
  ownProviders: Record<string, string[]>;
}

export type SettingLevelsUpgradeFinding =
  | { kind: 'pin'; tenantId: string; name: string; moduleId: string; ownKeys: boolean; ownProviders: string[] }
  | { kind: 'platform_serves'; tenantId: string; name: string; moduleId: string; providers: string[] }
  | { kind: 'loses'; tenantId: string; name: string; moduleId: string };

/**
 * What the levels change for each tenant, assuming the pins are applied. A level the operator set for one tenant is its
 * choice and is never pinned over; an installation choice or the module's default is.
 */
export function planSettingLevelsUpgrade(root: RootLevelFacts, tenants: TenantLevelFacts[]): SettingLevelsUpgradeFinding[] {
  const out: SettingLevelsUpgradeFinding[] = [];
  for (const t of tenants) {
    for (const [moduleId, view] of Object.entries(t.levels)) {
      const ownProviders = t.ownProviders[moduleId] ?? [];
      const hasOwn = view.ownGroup || ownProviders.length > 0;
      const base = { tenantId: t.tenantId, name: t.name, moduleId };
      if (view.level === 'platform' && view.source !== 'override' && hasOwn) {
        out.push({ kind: 'pin', ...base, ownKeys: view.ownGroup, ownProviders });
        continue;
      }
      const servedByRoot = view.level === 'platform' || (view.level === 'tenant_first' && !hasOwn);
      const rootProviders = root.providers[moduleId] ?? [];
      if (servedByRoot && rootProviders.length > 0) out.push({ kind: 'platform_serves', ...base, providers: rootProviders });
      if (view.level === 'tenant' && !hasOwn && root.group[moduleId]) out.push({ kind: 'loses', ...base });
    }
  }
  return out;
}
