import type {
  InstallMenu,
  InstallMenuLayer,
  MenuGroupOverride,
  MenuItemOverride,
  MenuLabel,
  MenuWorkspaceOverride,
} from '@kuraykaraaslan-labs/common/server/install-config/install-config.define';
import type { InstallRoleLabels } from '@kuraykaraaslan-labs/common/server/install-config/install-config.roles';
import { ALWAYS_ON_GROUPS, FALLBACK_WORKSPACE, WORKSPACES, resolveWorkspaceId, type WorkspaceDef } from './workspaces.config';

// ── Shell profile ────────────────────────────────────────────────────────────
// The application's own shape of the admin sidebar, as plain data. The
// vendor catalog (workspaces.config.ts) and every module's manifest stay the
// DEFAULTS; a profile only says what this application changes. It lives in the
// application (`app/shell.profile.ts`), so a customer's developer edits one file
// that no vendor update touches.
//
// A profile can only reshape what the caller is already allowed to see. It is
// applied AFTER the registry has filtered items by module activation and by the
// caller's permissions, so it can hide, rename, regroup and reorder, but it can
// never reveal an item the registry dropped, and it has no permission field.
//
// Plain data on purpose: the layout (a server component) hands it to client
// components, so no functions.
//
// Per role: config/menu.ts adds layers over this file for each role and custom
// group (resolveRoleShellProfile below). Who may open a page is config/access.ts
// and the admin page guard, never this file.

// The override shapes are the install config's menu layer (docs/phases/45-install-config D45-3): `app/shell.profile.ts`
// is one layer of config/menu.ts with no role, so both files speak the same words.
export type ShellItemOverride = MenuItemOverride;
export type ShellWorkspaceOverride = MenuWorkspaceOverride;
export type ShellGroupOverride = MenuGroupOverride;

/**
 * A custom menu link (docs/phases/54-menu-editor, 09), already resolved for one viewer by the layout: shown to them,
 * labelled in their language. `href` is tenant-relative (`/admin/…`) for a page, an absolute https address when
 * `external`. In the sidebar it is the item `link:<id>`, so a layer can hide, move or reorder it like any item.
 */
export type ShellLink = {
  id: string;
  label: string;
  href: string;
  external: boolean;
  icon?: string;
  group?: string;
  workspace?: string;
  order: number;
};

export type ShellProfile = InstallMenuLayer & {
  /** Custom links for this viewer (the stored menu of shell_menu); absent without any. */
  links?: ShellLink[];
};

export const EMPTY_SHELL_PROFILE: ShellProfile = {};

/** The fields of a menu item the profile reads. Structural, so registry items and test fixtures both fit. */
export type ProfileMenuItem = { id: string; href: string; order: number; group?: string; workspace?: string };

