// The part of the module registry that both the server registry
// (module-registry.ts, full module-runtime.json) and the browser registry
// (ui/module-registry.client.ts, the slim module-runtime.client.json) run:
// the filter, the ordering and the menu/slot/widget/module lookups.
//
// No runtime imports on purpose, apart from the placement rule (a few lines over
// the dependency-free tenant ids). Whatever this file imports ends up in every
// client chunk that shows a menu or a slot, and the point of the split is that
// the browser no longer receives the route table, permissions and extensions.
// Sharing one implementation is also what keeps client and server answers equal.

import type { ModuleScope } from './module-manifest.types';
// The one runtime import: the placement rule (docs/phases/46-module-placement), itself importing only the tenant ids.
import { placementAllows, type ItemPlacement, type ModulePlacement, type Place } from './module-placement';

export interface RuntimeMenuItem {
  id: string;
  label: string;
  href: string;
  icon?: string;
  order: number;
  scope: ModuleScope;
  group?: string;
  workspace?: string;
  permissions: string[];
  /** Where the item shows: its own placement, else its module's (resolved by the snapshot, scripts/registry/placement.mjs). */
  placement?: ItemPlacement | ModulePlacement;
  badge?: { type: 'count' | 'dot' | 'text'; source: string };
  children?: RuntimeMenuItem[];
  moduleId: string;
}

export interface RuntimeSlotContribution {
  id: string;
  slot: string;
  componentId: string;
  order: number;
  scope: ModuleScope;
  permissions: string[];
  props: Record<string, unknown>;
  moduleId: string;
}

/** `widget.workspace` value meaning "every workspace dashboard". */
export const UNIVERSAL_WORKSPACE = '*';

export interface RuntimeWidget {
  id: string;
  name?: string;
  componentId: string;
  order: number;
  scope: ModuleScope;
  size?: 'small' | 'medium' | 'large' | 'full';
  /** Workspace dashboard this widget appears on (manifest `widget.workspace`). */
  workspace?: string;
  permissions: string[];
  moduleId: string;
}

export interface RegistryFilter {
  /** Restrict to a URL scope; items with scope 'both' always match. */
  scope?: ModuleScope;
  /** Only include items whose module id is in this set. Omit to include all. */
  enabledIds?: Set<string>;
  /** The caller's permission set. Omit to skip permission gating entirely (v1 default). */
  permissions?: string[];
  /** Widgets only: restrict to a single workspace dashboard id. Omit to include all. */
  workspace?: string;
  /**
   * The place the caller is in (`placeOfTenant(tenantId)`): an item that carries a placement is kept only where that
   * placement runs (docs/phases/46-module-placement D46-4). Omit to skip placement (a catalogue of every item).
   */
  place?: Place;
}

function scopeMatches(itemScope: ModuleScope, want?: ModuleScope): boolean {
  if (!want) return true;
  return itemScope === 'both' || itemScope === want;
}

export function matchesFilter(
  item: { moduleId: string; scope: ModuleScope; permissions: string[]; placement?: string },
  f: RegistryFilter,
): boolean {
  if (f.enabledIds && !f.enabledIds.has(item.moduleId)) return false;
  if (!scopeMatches(item.scope, f.scope)) return false;
  // Only menu items carry a placement; slots and widgets follow their module's activation, which placement already bounds.
  if (f.place && item.placement !== undefined && !placementAllows(item.placement, f.place)) return false;
  // Permission gating only applies when the caller passes a permission set.
  if (f.permissions && item.permissions.length > 0) {
    const ok = item.permissions.every((p) => f.permissions!.includes(p));
    if (!ok) return false;
  }
  return true;
}

export const byOrder = (a: { order: number; id: string }, b: { order: number; id: string }) =>
  a.order - b.order || a.id.localeCompare(b.id);

