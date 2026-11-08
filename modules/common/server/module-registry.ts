// Runtime plugin registry. Reads the build-time `module-runtime.json` and
// filters menu items / slot contributions / widgets by enabled-module set,
// scope, and (optionally) the caller's permission set.
//
// React-free, but SERVER-side: it binds the whole runtime JSON (route table,
// permission catalog, extensions), which is far too much for a browser bundle.
// Client components use `@kuraykaraaslan-labs/common/ui/module-registry.client`
// (the same lookups over the slim module-runtime.client.json); a lint rule keeps
// ui/hooks files off this module. The shared lookups live in module-registry.core.
// It returns component *ids* (strings); resolving an id to an actual React
// component happens only in the client <Slot>/widget renderers.

import runtime from './generated/module-runtime.json';
import type { ModuleScope } from './module-manifest.types';
import { placedForTenant, type ItemPlacement, type ModulePlacement, type Place } from './module-placement';
import {
  createListRegistry, matchesFilter, byOrder, navHrefsOf,
  type RegistryFilter, type RuntimeMenuItem, type RuntimeSlotContribution, type RuntimeWidget,
} from './module-registry.core';

// Re-exported so existing server importers keep one import path.
export { matchesFilter, UNIVERSAL_WORKSPACE } from './module-registry.core';
export type {
  RegistryFilter, RuntimeMenuItem, RuntimeSlotContribution, RuntimeWidget, RuntimeModuleSummary,
} from './module-registry.core';

export interface RuntimePageRoute {
  path: string;
  componentId: string;
  permissions: string[];
  /**
   * Admin pages only: the permissions the admin page guard requires (docs/phases/45-install-config D45-5), all of them.
   * The route's own `permissions`, else those of the menu item the page sits under; resolved by the registry snapshot
   * (module-runtime.mjs R7), which refuses an admin page without one.
   */
  guard?: string[];
  /** Where the page exists: its own placement, else its module's (docs/phases/46-module-placement; scripts/registry/placement.mjs). */
  placement?: ItemPlacement | ModulePlacement;
  /** Admin pages only: the href of the menu item the page sits under when no item's href covers it (`routes[].navHref`). */
  navHref?: string;
  /** Admin pages only: the browser-tab name of the page, over the menu item it sits under (`routes[].title`, `titleKey`). */
  title?: string;
  titleKey?: string;
  moduleId: string;
}

export interface RuntimeApiRoute {
  path: string;
  handlerId: string;
  /** Where the route is served: its own placement, else its module's (docs/phases/46-module-placement). */
  placement?: ItemPlacement | ModulePlacement;
  moduleId: string;
}

/** A lookup for one tenant: a page or route not placed for its kind of tenant does not exist for it. */
export interface PlacedLookup {
  tenantId: string;
}

export interface RuntimePermission {
  id: string;
  name: string;
  description?: string;
  group?: string;
  /**
   * Minimum built-in tenant role that holds this permission by default — the
   * coarse floor the ABAC guard authenticates at. Mirrors the wrapped route's
   * old `requiredTenantRole`. Absent → treated as 'ADMIN' by consumers.
   * `'GUEST'` (rank 0) marks a PUBLIC permission enforced via
   * `authorizeRequest` with `scope: 'GUEST'` (no membership required).
   */
  minRole?: 'OWNER' | 'ADMIN' | 'USER' | 'GUEST';
  /**
   * `'account'`: checked only by ACCOUNT-scope routes (the signed-in person, outside any tenant), so the platform user
   * role decides it, never a tenant role (docs/phases/45-install-config D45-4).
   */
  scope?: 'account';
  moduleId: string;
}

export interface RuntimeModule {
  id: string;
  name: string;
  icon?: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  license: string;
  tags: string[];
  priority: number;
  enabled: boolean;
  scope?: ModuleScope;
  tier?: string;
  /** Product edition (manifest `edition`): 'core' (Free) | 'pro' | 'enterprise' | 'iot' (an add-on package, no rank: ADR-0013) | 'custom' (the operator's own module). */
  edition?: 'core' | 'pro' | 'enterprise' | 'iot' | 'custom';
  /** Where it runs (manifest `placement`, docs/phases/46-module-placement D46-1). */
  placement?: ModulePlacement;
  /**
   * The places it may be on: its placement's, plus those of its pages, menu items and API routes placed on their own
   * (a tenant module with a root page runs for customers and ROOT). Activation never switches it on anywhere else.
   */
  places?: Place[];
  /** Module ids this module depends on (manifest `dependencies.requires`). */
  requires: string[];
  /** Module ids it comes with (manifest `enabledWith`): on for a tenant whenever they and its `requires` are. */
  enabledWith?: string[];
}

