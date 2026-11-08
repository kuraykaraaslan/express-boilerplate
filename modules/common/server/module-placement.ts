// Where a module, and each of its pages, menu items and API routes, may run (docs/phases/46-module-placement, D46-1..D46-4).
//
// A tenant is one of three places: ROOT (the console of whoever runs this installation), FLEET (the federation identity:
// installations, licences, releases) or any other tenant (a customer). A manifest gives every module one placement, and a
// mixed module gives a page, menu item or API route its own (D46-3). The snapshot (scripts/registry/placement.mjs) resolves
// every item's effective placement and every module's places, so a reader only ever compares one value with one place.
//
// Imports nothing but the dependency-free tenant constants: the browser registry (module-registry.core) filters the menu
// with it.

import { isFleetTenant, isRootTenant } from './tenant-constants';

/** A module's placement (manifest `placement`). */
export type ModulePlacement = 'core' | 'root' | 'fleet' | 'tenant';

/** A page's, menu item's or API route's own placement (D46-3): never `core`, which only a module is. */
export type ItemPlacement = 'root' | 'fleet' | 'tenant';

/** The kind of tenant a request is for. */
export type Place = 'root' | 'fleet' | 'tenant';

export const MODULE_PLACEMENTS: readonly ModulePlacement[] = ['core', 'root', 'fleet', 'tenant'];
export const ITEM_PLACEMENTS: readonly ItemPlacement[] = ['root', 'fleet', 'tenant'];

/**
 * The places each placement may run in. `core` runs everywhere; `tenant` runs for customers and for ROOT, which may use
 * business modules for its own business (D46-2); `root` and `fleet` run only in their own tenant. The fleet tenant uses
 * fleet and core modules only.
 */
const ALLOWS: Readonly<Record<ModulePlacement, readonly Place[]>> = {
  core: ['root', 'fleet', 'tenant'],
  tenant: ['tenant', 'root'],
  root: ['root'],
  fleet: ['fleet'],
};

/** The place of a tenant: ROOT, FLEET or a customer. */
export function placeOfTenant(tenantId: string | null | undefined): Place {
  if (isRootTenant(tenantId)) return 'root';
  if (isFleetTenant(tenantId)) return 'fleet';
  return 'tenant';
}

/** Whether something placed `placement` may run in `place`. An unknown or missing placement runs nowhere (fail closed). */
export function placementAllows(placement: string | null | undefined, place: Place): boolean {
  // Own keys only: `constructor` or `__proto__` must not reach Object.prototype.
  const places = placement && Object.hasOwn(ALLOWS, placement) ? ALLOWS[placement as ModulePlacement] : undefined;
  return !!places && places.includes(place);
}

/** The places a placement may run in (a copy). */
export function placesOf(placement: ModulePlacement): Place[] {
  return [...ALLOWS[placement]];
}

/** Whether something placed `placement` may run for `tenantId`. */
export function placedForTenant(placement: string | null | undefined, tenantId: string | null | undefined): boolean {
  return placementAllows(placement, placeOfTenant(tenantId));
}
