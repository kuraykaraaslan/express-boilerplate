import type { z } from 'zod';
import {
  INSTALL_ROLES,
  type InstallAccess,
  type InstallAccessRule,
  type InstallBrand,
  type InstallMenu,
  type InstallModules,
} from './install-config.define';
import { InstallAccessSchema, InstallBrandSchema, InstallMenuSchema, InstallModulesSchema } from './install-config.dto';

// ── Install config: parsing and validation ───────────────────────────────────
// Pure: a config file's default export in, the typed value out, or an InstallConfigError that names the file and the
// path of every problem. The runtime accessors (install-config.brand/.menu/.access) and `npm run config:check` both
// call these, so the boot and the build refuse the same files.

/** One or more problems in the installation's config files. Thrown at boot and by config:check, never swallowed. */
export class InstallConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`[install-config] the installation's config is invalid:\n  ${problems.join('\n  ')}`);
    this.name = 'InstallConfigError';
  }
}

/** A permission of the catalog, as far as the access checks need it (module-registry RuntimePermission). */
export type CatalogPermission = { id: string; minRole?: string; scope?: string };

type Issue = { path: PropertyKey[]; message: string; code?: string; errors?: Issue[][] };

/**
 * One line per problem. A union (`workspaces: 'single' | { ... }`) reports the branch that got furthest into the value,
 * so a bad icon reads `workspaces.iot.icon: ...`, not `workspaces: Invalid input`.
 */
function flattenIssues(issues: Issue[], prefix: PropertyKey[] = []): Array<{ path: PropertyKey[]; message: string }> {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === 'invalid_union' && issue.errors?.length) {
      const depth = (branch: Issue[]) => Math.max(0, ...branch.map((i) => i.path.length));
      const best = issue.errors.reduce((a, b) => (depth(b) > depth(a) ? b : a));
      if (depth(best) > 0) return flattenIssues(best, path);
    }
    return [{ path, message: issue.message }];
  });
}

function formatIssues(file: string, error: z.ZodError): string[] {
  return flattenIssues(error.issues as Issue[]).map(({ path, message }) => `${file}: ${path.length ? path.map(String).join('.') : '(file)'}: ${message}`);
}

/**
 * The file's value when an ES module script run by tsx imports the shim (a `.mts` such as the e2e loader): the config file is
 * compiled as CommonJS there, so the default import is the module object `{ default: value }` and not the value. No config
 * shape has a `default` key, so an object holding only that key is always this wrapper.
 */
function unwrapDefault(source: unknown): unknown {
  if (source && typeof source === 'object' && Object.keys(source).length === 1 && Object.hasOwn(source, 'default')) {
    return (source as { default: unknown }).default;
  }
  return source;
}