// Own keys only: an id or group named 'constructor' must not pick up an Object.prototype member.
function own<T>(record: Record<string, T> | undefined, key: string | undefined): T | undefined {
  return record && key !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * The text of a menu label in `locale`: a single text as written, else the label's own language, its primary subtag
 * (`pt` for `pt-BR`), English, then the first one given (e2e run 1, V2-L3: config labels such as 'Flows' could not be
 * translated). Undefined when there is no label.
 */
export function menuLabelText(label: MenuLabel | undefined, locale = 'en'): string | undefined {
  if (label === undefined || typeof label === 'string') return label;
  const base = locale.toLowerCase().split('-')[0];
  const own = Object.entries(label);
  return (own.find(([k]) => k.toLowerCase() === locale.toLowerCase())
    ?? own.find(([k]) => k.toLowerCase() === base)
    ?? own.find(([k]) => k.toLowerCase() === 'en')
    ?? own[0])?.[1];
}

function localizeRecord<T extends { label?: MenuLabel }>(record: Record<string, T> | undefined, locale: string): Record<string, T> | undefined {
  if (!record) return record;
  return Object.fromEntries(Object.entries(record).map(([key, o]) => [key, o.label === undefined ? o : { ...o, label: menuLabelText(o.label, locale) }]));
}

/**
 * The profile with every label turned into the text of `locale`, so what reaches the client shell is plain text. Done
 * once per request by the layout, for the viewer's language.
 */
export function localizeShellProfile(profile: ShellProfile, locale: string): ShellProfile {
  const workspaces = profile.workspaces === 'single' ? 'single' : localizeRecord(profile.workspaces, locale);
  const groups = localizeRecord(profile.groups, locale);
  const items = localizeRecord(profile.items, locale);
  return { ...(workspaces !== undefined ? { workspaces } : {}), ...(groups ? { groups } : {}), ...(items ? { items } : {}) };
}

export function isSingleWorkspace(profile: ShellProfile | undefined): boolean {
  return profile?.workspaces === 'single';
}

export function itemOverride(profile: ShellProfile | undefined, item: { id: string; href: string }): ShellItemOverride | undefined {
  return own(profile?.items, item.id) ?? own(profile?.items, item.href);
}

/** The workspace ids a profile hides (`hidden: true`); none in single mode. */
function hiddenWorkspaces(profile: ShellProfile | undefined): Set<string> {
  const spec = profile?.workspaces;
  if (!spec || spec === 'single') return new Set();
  return new Set(Object.entries(spec).filter(([, o]) => o.hidden).map(([id]) => id));
}

/**
 * Hide, regroup, move and reorder registry menu items. Returns the input untouched without a profile.
 * Sorted like the registry (`order`, then id) so an `order` override takes effect. An item whose workspace the profile
 * hides is dropped with it.
 */
export function applyShellProfile<T extends ProfileMenuItem>(items: T[], profile: ShellProfile | undefined): T[] {
  const hidden = hiddenWorkspaces(profile);
  if (!profile || (!profile.items && !profile.groups && !hidden.size)) return items;
  const out: T[] = [];
  for (const it of items) {
    const o = itemOverride(profile, it);
    if (o?.hidden) continue;
    const group = o?.group ?? it.group;
    const workspace = o?.workspace ?? own(profile.groups, group)?.workspace ?? it.workspace;
    if (hidden.size && !(group && ALWAYS_ON_GROUPS.includes(group)) && hidden.has(resolveWorkspaceId({ workspace, group }))) continue;
    out.push({ ...it, group, workspace, order: o?.order ?? it.order });
  }
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * The workspace catalog for this profile: the built-ins with overrides, plus any new workspace the profile adds,
 * sorted by `order`, without the hidden ones. Empty in single mode (no workspaces means every group shows and no
 * switcher renders).
 */
export function shellWorkspaces(profile: ShellProfile | undefined): WorkspaceDef[] {
  const spec = profile?.workspaces;
  if (spec === 'single') return [];
  if (!spec) return WORKSPACES;
  const defs: WorkspaceDef[] = WORKSPACES.map((w) => {
    const o = own(spec, w.id);
    const label = menuLabelText(o?.label);
    return o ? { ...w, label: label ?? w.label, icon: o.icon ?? w.icon, order: o.order ?? w.order, literalLabel: label !== undefined } : w;
  });
  for (const [id, o] of Object.entries(spec)) {
    const label = menuLabelText(o.label);
    if (WORKSPACES.some((w) => w.id === id) || !label || !o.icon) continue;
    defs.push({ id, label, icon: o.icon, order: o.order ?? 100, literalLabel: true });
  }
  return defs.filter((w) => !own(spec, w.id)?.hidden).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// ── Per role (config/menu.ts, docs/phases/45-install-config D45-3) ────────────

/** Field-wise merge of two override records: a later layer wins per field, the fields it does not name stay. */
function mergeRecord<T extends object>(a: Record<string, T> | undefined, b: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!b) return a;
  const out: Record<string, T> = { ...(a ?? {}) };
  for (const [key, value] of Object.entries(b)) out[key] = { ...(own(out, key) ?? {}), ...value } as T;
  return out;
}

/**
 * Layers merged in order, a later one winning field by field. `workspaces: 'single'` replaces what came before; an
 * object after it starts again from the built-in catalog.
 */
export function mergeShellProfiles(...layers: Array<ShellProfile | undefined>): ShellProfile {
  let out: ShellProfile = {};
  for (const layer of layers) {
    if (!layer) continue;
    const workspaces = layer.workspaces === undefined ? out.workspaces
      : layer.workspaces === 'single' ? 'single'
        : mergeRecord(out.workspaces === 'single' ? undefined : out.workspaces, layer.workspaces);
    const groups = mergeRecord(out.groups, layer.groups);
    const items = mergeRecord(out.items, layer.items);
    out = { ...(workspaces !== undefined ? { workspaces } : {}), ...(groups ? { groups } : {}), ...(items ? { items } : {}) };
  }
  return out;
}

/**
 * The sidebar profile one viewer gets: `app/shell.profile.ts` (all roles), then config/menu.ts's all-roles layer, its
 * layer for the viewer's built-in role, and the layer of each custom group the viewer holds, in the order config/menu.ts
 * lists them. Plain data, handed to the client shell.
 */
export function resolveRoleShellProfile(base: ShellProfile | undefined, menu: InstallMenu | undefined, labels: InstallRoleLabels): ShellProfile {
  if (!menu) return base ?? EMPTY_SHELL_PROFILE;
  const { roles, customGroups, ...allRoles } = menu;
  const held = new Set(labels.customGroups);
  return mergeShellProfiles(
    base,
    allRoles,
    labels.role ? roles?.[labels.role] : undefined,
    ...Object.entries(customGroups ?? {}).filter(([key]) => held.has(key)).map(([, layer]) => layer),
  );
}

/** What config/menu.ts may name: the menu items (id and href) and groups of the registry, plus the shell's own two. */
export type MenuNameCatalog = { items: Array<{ id: string; href: string; group?: string }> };

const BASE_ITEM_NAMES = ['dashboard', 'me', '/admin', '/admin/me'];

/**
 * The names config/menu.ts (and app/shell.profile.ts) use, checked against the shell. `errors`: a workspace id that is
 * neither built in nor added with a label and an icon somewhere in the file (its items would vanish from the sidebar).
 * `warnings`: an item or group key no current menu entry has (a typo, or a module this build leaves out).
 */
export function checkMenuNames(menu: InstallMenu | undefined, catalog: MenuNameCatalog, file = 'config/menu.ts'): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!menu) return { errors, warnings };
  const { roles, customGroups, ...allRoles } = menu;
  const layers: Array<[string, ShellProfile]> = [
    ['', allRoles],
    ...Object.entries(roles ?? {}).filter(([, l]) => l).map(([r, l]) => [`roles.${r}.`, l as ShellProfile] as [string, ShellProfile]),
    ...Object.entries(customGroups ?? {}).map(([g, l]) => [`customGroups.${g}.`, l] as [string, ShellProfile]),
  ];
  const known = new Set<string>([...WORKSPACES.map((w) => w.id), FALLBACK_WORKSPACE.id]);
  for (const [, layer] of layers) {
    if (layer.workspaces && layer.workspaces !== 'single') {
      for (const [id, o] of Object.entries(layer.workspaces)) if (o.label && o.icon) known.add(id);
    }
  }
  const itemKeys = new Set<string>([...BASE_ITEM_NAMES, ...catalog.items.flatMap((i) => [i.id, i.href])]);
  const groupKeys = new Set<string>([...ALWAYS_ON_GROUPS, ...catalog.items.flatMap((i) => (i.group ? [i.group] : []))]);
  const workspaceRef = (at: string, id: string | undefined) => {
    if (id !== undefined && !known.has(id)) errors.push(`${file}: ${at}: workspace '${id}' is not built in and no layer adds it with a label and an icon`);
  };
  for (const [prefix, layer] of layers) {
    if (layer.workspaces && layer.workspaces !== 'single') {
      for (const id of Object.keys(layer.workspaces)) workspaceRef(`${prefix}workspaces.${id}`, id);
    }
    for (const [key, o] of Object.entries(layer.groups ?? {})) {
      workspaceRef(`${prefix}groups.${key}.workspace`, o.workspace);
      if (!groupKeys.has(key)) warnings.push(`${file}: ${prefix}groups.${key}: no menu group is called '${key}'`);
    }
    for (const [key, o] of Object.entries(layer.items ?? {})) {
      workspaceRef(`${prefix}items.${key}.workspace`, o.workspace);
      if (!itemKeys.has(key)) warnings.push(`${file}: ${prefix}items.${key}: no menu item has the id or href '${key}'`);
    }
  }
  return { errors, warnings };
}

/** Rename groups for display, after workspace filtering (which matches on the identity key). */
export function applyGroupLabels<G extends { label: string }>(groups: G[], profile: ShellProfile | undefined): G[] {
  if (!profile?.groups) return groups;
  return groups.map((g) => {
    const label = menuLabelText(own(profile.groups, g.label)?.label);
    return label ? { ...g, label } : g;
  });
}
