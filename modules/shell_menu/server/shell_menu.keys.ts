import type { MenuSpec } from './shell_menu.schema';

// The translation keys of the menu's own texts (docs/phases/54-menu-editor, 02, D54-4). A rename, an added workspace or
// group and a custom link each get a key in this module; its English is the label in the spec, every other language a
// row in `translations` (platform `web`). The built-in keys (`<module>.menu.<id>`, `app_shell.workspace.<id>`,
// `app_shell.group.<slug>`) are never written here. Pure: the editor page uses it too.

export const SHELL_MENU_MODULE = 'shell_menu';

/** `Platform System` → `platform-system`; the same rule as app_shell's `groupSlug`. */
export function groupSlug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const itemKey = (itemId: string) => `${SHELL_MENU_MODULE}.item.${itemId}`;
export const workspaceKey = (workspaceId: string) => `${SHELL_MENU_MODULE}.workspace.${workspaceId}`;
export const groupKey = (group: string) => `${SHELL_MENU_MODULE}.group.${groupSlug(group) || 'group'}`;
export const linkKey = (linkId: string) => `${SHELL_MENU_MODULE}.link.${linkId}`;

/** A `link:<id>` reference in a layer's `items`. */
export const LINK_REF = 'link:';
export const linkRef = (linkId: string) => `${LINK_REF}${linkId}`;

/**
 * Every label key of a spec with its English source. Labels live only in the all-roles layer (role layers carry none),
 * so this is the menu's whole set of texts: what Platform → Translations lists for the module and what a publish keeps.
 */
export function specLabelSources(spec: MenuSpec): Map<string, string> {
  const out = new Map<string, string>();
  if (spec.workspaces && spec.workspaces !== 'single') {
    for (const [id, o] of Object.entries(spec.workspaces)) if (o.label) out.set(workspaceKey(id), o.label);
  }
  for (const [key, o] of Object.entries(spec.groups ?? {})) if (o.label) out.set(groupKey(key), o.label);
  for (const [id, o] of Object.entries(spec.items ?? {})) {
    if (o.label && !id.startsWith(LINK_REF)) out.set(itemKey(id), o.label);
  }
  for (const [id, link] of Object.entries(spec.links ?? {})) out.set(linkKey(id), link.label);
  return out;
}