/** The module fields the browser registry keeps (see module-runtime.client.json). */
export interface RuntimeModuleSummary {
  id: string;
  name: string;
  icon?: string;
  enabled: boolean;
  /** Module ids this module depends on (manifest `dependencies.requires`). */
  requires: string[];
}

export interface ListRegistryData<M extends RuntimeModuleSummary> {
  menu: RuntimeMenuItem[];
  slots: RuntimeSlotContribution[];
  widgets: RuntimeWidget[];
  modules: M[];
  /** Page route path (may hold `[param]` segments) → the href of the menu item it sits under (`routes[].navHref`). */
  navHrefs?: Record<string, string>;
}

/** The `navHrefs` of a page route list (the routes that declare one). */
export function navHrefsOf(pageRoutes: ReadonlyArray<{ path: string; navHref?: string }>): Record<string, string> {
  return Object.fromEntries(pageRoutes.filter((r) => r.navHref).map((r) => [r.path, r.navHref as string]));
}

/** The menu/slot/widget/module lookups over one runtime data set. */
export function createListRegistry<M extends RuntimeModuleSummary>(data: ListRegistryData<M>) {
  const { menu, slots, widgets, modules } = data;
  const navRoutes = Object.entries(data.navHrefs ?? {}).map(([path, href]) => ({ segs: path.split('/').filter(Boolean), href }));
  return {
    /** All known modules (unfiltered), as recorded at build time. */
    getModules(): M[] {
      return modules;
    },

    getModule(id: string): M | undefined {
      return modules.find((m) => m.id === id);
    },

    /** Module ids this module directly depends on (manifest `dependencies.requires`). */
    getRequires(id: string): string[] {
      return this.getModule(id)?.requires ?? [];
    },

    isModuleEnabled(id: string, enabledIds?: Set<string>): boolean {
      if (enabledIds) return enabledIds.has(id);
      return this.getModule(id)?.enabled ?? false;
    },

    getMenuItems(filter: RegistryFilter = {}): RuntimeMenuItem[] {
      return menu.filter((m) => matchesFilter(m, filter)).sort(byOrder);
    },

    /**
     * The path the sidebar matches its items against for an admin path (tenant-relative): the `navHref` of the page's route when
     * it declares one (a page kept without its own menu item, e.g. /admin/iot/claim under Devices), else the path itself. The
     * active item, the workspace and the browser-tab name all match on it, so such a page keeps its place in the menu.
     */
    navPath(appPath: string): string {
      if (!navRoutes.length) return appPath;
      const segs = appPath.split('/').filter(Boolean);
      const hit = navRoutes.find((r) => r.segs.length === segs.length && r.segs.every((s, i) => s === segs[i] || /^\[.+\]$/.test(s)));
      return hit?.href ?? appPath;
    },

    getSlotContributions(slot: string, filter: RegistryFilter = {}): RuntimeSlotContribution[] {
      return slots.filter((s) => s.slot === slot && matchesFilter(s, filter)).sort(byOrder);
    },

    /** Every slot contribution, any slot (e.g. to learn which permissions the visible ones ask for). */
    getAllSlotContributions(filter: RegistryFilter = {}): RuntimeSlotContribution[] {
      return slots.filter((s) => matchesFilter(s, filter)).sort(byOrder);
    },

    getWidgets(filter: RegistryFilter = {}): RuntimeWidget[] {
      return widgets
        .filter((w) => matchesFilter(w, filter))
        // `workspace: '*'` is a widget that belongs on EVERY workspace dashboard —
        // the mechanism a generic overview needs, since the alternative (treating a
        // MISSING workspace as universal) would turn every future typo into a
        // silent seventeen-workspace broadcast and redefine a field all eight
        // shipped widgets already set. A widget with no `workspace` at all stays
        // unreachable, which is what it has always been.
        .filter((w) => !filter.workspace || w.workspace === filter.workspace || w.workspace === UNIVERSAL_WORKSPACE)
        .sort(byOrder);
    },
  };
}
