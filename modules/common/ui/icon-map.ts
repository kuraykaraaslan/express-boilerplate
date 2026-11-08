// Resolve a manifest icon string (e.g. "fas fa-gear" or "gear") to a concrete
// FontAwesome IconDefinition.
//
// The map is GENERATED from the module manifests (see scripts/registry/icons.mjs)
// rather than hand-listed here. It used to be a hand-maintained allowlist, which
// meant a module could declare a perfectly good icon, miss this file, and
// silently render the generic fallback — 82 of 130 sidebar items did exactly
// that. Deriving it from the manifests keeps the bundle tree-shaken (only
// declared icons ship) while removing the central gate: declare an icon in your
// module.json and it works, with no second place to edit.
//
// Icons that no build-time scan can see — a marketplace plugin installed at
// runtime names its icon in the database — are not in this map. Render those
// through <ModuleIcon>, which lazily loads the full pack on a miss.

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCube } from '@fortawesome/free-solid-svg-icons';
import { manifestIcons } from './generated/icon-map.data';

/** Fallback used when a manifest icon string is missing or unknown. */
export const DEFAULT_ICON = faCube;

/** Strips the optional pack prefix: "fas fa-gear", "fa-gear" and "gear" all → "gear". */
export function normalizeIconName(name: string): string {
  return name.trim().replace(/^fa[a-z]?\s+fa-/, '').replace(/^fa-/, '');
}

/**
 * Accepts "fas fa-gear", "fa-gear", or "gear" and returns the IconDefinition,
 * or undefined if no module manifest declares it.
 */
export function resolveIcon(name?: string): IconDefinition | undefined {
  if (!name) return undefined;
  return manifestIcons[normalizeIconName(name)];
}
