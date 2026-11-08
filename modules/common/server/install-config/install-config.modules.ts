import modulesSource, { file as modulesFile } from '../generated/install-config.modules';
import { moduleRegistry } from '../module-registry';
import { parseInstallModules, type ResolvedInstallModules } from './install-config.service';

// config/modules.ts at run time: the modules every tenant has and the ones the tenants' marketplace never lists. Read by
// tenant_setting's module activation (an included module is always on, like a core one) and by module_lifecycle's
// marketplace catalog and gate (a hidden module is neither listed to nor switched by a tenant).

const NONE: ResolvedInstallModules = { included: new Set(), hidden: new Set(), required: new Map(), warnings: [] };

let parsed: { modules: ResolvedInstallModules } | null = null;

/** A core module (D46-1) is on everywhere already: its requirements are not this file's concern. */
const isCore = (id: string) => moduleRegistry.getModule(id)?.placement === 'core';

/**
 * The validated config/modules.ts, empty sets without one. An invalid file throws InstallConfigError on every call
 * (nothing is cached until it parses), so a bad file fails loudly instead of quietly listing everything.
 */
export function installModules(): ResolvedInstallModules {
  parsed ??= {
    modules: parseInstallModules(
      modulesSource,
      moduleRegistry.getModules(),
      (id) => moduleRegistry.getRequiresClosure(id, { stopAt: isCore }),
      modulesFile,
    ) ?? NONE,
  };
  return parsed.modules;
}
