import accessSource, { file as accessFile } from '../generated/install-config.access';
import { moduleRegistry } from '../module-registry';
import type { InstallAccess } from './install-config.define';
import { parseInstallAccess } from './install-config.service';
import type { InstallRoleLabels } from './install-config.roles';

// config/access.ts at run time (D45-4): per role, permission ids removed or granted. Read by auth_abac's permission
// decision (the API guard, the menu's granted set and the admin page guard all go through it), so a removed id closes
// the page and its API together.

let parsed: { access: InstallAccess | undefined } | null = null;

/**
 * The validated config/access.ts, `undefined` without one. An invalid file throws InstallConfigError on every call
 * (nothing is cached until it parses), so a bad file fails loudly instead of quietly granting nothing.
 */
export function installAccess(): InstallAccess | undefined {
  parsed ??= { access: parseInstallAccess(accessSource, moduleRegistry.getPermissions(), accessFile) };
  return parsed.access;
}

/** What config/access.ts says about one viewer: the ids removed from them, and the ids granted (never a removed one). */
export type InstallAccessVerdict = { removed: ReadonlySet<string>; granted: ReadonlySet<string> };

const NONE: InstallAccessVerdict = { removed: new Set(), granted: new Set() };

/**
 * The verdict for a viewer's install roles. A removal on any of their roles wins over a grant on another: the safer
 * reading when a role and a custom group disagree.
 */
export function installAccessVerdict(labels: InstallRoleLabels, access: InstallAccess | undefined = installAccess()): InstallAccessVerdict {
  if (!access) return NONE;
  const rules = [
    ...(labels.role ? [access.roles?.[labels.role]] : []),
    ...labels.customGroups.map((g) => (access.customGroups && Object.hasOwn(access.customGroups, g) ? access.customGroups[g] : undefined)),
  ];
  const removed = new Set<string>();
  const granted = new Set<string>();
  for (const rule of rules) {
    for (const id of rule?.remove ?? []) removed.add(id);
    for (const id of rule?.grant ?? []) granted.add(id);
  }
  if (!removed.size && !granted.size) return NONE;
  for (const id of removed) granted.delete(id);
  return { removed, granted };
}