/** A config file's default export, or undefined when the installation has no such file. */
function parseFile<T>(file: string, raw: unknown, schema: z.ZodType<T>, define: string): T | undefined {
  const source = unwrapDefault(raw);
  if (source === undefined) return undefined;
  if (source === null || typeof source !== 'object') {
    throw new InstallConfigError([`${file}: (file): expected \`export default ${define}({ ... })\``]);
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new InstallConfigError(formatIssues(file, parsed.error));
  return parsed.data;
}

export function parseInstallBrand(source: unknown, file = 'config/brand.ts'): InstallBrand | undefined {
  return parseFile(file, source, InstallBrandSchema, 'defineBrand');
}

export function parseInstallMenu(source: unknown, file = 'config/menu.ts'): InstallMenu | undefined {
  return parseFile(file, source, InstallMenuSchema as z.ZodType<InstallMenu>, 'defineMenu');
}

/**
 * config/access.ts, checked against the permission catalog: every id must exist (a misspelled removal would leave a
 * page open without a word), a rule may not both remove and grant one id, and an OWNER-floor permission cannot be
 * granted below owner (the floor a custom group cannot lift either, auth_abac group-floor).
 */
export function parseInstallAccess(source: unknown, catalog: CatalogPermission[], file = 'config/access.ts'): InstallAccess | undefined {
  const access = parseFile(file, source, InstallAccessSchema as z.ZodType<InstallAccess>, 'defineAccess');
  if (!access) return undefined;
  const floors = new Map(catalog.map((p) => [p.id, p.minRole ?? 'ADMIN']));
  // An account permission is checked outside any tenant (the ACCOUNT scope), where the caller is `user` or `sysadmin`
  // by their platform role: a rule of a tenant role or a custom group could never reach its API, only its page.
  const account = new Set(catalog.filter((p) => p.scope === 'account').map((p) => p.id));
  const problems: string[] = [];
  const check = (where: string, rule: InstallAccessRule, ownerOrAbove: boolean, tenantRole: boolean) => {
    const removed = new Set(rule.remove ?? []);
    for (const [list, ids] of [['remove', rule.remove ?? []], ['grant', rule.grant ?? []]] as const) {
      ids.forEach((id, i) => {
        const at = `${file}: ${where}.${list}.${i}`;
        if (!floors.has(id)) problems.push(`${at}: '${id}' is not a permission of any installed module`);
        else if (tenantRole && account.has(id)) {
          problems.push(`${at}: '${id}' is an account permission, decided outside any tenant: name it under roles.user or roles.sysadmin`);
        } else if (list === 'grant' && removed.has(id)) problems.push(`${at}: '${id}' is both removed and granted`);
        else if (list === 'grant' && !ownerOrAbove && floors.get(id) === 'OWNER') {
          problems.push(`${at}: '${id}' has the OWNER floor and cannot be granted below owner`);
        }
      });
    }
  };
  for (const role of INSTALL_ROLES) {
    const rule = access.roles?.[role];
    if (rule) check(`roles.${role}`, rule, role === 'owner' || role === 'sysadmin', role === 'owner' || role === 'admin');
  }
  for (const [group, rule] of Object.entries(access.customGroups ?? {})) check(`customGroups.${group}`, rule, false, true);
  if (problems.length) throw new InstallConfigError(problems);
  return access;
}

/** Every grant of config/access.ts, one line each (`admin: +blog.posts.delete`), for the boot listing and its audit row. */
export function describeInstallAccess(access: InstallAccess | undefined): { grants: string[]; removals: string[] } {
  const grants: string[] = [];
  const removals: string[] = [];
  const add = (who: string, rule: InstallAccessRule | undefined) => {
    for (const id of rule?.grant ?? []) grants.push(`${who}: +${id}`);
    for (const id of rule?.remove ?? []) removals.push(`${who}: -${id}`);
  };
  for (const role of INSTALL_ROLES) add(role, access?.roles?.[role]);
  for (const [group, rule] of Object.entries(access?.customGroups ?? {})) add(`group ${group}`, rule);
  return { grants, removals };
}

/** A module of the registry, as far as the modules checks need it: its id and the places it may be on (D46-1). */
export type CatalogModule = { id: string; places?: readonly string[] };

/** config/modules.ts resolved against the installed modules. */
export type ResolvedInstallModules = {
  /** On in every tenant: the listed modules and every module they require. */
  included: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  /** The modules on in every tenant only because an included module requires them, each with the listed ones that do. */
  required: ReadonlyMap<string, readonly string[]>;
  /** Hidden ids this build does not carry (an edition or `NB_DISABLED_MODULES` leaves them out): nothing to hide, or a typo. */
  warnings: readonly string[];
};

/**
 * config/modules.ts, checked against the installed modules: an included id must be one, none may be listed twice or in
 * both lists, none placed for the platform only (it never reaches a customer tenant), no included module may require such
 * a module, and no hidden module may come with every tenant anyway. A hidden id this build does not carry is a warning,
 * not an error: an edition or `NB_DISABLED_MODULES` leaves modules out, and hiding one of them is harmless (a typo then
 * shows in config:check and in the boot log). `requiresOf` is the registry's requires closure; core modules may be left
 * out of it.
 */
export function parseInstallModules(
  source: unknown,
  catalog: readonly CatalogModule[],
  requiresOf: (id: string) => readonly string[],
  file = 'config/modules.ts',
): ResolvedInstallModules | undefined {
  const modules = parseFile(file, source, InstallModulesSchema as z.ZodType<InstallModules>, 'defineModules');
  if (!modules) return undefined;
  const places = new Map(catalog.map((m) => [m.id, m.places ?? []]));
  const forCustomers = (id: string) => (places.get(id) ?? []).includes('tenant');
  const problems: string[] = [];
  const warnings: string[] = [];
  const included = new Set(modules.included ?? []);
  const required = new Map<string, string[]>();
  for (const [list, ids] of [['included', modules.included ?? []], ['hidden', modules.hidden ?? []]] as const) {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      const at = `${file}: ${list}.${i}`;
      if (!places.has(id)) {
        if (list === 'included') problems.push(`${at}: '${id}' is not an installed module`);
        else warnings.push(`${at}: '${id}' is not in this build: nothing to hide (an edition or NB_DISABLED_MODULES leaves it out, or a typo)`);
      } else if (seen.has(id)) problems.push(`${at}: '${id}' is listed twice`);
      else if (!forCustomers(id)) problems.push(`${at}: '${id}' is placed for the platform only and never reaches a customer tenant`);
      else if (list === 'hidden' && included.has(id)) problems.push(`${at}: '${id}' is also included`);
      seen.add(id);
    });
  }
  (modules.included ?? []).forEach((id, i) => {
    if (!places.has(id) || !forCustomers(id)) return;
    for (const dep of requiresOf(id)) {
      if (!places.has(dep)) continue;
      if (!forCustomers(dep)) problems.push(`${file}: included.${i}: '${id}' requires '${dep}', which no customer tenant can have`);
      else if (!included.has(dep)) required.set(dep, [...(required.get(dep) ?? []), id]);
    }
  });
  (modules.hidden ?? []).forEach((id, i) => {
    const by = required.get(id);
    if (by) problems.push(`${file}: hidden.${i}: '${id}' comes with every tenant: ${by.join(', ')} ${by.length > 1 ? 'require' : 'requires'} it`);
  });
  if (problems.length) throw new InstallConfigError(problems);
  return { included: new Set([...included, ...required.keys()]), hidden: new Set(modules.hidden ?? []), required, warnings };
}

/** config/modules.ts in a few lines (`included: a, b`; `also on, required by them: c (by a)`), for config:check and the boot log. */
export function describeInstallModules(modules: ResolvedInstallModules | undefined): string[] {
  if (!modules) return [];
  const listed = [...modules.included].filter((id) => !modules.required.has(id));
  const lines: string[] = [];
  if (listed.length) lines.push(`included in every tenant: ${listed.join(', ')}`);
  if (modules.required.size) {
    lines.push(`also on in every tenant, required by them: ${[...modules.required].map(([id, by]) => `${id} (by ${by.join(', ')})`).join(', ')}`);
  }
  if (modules.hidden.size) lines.push(`hidden from the tenants' marketplace: ${[...modules.hidden].join(', ')}`);
  return lines;
}
