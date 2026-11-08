import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import * as solid from '@fortawesome/free-solid-svg-icons';
import { normalizeIconName } from '@kuraykaraaslan-labs/common/ui/icon-map';

// A workspace icon the sysadmin picked from the whole solid set (docs/phases/54-menu-editor, D54-3), turned into the
// definition the client shell draws. Server only: the full pack never reaches a browser bundle through this file; the
// layout hands the client just the definitions a viewer's menu names.

let byName: Map<string, IconDefinition> | null = null;

function index(): Map<string, IconDefinition> {
  if (byName) return byName;
  byName = new Map();
  for (const value of Object.values(solid)) {
    const def = value as IconDefinition;
    if (!def || typeof def !== 'object' || def.prefix !== 'fas' || typeof def.iconName !== 'string') continue;
    byName.set(def.iconName, def);
    const aliases = Array.isArray(def.icon?.[2]) ? (def.icon[2] as Array<string | number>) : [];
    for (const alias of aliases) if (typeof alias === 'string' && !byName.has(alias)) byName.set(alias, def);
  }
  return byName;
}

/** `fas fa-industry`, `fa-industry` or `industry` → its definition; undefined for a name the solid set does not have. */
export function solidIcon(name: string | undefined): IconDefinition | undefined {
  if (!name) return undefined;
  return index().get(normalizeIconName(name));
}

/** Whether the solid set has the icon (the editor refuses a name it cannot draw). */
export const isSolidIcon = (name: string): boolean => solidIcon(name) !== undefined;
