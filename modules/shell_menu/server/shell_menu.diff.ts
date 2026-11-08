import type { MenuSpec } from './shell_menu.schema';

// What changed between two menus, entry by entry (docs/phases/54-menu-editor, 03): the import preview and the history's
// restore question. Pure: the editor page uses it too.

export type SpecDiff = { added: string[]; changed: string[]; removed: string[] };

/** JSON with object keys sorted: the same value gives the same text, whatever order the database or a parser returned the keys in. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : v));
}

/** Every overridden entry of a spec as `path → JSON`, for a diff. */
export function flattenSpec(spec: MenuSpec): Map<string, string> {
  const out = new Map<string, string>();
  const layer = (prefix: string, l: { workspaces?: unknown; groups?: Record<string, unknown>; items?: Record<string, unknown> } | undefined) => {
    if (!l) return;
    if (l.workspaces === 'single') out.set(`${prefix}workspaces`, '"single"');
    else for (const [k, v] of Object.entries((l.workspaces as Record<string, unknown>) ?? {})) out.set(`${prefix}workspaces.${k}`, stableJson(v));
    for (const [k, v] of Object.entries(l.groups ?? {})) out.set(`${prefix}groups.${k}`, stableJson(v));
    for (const [k, v] of Object.entries(l.items ?? {})) out.set(`${prefix}items.${k}`, stableJson(v));
  };
  const { roles, customGroups, links, ...all } = spec;
  layer('', all);
  for (const [r, l] of Object.entries(roles ?? {})) layer(`roles.${r}.`, l);
  for (const [g, l] of Object.entries(customGroups ?? {})) layer(`customGroups.${g}.`, l);
  for (const [id, l] of Object.entries(links ?? {})) out.set(`links.${id}`, stableJson(l));
  return out;
}

export function diffSpecs(before: MenuSpec, after: MenuSpec): SpecDiff {
  const a = flattenSpec(before);
  const b = flattenSpec(after);
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [k, v] of b) { if (!a.has(k)) added.push(k); else if (a.get(k) !== v) changed.push(k); }
  for (const k of a.keys()) if (!b.has(k)) removed.push(k);
  return { added, changed, removed };
}
