import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { normalizeIconName } from '@kuraykaraaslan-labs/common/ui/icon-map';
import {
  ALWAYS_ON_GROUPS, FALLBACK_WORKSPACE, WORKSPACES, groupSlug, resolveWorkspaceId,
} from '@kuraykaraaslan-labs/app_shell/ui/workspaces.config';
import { checkMenuNames, type MenuNameCatalog } from '@kuraykaraaslan-labs/app_shell/ui/shell-profile';
import type { InstallMenu } from '@kuraykaraaslan-labs/common/server/install-config/install-config.define';
import ShellMenuLabelsService, { type EditorLanguage, type TextsByKey } from './shell_menu.labels.service';
import { linkTargetProviders } from './shell_menu.links';
import { isSolidIcon } from './shell_menu.icons';
import { linkRef } from './shell_menu.keys';
import type { MenuSpec } from './shell_menu.schema';

// What the editor works from (docs/phases/54-menu-editor, 03): every menu entry of this build whatever the modules'
// state, the workspaces and groups, the admin pages a page link may name, the link kinds, the languages and what the
// built-in keys say in each.

export type CatalogItem = {
  id: string;
  moduleId: string;
  href: string;
  /** The manifest's English label and the key the sidebar translates it by. */
  label: string;
  key: string;
  icon?: string;
  group: string;
  workspace: string;
  order: number;
  scope: string;
  permissions: string[];
  /** The lowest built-in role that holds each permission by default (`ADMIN` when the manifest says nothing). */
  floors: Record<string, string>;
  /** A base item of the shell (Home, My Profile): only label and hidden apply. */
  base?: boolean;
};

export type CatalogWorkspace = { id: string; label: string; key: string; icon: string; order: number };
export type CatalogGroup = { key: string; label: string; textKey: string; workspace: string; alwaysOn: boolean };
export type CatalogPage = { path: string; moduleId: string; guard: string[] };
export type CatalogLinkKind = { kind: string; label: string };

export type MenuCatalog = {
  items: CatalogItem[];
  workspaces: CatalogWorkspace[];
  groups: CatalogGroup[];
  pages: CatalogPage[];
  linkKinds: CatalogLinkKind[];
  languages: EditorLanguage[];
  /** Built-in key → language → text (the dictionaries with the stored texts over them). */
  texts: TextsByKey;
};

const BASE_ITEMS: CatalogItem[] = [
  { id: 'dashboard', moduleId: 'app_shell', href: '/admin', label: 'Home', key: 'app_shell.adminNav.dashboard', icon: 'fas fa-house', group: 'Overview', workspace: 'home', order: 0, scope: 'both', permissions: [], floors: {}, base: true },
  { id: 'me', moduleId: 'app_shell', href: '/admin/me', label: 'My Profile', key: 'app_shell.adminNav.myProfile', icon: 'fas fa-circle-user', group: 'Account', workspace: 'home', order: 0, scope: 'both', permissions: [], floors: {}, base: true },
];

const iconName = (def: { iconName: string }) => `fas fa-${def.iconName}`;

/** The registry's menu items as the editor lists them (every module of this build, any state, any placement). */
export function catalogItems(): CatalogItem[] {
  const floors = new Map(moduleRegistry.getPermissions().map((p) => [p.id, (p as { minRole?: string }).minRole ?? 'ADMIN']));
  const items = moduleRegistry.getMenuItems({}).map((it): CatalogItem => ({
    id: it.id,
    moduleId: it.moduleId,
    href: it.href,
    label: it.label,
    key: `${it.moduleId}.menu.${it.id}`,
    ...(it.icon ? { icon: it.icon } : {}),
    group: it.group ?? 'Plugins',
    workspace: resolveWorkspaceId(it),
    order: it.order,
    scope: it.scope,
    permissions: it.permissions,
    floors: Object.fromEntries(it.permissions.map((p) => [p, floors.get(p) ?? 'ADMIN'])),
  }));
  return [...BASE_ITEMS, ...items];
}

export function catalogWorkspaces(): CatalogWorkspace[] {
  return [...WORKSPACES, FALLBACK_WORKSPACE].map((w) => ({ id: w.id, label: w.label, key: `app_shell.workspace.${w.id}`, icon: iconName(w.icon), order: w.order }));
}

