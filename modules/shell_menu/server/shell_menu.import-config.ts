import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { mergeShellProfiles, menuLabelText, type ShellProfile } from '@kuraykaraaslan-labs/app_shell/ui/shell-profile';
import type { InstallMenu, InstallMenuLayer, MenuLabel } from '@kuraykaraaslan-labs/common/server/install-config/install-config.define';
import { groupKey, itemKey, workspaceKey } from './shell_menu.keys';
import { MENU_ROLES, type MenuLayer, type MenuRole, type MenuSpec } from './shell_menu.schema';
import type { LabelSnapshot } from './entities/shell_menu_revision.entity';

// config/menu.ts (and app/shell.profile.ts under it) → the stored menu (docs/phases/54-menu-editor, 06). A label becomes
// the English source of the entry's own key and every other language it gives a label text; an icon definition its
// Font Awesome name; an item keyed by href its id. A label in a role or custom-group layer is refused (D54-5). Pure.

export type ConvertOptions = {
  /** Leave out item and group keys no current menu entry has (a typo, or an item removed since). */
  dropUnknown?: boolean;
};

export type ConvertResult = {
  spec: MenuSpec;
  /** Languages other than English the file gave, per key. */
  labels: LabelSnapshot;
  /** Parts refused, each with where it is; nothing is written while any is listed. */
  refused: string[];
  /** Item and group keys no current menu entry has (dropped with `dropUnknown`, else kept). */
  unknown: string[];
};

export type ConvertCatalog = { items: Array<{ id: string; href: string; group: string }> };

const iconName = (icon: IconDefinition | undefined): string | undefined => (icon?.iconName ? `fas fa-${icon.iconName}` : undefined);

function splitLabel(label: MenuLabel | undefined, key: string, labels: LabelSnapshot): string | undefined {
  if (label === undefined) return undefined;
  const english = menuLabelText(label, 'en');
  if (typeof label !== 'string') {
    for (const [lang, text] of Object.entries(label)) {
      const code = lang.toLowerCase();
      if (code === 'en' || !text?.trim()) continue;
      (labels[key] ??= {})[code] = text.trim();
    }
  }
  return english?.trim() || undefined;
}

function convertLayer(
  layer: InstallMenuLayer | undefined, at: string, withLabels: boolean, catalog: ConvertCatalog, opts: ConvertOptions, out: ConvertResult,
): MenuLayer | undefined {
  if (!layer) return undefined;
  const result: MenuLayer = {};
  const byHref = new Map(catalog.items.map((i) => [i.href, i.id]));
  const itemIds = new Set(catalog.items.map((i) => i.id));
  const groupNames = new Set(catalog.items.map((i) => i.group));
  const refuseLabel = (where: string) => out.refused.push(`${at}${where}: a label in a role or custom-group layer (labels apply to every role; set it at the top level)`);

  if (layer.workspaces === 'single') result.workspaces = 'single';
  else if (layer.workspaces) {
    result.workspaces = {};
    for (const [id, o] of Object.entries(layer.workspaces)) {
      const { label, icon, ...rest } = o;
      if (label !== undefined && !withLabels) refuseLabel(`workspaces.${id}.label`);
      if (icon !== undefined && !withLabels) out.refused.push(`${at}workspaces.${id}.icon: an icon in a role layer (set it at the top level)`);
      const english = withLabels ? splitLabel(label, workspaceKey(id), out.labels) : undefined;
      const name = withLabels ? iconName(icon) : undefined;
      result.workspaces[id] = { ...rest, ...(english ? { label: english } : {}), ...(name ? { icon: name } : {}) };
    }
  }
  if (layer.groups) {
    result.groups = {};
    for (const [key, o] of Object.entries(layer.groups)) {
      const { label, ...rest } = o;
      if (label !== undefined && !withLabels) refuseLabel(`groups.${key}.label`);
      const english = withLabels ? splitLabel(label, groupKey(key), out.labels) : undefined;
      if (!groupNames.has(key) && !english && !rest.workspace) {
        out.unknown.push(`${at}groups.${key}`);
        if (opts.dropUnknown) continue;
      }
      result.groups[key] = { ...rest, ...(english ? { label: english } : {}) };
    }
  }
  if (layer.items) {
    result.items = {};
    for (const [rawKey, o] of Object.entries(layer.items)) {
      const id = itemIds.has(rawKey) ? rawKey : byHref.get(rawKey) ?? rawKey;
      if (!itemIds.has(id)) {
        out.unknown.push(`${at}items.${rawKey}`);
        if (opts.dropUnknown) continue;
      }
      const { label, ...rest } = o;
      if (label !== undefined && !withLabels) refuseLabel(`items.${rawKey}.label`);
      const english = withLabels ? splitLabel(label, itemKey(id), out.labels) : undefined;
      result.items[id] = { ...(result.items[id] ?? {}), ...rest, ...(english ? { label: english } : {}) };
    }
  }
  return result;
}

/** Convert config/menu.ts, with app/shell.profile.ts under its top level as the layout layered them. */
export function convertInstallMenu(
  menu: InstallMenu | undefined, base: ShellProfile | undefined, catalog: ConvertCatalog, opts: ConvertOptions = {},
): ConvertResult {
  const out: ConvertResult = { spec: {}, labels: {}, refused: [], unknown: [] };
  const { roles, customGroups, ...allRoles } = menu ?? {};
  const top = mergeShellProfiles(base, allRoles as ShellProfile);
  const spec: MenuSpec = { ...convertLayer(top, '', true, catalog, opts, out) };
  for (const role of MENU_ROLES) {
    const layer = convertLayer(roles?.[role as MenuRole], `roles.${role}.`, false, catalog, opts, out);
    if (layer) (spec.roles ??= {})[role] = layer;
  }
  for (const [key, layer] of Object.entries(customGroups ?? {})) {
    const converted = convertLayer(layer, `customGroups.${key}.`, false, catalog, opts, out);
    if (converted) (spec.customGroups ??= {})[key] = converted;
  }
  out.spec = spec;
  return out;
}