const LISTS = createListRegistry<RuntimeModule>({
  menu: runtime.menu as unknown as RuntimeMenuItem[],
  slots: runtime.slots as unknown as RuntimeSlotContribution[],
  widgets: runtime.widgets as unknown as RuntimeWidget[],
  modules: runtime.modules as unknown as RuntimeModule[],
  navHrefs: navHrefsOf(runtime.pageRoutes as unknown as RuntimePageRoute[]),
});
/** Mirrors `extension-registry`'s RuntimeExtension; redeclared so this primitive
 *  file keeps its zero-import surface. */
export interface RuntimeComponentExtension {
  id: string;
  point: string;
  moduleId: string;
  key: string | null;
  exportId: string;
  order: number;
  scope: ModuleScope;
  permissions: string[];
  metadata: Record<string, unknown>;
}

const COMPONENT_EXTENSIONS = (runtime.componentExtensions ?? {}) as unknown as Record<string, RuntimeComponentExtension[]>;
const PAGE_ROUTES = (runtime.pageRoutes ?? []) as unknown as RuntimePageRoute[];
const API_ROUTES = (runtime.apiRoutes ?? []) as unknown as RuntimeApiRoute[];
const PERMISSIONS = (runtime.permissions ?? []) as unknown as RuntimePermission[];

/** A route with its path split once, so a request match never re-splits ~1.4k route paths. */
interface IndexedRoute<T> {
  route: T;
  /** Per segment: the param name for a `[param]` segment, null for a literal one. */
  params: (string | null)[];
  segs: string[];
  paramCount: number;
}

interface RouteIndex<T> {
  /** Routes by segment count, each bucket in declaration order (the tie-break depends on it). */
  bySegCount: Map<number, IndexedRoute<T>[]>;
  /** Fully literal routes by normalized path; the first declared wins, like the scan. */
  exact: Map<string, T>;
}

/**
 * Pre-split routes at module load. A request then only scans routes with its own
 * segment count, and a fully literal request path is one Map lookup: a literal
 * route has zero params, so no param route can beat it and the scan would pick
 * the first declared literal anyway.
 */
function indexRoutes<T extends { path: string }>(routes: T[]): RouteIndex<T> {
  const bySegCount = new Map<number, IndexedRoute<T>[]>();
  const exact = new Map<string, T>();
  for (const route of routes) {
    const segs = route.path.split('/').filter(Boolean);
    const params = segs.map((s) => (s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : null));
    const paramCount = params.filter((p) => p !== null).length;
    let bucket = bySegCount.get(segs.length);
    if (!bucket) bySegCount.set(segs.length, (bucket = []));
    bucket.push({ route, params, segs, paramCount });
    if (paramCount === 0) {
      const key = segs.join('/');
      if (!exact.has(key)) exact.set(key, route);
    }
  }
  return { bySegCount, exact };
}

/**
 * Match a request path against an indexed route list by exact segment count,
 * where a `[param]` pattern segment matches any single segment and is captured.
 * When several routes match, the one with the fewest params (most literal) wins;
 * among equals, the first declared.
 */
function matchRoute<T extends { path: string }>(
  index: RouteIndex<T>,
  reqPath: string,
): { route: T; params: Record<string, string> } | undefined {
  const segs = reqPath.split('/').filter(Boolean);
  const literal = index.exact.get(segs.join('/'));
  if (literal) return { route: literal, params: {} };
  let best: IndexedRoute<T> | undefined;
  for (const r of index.bySegCount.get(segs.length) ?? []) {
    if (best && r.paramCount >= best.paramCount) continue;
    let ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      if (r.params[i] === null && r.segs[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) best = r;
  }
  if (!best) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < best.params.length; i++) {
    const name = best.params[i];
    if (name !== null) params[name] = segs[i];
  }
  return { route: best.route, params };
}

/**
 * A match only when it is placed for the lookup's tenant (docs/phases/46-module-placement D46-4). The most literal route
 * is matched first and then dropped, never replaced by a less literal one placed elsewhere: a page outside its placement
 * does not exist, it does not fall through to a neighbour. Without a lookup, any match.
 */