export function catalogGroups(items: CatalogItem[]): CatalogGroup[] {
  const seen = new Map<string, CatalogGroup>();
  for (const it of items) {
    if (seen.has(it.group)) continue;
    seen.set(it.group, { key: it.group, label: it.group, textKey: `app_shell.group.${groupSlug(it.group)}`, workspace: it.workspace, alwaysOn: ALWAYS_ON_GROUPS.includes(it.group) });
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function catalogPages(): CatalogPage[] {
  return moduleRegistry.getPageRoutes()
    .filter((r) => r.path.startsWith('/admin') && r.guard?.length && !r.path.includes('['))
    .map((r) => ({ path: r.path, moduleId: r.moduleId, guard: r.guard ?? [] }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The menu-name check of config/menu.ts, over a stored spec: unknown workspaces are errors, unknown items and groups warnings. */
export function checkSpecNames(spec: MenuSpec, items: CatalogItem[] = catalogItems()): { errors: string[]; warnings: string[] } {
  const names: MenuNameCatalog = {
    items: [
      ...items.map((i) => ({ id: i.id, href: i.href, group: i.group })),
      ...Object.entries(spec.links ?? {}).map(([id, l]) => ({ id: linkRef(id), href: linkRef(id), ...(l.group ? { group: l.group } : {}) })),
    ],
  };
  // Groups a layer creates (a `groups` entry with a label, or an item or link moved into a new group) are names of the menu.
  const created = new Set<string>(Object.keys(spec.groups ?? {}));
  const { errors, warnings } = checkMenuNames(spec as unknown as InstallMenu, names, 'menu');
  const kept = warnings.filter((w) => {
    const m = /groups\.(.+): no menu group/.exec(w);
    return !(m && created.has(m[1]));
  });
  const workspaceIds = new Set([...WORKSPACES.map((w) => w.id), FALLBACK_WORKSPACE.id,
    ...(spec.workspaces && spec.workspaces !== 'single' ? Object.keys(spec.workspaces) : [])]);
  for (const [id, link] of Object.entries(spec.links ?? {})) {
    if (link.workspace && !workspaceIds.has(link.workspace)) errors.push(`menu: links.${id}.workspace: workspace '${link.workspace}' is not built in and not added`);
  }
  if (spec.workspaces && spec.workspaces !== 'single') {
    for (const [id, o] of Object.entries(spec.workspaces)) {
      if (o.icon && !isSolidIcon(o.icon)) errors.push(`menu: workspaces.${id}.icon: no icon is called '${normalizeIconName(o.icon)}'`);
    }
  }
  for (const [id, link] of Object.entries(spec.links ?? {})) {
    if (link.icon && !isSolidIcon(link.icon)) errors.push(`menu: links.${id}.icon: no icon is called '${normalizeIconName(link.icon)}'`);
  }
  return { errors, warnings: kept };
}

/** Contributed link targets checked by their contributor; an unknown kind is a warning (its module may be off). */
export async function checkLinkTargets(spec: MenuSpec): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contributed = Object.entries(spec.links ?? {}).filter(([, l]) => l.kind !== 'page' && l.kind !== 'url');
  if (!contributed.length) return { errors, warnings };
  const providers = await linkTargetProviders();
  for (const [id, link] of contributed) {
    const provider = providers.get(link.kind);
    if (!provider) { warnings.push(`menu: links.${id}: no module offers the link kind '${link.kind}' now`); continue; }
    const problem = provider.validate(link.target);
    if (problem) errors.push(`menu: links.${id}.target: ${problem}`);
  }
  return { errors, warnings };
}

export default class ShellMenuCatalogService {
  static async catalog(): Promise<MenuCatalog> {
    const items = catalogItems();
    const workspaces = catalogWorkspaces();
    const groups = catalogGroups(items);
    const [languages, providers] = await Promise.all([ShellMenuLabelsService.languages(), linkTargetProviders()]);
    const keys = [...items.map((i) => i.key), ...workspaces.map((w) => w.key), ...groups.map((g) => g.textKey)];
    const texts = await ShellMenuLabelsService.builtInTexts(keys, languages.map((l) => l.code));
    return {
      items,
      workspaces,
      groups,
      pages: catalogPages(),
      linkKinds: [{ kind: 'page', label: 'Admin page' }, { kind: 'url', label: 'Outside address' },
        ...[...providers.values()].map((p) => ({ kind: p.kind, label: p.label }))],
      languages,
      texts,
    };
  }
}
