import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { mergeShellProfiles, type ShellLink, type ShellProfile } from '@kuraykaraaslan-labs/app_shell/ui/shell-profile';
import { groupKey, itemKey, linkKey, workspaceKey, LINK_REF } from './shell_menu.keys';
import { solidIcon } from './shell_menu.icons';
import type { MenuLayer, MenuRole, MenuSpec } from './shell_menu.schema';

// The stored menu → the plain sidebar profile one viewer gets (docs/phases/54-menu-editor, 01–02): the layers merged as
// config/menu.ts's were (all roles, the viewer's built-in role, each custom group they hold in the spec's order), every
// label turned into the viewer's language through its own key, every icon name into the definition the shell draws.

/** The viewer as the menu's layers know them. */
export type MenuViewer = { role: MenuRole | null; customGroups: readonly string[] };

/** A label's text: the viewer's stored text for the key, else the English source. */
export type LabelText = (key: string, english: string) => string;

/** The layers that apply to a viewer, in order (later wins field by field). */
export function viewerLayers(spec: MenuSpec, viewer: MenuViewer): MenuLayer[] {
  const { roles, customGroups, links: _links, ...allRoles } = spec;
  const held = new Set(viewer.customGroups);
  return [
    allRoles,
    ...(viewer.role && roles?.[viewer.role] ? [roles[viewer.role] as MenuLayer] : []),
    ...Object.entries(customGroups ?? {}).filter(([key]) => held.has(key)).map(([, layer]) => layer),
  ];
}

/** Merge the viewer's layers (the stored shapes; labels and icons still English and names). */
export function mergeViewerLayers(spec: MenuSpec, viewer: MenuViewer): MenuLayer {
  return mergeShellProfiles(...(viewerLayers(spec, viewer) as unknown as ShellProfile[])) as unknown as MenuLayer;
}

/**
 * A merged layer in the viewer's language, icons resolved: the plain data the client shell takes. An unknown icon name
 * leaves the workspace's own icon.
 */
export function localizeLayer(layer: MenuLayer, text: LabelText, icon: (name: string) => IconDefinition | undefined = solidIcon): ShellProfile {
  const out: ShellProfile = {};
  if (layer.workspaces === 'single') out.workspaces = 'single';
  else if (layer.workspaces) {
    out.workspaces = Object.fromEntries(Object.entries(layer.workspaces).map(([id, o]) => {
      const { label, icon: iconName, ...rest } = o;
      const def = iconName ? icon(iconName) : undefined;
      return [id, { ...rest, ...(label !== undefined ? { label: text(workspaceKey(id), label) } : {}), ...(def ? { icon: def } : {}) }];
    }));
  }
  if (layer.groups) {
    out.groups = Object.fromEntries(Object.entries(layer.groups).map(([key, o]) => {
      const { label, ...rest } = o;
      return [key, { ...rest, ...(label !== undefined ? { label: text(groupKey(key), label) } : {}) }];
    }));
  }
  if (layer.items) {
    out.items = Object.fromEntries(Object.entries(layer.items).map(([id, o]) => {
      const { label, ...rest } = o;
      return [id, { ...rest, ...(label !== undefined && !id.startsWith(LINK_REF) ? { label: text(itemKey(id), label) } : {}) }];
    }));
  }
  return out;
}

/** The sidebar profile of one viewer: merged, localized, with the links already resolved for them. */
export function viewerProfile(spec: MenuSpec, viewer: MenuViewer, text: LabelText, links: ShellLink[] = []): ShellProfile {
  const profile = localizeLayer(mergeViewerLayers(spec, viewer), text);
  return links.length ? { ...profile, links } : profile;
}

/** A stored text map (key → text) as a `LabelText`: the stored text when it is a non-empty string, else the English. */
export function textFrom(messages: Record<string, unknown>): LabelText {
  return (key, english) => {
    const v = messages[key];
    return typeof v === 'string' && v.trim() ? v : english;
  };
}

/** A link's label in the viewer's language. */
export const linkText = (text: LabelText, linkId: string, english: string) => text(linkKey(linkId), english);
