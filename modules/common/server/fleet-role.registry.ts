import { getFleetRoleProfile, type FleetRole } from './fleet-role.profile';

/**
 * What a role's generated runtime registry may carry (docs/phases/02-fleet Decision 2, compliance check `control_plane.no_business_routes`).
 *
 * The registry snapshot (`scripts/registry/roles.mjs`) cuts `module-runtime.json` to the modules of the build role and records the role
 * (`buildRole`) and every module's declared roles. On a role whose profile has no business modules (`fleet`), this judge reads that file
 * back and lists every piece of business surface still in it: a module that does not ship in the role, and any route, page, menu entry,
 * widget, slot, settings tab, permission, lifecycle hook, extension point or contribution (jobs and boot tasks are `common:boot_task`
 * contributions, websocket namespaces `websocket:namespace` ones) that belongs to such a module or targets a point no kept module hosts.
 *
 * Fail closed: a registry generated for another role, a module entry without roles (a registry older than the role cut) and an entry
 * naming a module the registry does not list all count as business surface.
 */

interface Owned { moduleId?: string; id?: string; path?: string; point?: string; slot?: string; event?: string }

export interface RoleRegistry {
  buildRole?: string;
  modules: readonly { id: string; roles?: readonly string[] }[];
  menu?: readonly Owned[];
  pageRoutes?: readonly Owned[];
  apiRoutes?: readonly Owned[];
  widgets?: readonly Owned[];
  slots?: readonly Owned[];
  settingsTabs?: readonly Owned[];
  permissions?: readonly Owned[];
  hooks?: readonly Owned[];
  extensionPoints?: readonly Owned[];
  extensions?: readonly Owned[];
  componentExtensions?: Readonly<Record<string, readonly Owned[]>>;
}

export type BusinessSurfaceKind =
  | 'build_role' | 'module' | 'menu' | 'page_route' | 'api_route' | 'widget' | 'slot' | 'settings_tab' | 'permission' | 'hook'
  | 'extension_point' | 'contribution';

export interface BusinessSurfaceFinding { kind: BusinessSurfaceKind; moduleId: string; ref: string }

const LISTS: readonly [BusinessSurfaceKind, keyof RoleRegistry, (e: Owned) => string][] = [
  ['menu', 'menu', (e) => String(e.id ?? e.path ?? '')],
  ['page_route', 'pageRoutes', (e) => String(e.path ?? '')],
  ['api_route', 'apiRoutes', (e) => String(e.path ?? '')],
  ['widget', 'widgets', (e) => String(e.id ?? '')],
  ['slot', 'slots', (e) => String(e.id ?? e.slot ?? '')],
  ['settings_tab', 'settingsTabs', (e) => String(e.id ?? '')],
  ['permission', 'permissions', (e) => String(e.id ?? '')],
  ['hook', 'hooks', (e) => String(e.id ?? e.event ?? '')],
  ['extension_point', 'extensionPoints', (e) => String(e.id ?? '')],
];

/** Every piece of surface in `registry` that a build of `role` must not carry (empty for a role whose profile has business modules). */
export function businessSurface(registry: RoleRegistry, role: FleetRole): BusinessSurfaceFinding[] {
  if (getFleetRoleProfile(role).businessModules) return [];
  const findings: BusinessSurfaceFinding[] = [];
  if (registry.buildRole !== role) findings.push({ kind: 'build_role', moduleId: '', ref: String(registry.buildRole ?? 'unset') });
  const inRole = new Set<string>();
  for (const m of registry.modules ?? []) {
    if (Array.isArray(m.roles) && m.roles.includes(role)) inRole.add(m.id);
    else findings.push({ kind: 'module', moduleId: m.id, ref: m.id });
  }
  const outside = (moduleId: string | undefined) => !moduleId || !inRole.has(moduleId);
  for (const [kind, key, ref] of LISTS) {
    for (const e of (registry[key] as readonly Owned[] | undefined) ?? []) {
      if (outside(e.moduleId)) findings.push({ kind, moduleId: String(e.moduleId ?? ''), ref: ref(e) });
    }
  }
  const hosted = new Set((registry.extensionPoints ?? []).filter((p) => !outside(p.moduleId)).map((p) => String(p.id)));
  const contributions = [...(registry.extensions ?? []), ...Object.values(registry.componentExtensions ?? {}).flat()];
  for (const e of contributions) {
    if (outside(e.moduleId) || !hosted.has(String(e.point))) findings.push({ kind: 'contribution', moduleId: String(e.moduleId ?? ''), ref: String(e.id ?? e.point ?? '') });
  }
  return findings;
}

export interface NoBusinessRoutesVerdict {
  status: 'PASS' | 'FAIL';
  details: { role: FleetRole; buildRole: string; modules: number; findings: number; byKind: Partial<Record<BusinessSurfaceKind, number>>; sample: BusinessSurfaceFinding[] };
}

/** At most this many findings are named in a verdict (a wrong-role registry would otherwise list thousands). */
const SAMPLE = 20;

/** `control_plane.no_business_routes` over `registry` for `role`: PASS when it carries no business surface. */
export function judgeNoBusinessRoutes(registry: RoleRegistry, role: FleetRole): NoBusinessRoutesVerdict {
  const findings = businessSurface(registry, role);
  const byKind: Partial<Record<BusinessSurfaceKind, number>> = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  return {
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    details: { role, buildRole: String(registry.buildRole ?? 'unset'), modules: registry.modules?.length ?? 0, findings: findings.length, byKind, sample: findings.slice(0, SAMPLE) },
  };
}

/** The runtime registry this process was built with (loaded on demand: it is large, and pure callers pass their own). */
export async function loadCurrentRegistry(): Promise<RoleRegistry> {
  const mod = await import('./generated/module-runtime.json');
  return ((mod as { default?: unknown }).default ?? mod) as RoleRegistry;
}