function placedMatch<T extends { placement?: string }>(
  match: { route: T; params: Record<string, string> } | undefined,
  lookup: PlacedLookup | undefined,
): { route: T; params: Record<string, string> } | undefined {
  if (!match || !lookup) return match;
  return placedForTenant(match.route.placement, lookup.tenantId) ? match : undefined;
}

const PAGE_ROUTE_INDEX = indexRoutes(PAGE_ROUTES);
const API_ROUTE_INDEX = indexRoutes(API_ROUTES);

export const moduleRegistry = {
  ...LISTS,

  /**
   * Transitive `requires` closure of a module (excluding itself) — THE one
   * implementation of "what does this module need", shared by the activation
   * store (`tenant_setting`, the disable guard) and the lifecycle orchestrator
   * (`module_lifecycle`, install resolution). The two used to carry private
   * copies that disagreed about protected modules.
   *
   * `stopAt(id)` true means "include nothing of this module and do not walk past
   * it": the lifecycle passes `isProtected` because always-on infrastructure is
   * never installed and its own requirements are not the installer's concern.
   * The store passes nothing and gets the full closure — walking through the
   * infrastructure is exactly what makes a disable refusal conservative. Ids
   * unknown to the registry are skipped.
   */
  getRequiresClosure(id: string, opts: { stopAt?: (id: string) => boolean } = {}): string[] {
    const out = new Set<string>();
    const stack = [...this.getRequires(id)];
    while (stack.length) {
      const dep = stack.pop()!;
      if (dep === id || out.has(dep)) continue;
      if (opts.stopAt?.(dep)) continue;
      if (!this.getModule(dep)) continue;
      out.add(dep);
      stack.push(...this.getRequires(dep));
    }
    return [...out];
  },

  /**
   * Client-component contributions to one `kind: 'component'` extension point.
   *
   * Metadata only — the component itself lives in that point's generated CLIENT
   * map, which server code must never import (it holds static React imports).
   * This is the server half of that split: filter here, resolve the component in
   * the browser by contribution id.
   */
  getComponentExtensions(point: string, filter: RegistryFilter = {}): RuntimeComponentExtension[] {
    return (COMPONENT_EXTENSIONS[point] ?? []).filter((e) => matchesFilter(e, filter)).sort(byOrder);
  },

  /** All manifest-declared admin page routes. */
  getPageRoutes(): RuntimePageRoute[] {
    return PAGE_ROUTES;
  },

  /**
   * The module page that serves an admin path. Matches manifest-declared `routes`
   * by exact segment count, where a `[param]` pattern segment matches any single
   * segment and is captured (e.g. route '/admin/store/products/[productId]'
   * matches '/admin/store/products/42' with params {productId: '42'}). When
   * several routes match, the one with the fewest params (most literal) wins.
   * Used by the catch-all dynamic admin route. With `{ tenantId }`, a page not
   * placed for that tenant's kind is no match (docs/phases/46-module-placement).
   */
  findPageRoute(adminPath: string, lookup?: PlacedLookup): { route: RuntimePageRoute; params: Record<string, string> } | undefined {
    return placedMatch(matchRoute(PAGE_ROUTE_INDEX, adminPath), lookup);
  },

  /** All manifest-declared tenant API routes. */
  getApiRoutes(): RuntimeApiRoute[] {
    return API_ROUTES;
  },

  /**
   * The module API handler that serves a tenant API path (e.g.
   * '/api/store/products/[productId]'), matched like findPageRoute. Used by the
   * catch-all API dispatcher, which passes `{ tenantId }` so a route outside its
   * placement answers 404 (docs/phases/46-module-placement D46-4).
   */
  findApiRoute(apiPath: string, lookup?: PlacedLookup): { route: RuntimeApiRoute; params: Record<string, string> } | undefined {
    return placedMatch(matchRoute(API_ROUTE_INDEX, apiPath), lookup);
  },

  /**
   * The aggregated permission catalog declared across every module's manifest
   * `permissions[]`. Each entry carries its owning `moduleId` so callers can
   * filter to the tenant's enabled modules (see the access-control matrix).
   */
  getPermissions(): RuntimePermission[] {
    return PERMISSIONS;
  },
};

export type ModuleRegistryRuntime = typeof moduleRegistry;
