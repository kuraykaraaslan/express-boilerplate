// Per-tenant module enable/disable state, stored in the shared key-value
// `settings` table under `module.<id>.enabled`. Absent key falls back to the
// module's manifest `enabled` default. App-store-friendly: an installer simply
// writes these keys (plus, later, an installed/version key).

import { createHash } from 'node:crypto';
import SettingService from './tenant_setting.service';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { placeOfTenant, type Place } from '@kuraykaraaslan-labs/common/server/module-placement';
import { installModules } from '@kuraykaraaslan-labs/common/server/install-config/install-config.modules';

const KEY = (id: string) => `module.${id}.enabled`;

/**
 * The ROOT-tenant setting holding the platform's module bans (docs/phases/37-extensions/07): moduleId → ban.
 * A banned module is off for every tenant — routes, pages, menus, slots and extension contributions alike, because
 * all of them read `getEnabledModuleIds` — and its data is kept. Written only by module_lifecycle (bans); the generic
 * settings API refuses it like the other ledger projections. Core (protected) modules cannot be banned.
 */
export const MODULE_BANS_KEY = 'platform.module_bans';

export interface ModuleBan {
  reason: string;
  by: string | null;
  at: string;
}

/** Parse the stored ban map; anything malformed is ignored rather than switching modules off by accident. */
export function parseModuleBans(raw: string | undefined | null): Record<string, ModuleBan> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, Partial<ModuleBan>>;
    const out: Record<string, ModuleBan> = {};
    for (const [id, ban] of Object.entries(value ?? {})) {
      if (ban && typeof ban.reason === 'string' && ban.reason.trim()) out[id] = { reason: ban.reason, by: ban.by ?? null, at: ban.at ?? '' };
    }
    return out;
  } catch {
    return {};
  }
}

/** The platform's module bans, read from ROOT's settings (cached by the settings layer). */
export async function getModuleBans(): Promise<Record<string, ModuleBan>> {
  const rec = await SettingService.getByKeys(ROOT_TENANT_ID, [MODULE_BANS_KEY]);
  return parseModuleBans(rec[MODULE_BANS_KEY]);
}

/**
 * The settings key holding a module's per-tenant enabled flag. Exported so the
 * few writers that must bypass `setModuleEnabled`'s dependency guard (marketplace
 * purge, which has already run its own dependency check and is mid-teardown)
 * still write the one canonical key rather than re-deriving the format.
 */
export function moduleEnabledKey(id: string): string {
  return KEY(id);
}

// Core modules that keep the admin, auth and tenancy working. They cannot be
// disabled — otherwise a tenant could lock itself out of this very screen.
// `marketplace` is here too: it is the module that manages modules, so it must
// always be on and never appear as an installable marketplace item. Its two
// split-out peers `marketplace_developer` (registry data + publishing console)
// and `marketplace_review` (platform review) are protected for the same reason:
// `marketplace` value-imports the registry entities `marketplace_developer` owns,
// so it can never be disabled anyway, and both are always-present operator
// surfaces rather than installable per-tenant features.
const PROTECTED = new Set([
  'common', 'db', 'env', 'logger', 'redis', 'limiter',
  'tenant_setting', 'auth', 'user', 'user_session', 'tenant', 'tenant_session', 'tenant_member',
  'marketplace', 'marketplace_developer', 'marketplace_review', 'plugin_runtime', 'auth_abac',
  // module_lifecycle is the single door every install, activation and purge goes
  // through (audit-fix Faz 5): the storefront, plan changes and provisioning all
  // call it, so a tenant that could switch it off could no longer manage modules.
  'module_lifecycle',
  // app_shell renders the admin chrome (sidebar/topbar/workspace switcher) —
  // the Next.js admin layout imports it unconditionally, not behind an
  // enabled-module check, so disabling it would break every admin screen.
  'app_shell',
  // account owns the /me API and the "My Account" page — the surface EVERY
  // signed-in person needs, whatever else the tenant bought. It holds no tables
  // and no product feature; disabling it would take away someone's ability to
  // read their own profile or revoke their own sessions (MIS-01, 2026-08).
  'account',
  // feature_gate answers "is this tenant allowed to do X" for fourteen modules —
  // mail, sms, storage, ai, webhooks, api keys, invoicing … Disabling it would
  // cascade through every one of them, and it has no table, screen or setting of
  // its own for an operator to be disabling in the first place. It is on for the
  // same reason `limiter` is (DUP-01 step 5, 2026-08).
  'feature_gate',
  // dashboard owns `/admin` — the admin home, which the sidebar links to
  // unconditionally and post-login lands on. It moved here from `common` (which
  // is protected) in 2026-08, and being neither protected nor default-on meant
  // the admin home 404'd for every tenant without an explicit setting row. It is
  // protected for the same reason as `app_shell` and `account`: a surface every
  // signed-in admin needs, holding no sellable feature of its own — boards and
  // widgets are configuration, not a product.
  'dashboard',
  // translation serves the UI texts kept in the database: the guest routes the mobile
  // app reads before sign-in, and (next) the overlay the admin layout applies on every
  // page. A tenant with it off would 404 the app's language download and lose its
  // corrected texts. Like `account`, it holds no sellable feature of its own.
  'translation',
]);

// Content modules a fresh tenant gets out of the box. Every other (non-protected,
// non-allowlisted) feature module defaults OFF until installed via the marketplace.
const DEFAULT_ON = new Set(['blog', 'seo', 'dynamic_page']);

export function isProtectedModule(id: string): boolean {
  return PROTECTED.has(id);
}

/**
 * A module placed `core` (docs/phases/46-module-placement D46-1): a platform service every place has, never switched per
 * tenant. Editions still apply: a build or edition that leaves the module out has no registry entry for it.
 */
export function isCoreModule(id: string): boolean {
  return moduleRegistry.getModule(id)?.placement === 'core';
}

/**
 * Included by the installation (config/modules.ts `included`, with every module those require): part of this product in
 * every tenant, so always on wherever it is placed, like a core module.
 */
export function isIncludedModule(id: string): boolean {
  return installModules().included.has(id);
}

/**
 * Hidden by the installation (config/modules.ts `hidden`): the tenants' marketplace never lists it, and a tenant never
 * installs, switches or removes it; a plan, the default list, a module that requires it or the operator still may.
 */
export function isMarketplaceHiddenModule(id: string): boolean {
  return installModules().hidden.has(id);
}

/**
 * Always on wherever it is placed, never installed, switched or removed per tenant: the protected list above, every
 * module placed `core` (D46-1) and the modules the installation includes in every tenant (config/modules.ts). A tenant's
 * own `module.<id>.enabled` row is ignored for it. A platform ban (docs/phases/37-extensions/07) still reaches one that is
 * not on the protected list: that is the operator's kill switch for every tenant at once, not a per-tenant switch.
 */
export function isAlwaysOnModule(id: string): boolean {
  return PROTECTED.has(id) || isCoreModule(id) || isIncludedModule(id);
}

/**
 * Whether a module is enabled for a tenant that has no explicit `module.<id>.enabled`
 * setting row yet. Protected and core modules and the starter content modules are on;
 * everything else is off (marketplace-gated).
 */
export function defaultEnabled(id: string): boolean {
  return isAlwaysOnModule(id) || DEFAULT_ON.has(id);
}

/**
 * The places a module may be on (docs/phases/46-module-placement D46-1..D46-3): its manifest placement's, plus those of its
 * pages, menu items and API routes placed on their own, as the snapshot resolved them. A module the registry does not know,
 * or one without places, may be on nowhere (fail closed).
 */
function modulePlaces(id: string): readonly Place[] {
  return moduleRegistry.getModule(id)?.places ?? [];
}

/**
 * Whether a module may be on for `tenantId` (D46-4): a root module for ROOT only, a fleet module for the fleet tenant
 * only, a tenant module for customers and ROOT, a core module everywhere; a mixed module also where its own parts are
 * placed. A module outside its placement is never on, whatever the tenant's settings say.
 */
export function isModulePlacedIn(id: string, tenantId: string): boolean {
  return modulePlaces(id).includes(placeOfTenant(tenantId));
}

/**
 * A module no customer tenant may have (root or fleet placement, D46-1; it replaced manifest `installableBy: "operator"`):
 * the fleet family, `seed`, `marketplace_review`, `fleet_agent`. Never offered to, installable by or served to a customer.
 */
export function isPlatformOnlyModule(id: string): boolean {
  return !modulePlaces(id).includes('tenant');
}

// The resolution rules themselves, for a change the module list and the default
// sets do not show. 2: the flags are no longer inherited from ROOT, so a set an
// older replica cached under the old rules is never served during a rollout.
// 3: placement (docs/phases/46-module-placement) bounds ROOT and the fleet tenant too.
// 4: a core module is always on (D46-1), whatever the tenant's rows say.
// 5: so is a module config/modules.ts includes (its lists are part of the hash below).
// 6: a companion (`enabledWith`) is on whenever its host and its own requirements are.
const RESOLUTION_RULES = 6;
// (Every module's placement and places are part of the hash below: they change what a
// tenant's set may contain without changing the module list.)

// Everything besides the settings rows that decides the resolved set: the
// module list, the default rules and the resolution rules. A deploy that changes
// any of them gets a new hash, so a replica never serves a set computed by
// different code. Memoised per registry array (a build-time constant in production).
let registryHashMemo: { mods: unknown; size: number; hash: string } | null = null;
function registryHash(mods: ReadonlyArray<{ id: string; placement?: string; places?: readonly string[]; enabledWith?: readonly string[] }>): string {
  if (registryHashMemo?.mods === mods && registryHashMemo.size === mods.length) return registryHashMemo.hash;
  const hash = createHash('sha256')
    .update(JSON.stringify([
      mods.map((m) => m.id).sort(), [...PROTECTED].sort(), [...DEFAULT_ON].sort(), RESOLUTION_RULES,
      mods.map((m) => `${m.id}:${m.placement ?? ''}:${(m.places ?? []).join(',')}:${(m.enabledWith ?? []).join('+')}`).sort(),
      [...installModules().included].sort(),
    ]))
    .digest('hex')
    .slice(0, 16);
  registryHashMemo = { mods, size: mods.length, hash };
  return hash;
}

// Cache failures (Redis down, a test double without the cache methods) are a
// miss: the set is always recomputable from the settings.
async function readCachedSet(tenantId: string, hash: string): Promise<{ ids: string[] | null } | null> {
  try { return await SettingService.getCachedEnabledModules(tenantId, hash); } catch { return null; }
}

/**
 * The tenant's enabled modules: its own `module.<id>.enabled` rows, else the
 * code default. ROOT's rows are NOT a fallback — the settings read layer never
 * inherits a ledger projection — so the operator enabling a module for the
 * platform tenant switches it on for nobody else. Read on every tenant API
 * dispatch, so the resolved set is cached in one Redis entry (short TTL) instead
 * of resolving ~160 keys per call; the settings write layer drops it whenever
 * such a key is written (see `invalidateWrite`).
 */
export async function getEnabledModuleIds(tenantId: string): Promise<Set<string>> {
  const [own, bans] = await Promise.all([ownEnabledModuleIds(tenantId), getModuleBans()]);
  // The platform's ban list (docs/phases/37-extensions/07) is applied on every read, not cached into the tenant's set:
  // that set depends on the tenant's own rows only, so a ban reaches every tenant at once without touching their caches.
  // The list is ROOT's setting, read through ROOT's own settings cache, which the ban write invalidates.
  for (const id of [...own]) if (bans[id] && !PROTECTED.has(id)) own.delete(id);
  return own;
}

/**
 * Companions (manifest `enabledWith`): a module that comes with its host is on for the tenant exactly when every host it lists and every module
 * it requires is on (and it may be there at all, D46-4), whatever its own row says: the tenant never switches it. Resolved to a fixed point, so a
 * companion of a companion follows too, and a companion whose requirement is missing stays off (no half-working module). Pure over the set.
 */
export function addCompanions(
  enabled: Set<string>,
  mods: ReadonlyArray<{ id: string; places?: readonly string[]; requires?: readonly string[]; enabledWith?: readonly string[] }>,
  place: Place,
): void {
  const companions = mods.filter((m) => (m.enabledWith?.length ?? 0) > 0 && (m.places ?? []).includes(place));
  for (let changed = true; changed;) {
    changed = false;
    for (const m of companions) {
      if (enabled.has(m.id)) continue;
      if (m.enabledWith!.every((h) => enabled.has(h)) && (m.requires ?? []).every((r) => enabled.has(r))) {
        enabled.add(m.id);
        changed = true;
      }
    }
  }
}

/** The modules the tenant's own rows switch on (else the code default), cached per tenant (see `invalidateWrite`). */
async function ownEnabledModuleIds(tenantId: string): Promise<Set<string>> {
  const mods = moduleRegistry.getModules();
  const hash = registryHash(mods);
  const cached = await readCachedSet(tenantId, hash);
  if (cached?.ids) return new Set(cached.ids);

  const rec = await SettingService.getByKeys(tenantId, mods.map((m) => KEY(m.id)));
  const enabled = new Set<string>();
  const place = placeOfTenant(tenantId);
  for (const m of mods) {
    // A module is never on outside its placement (D46-4): a legacy flag cannot expose a fleet module to a customer, a root
    // module to the fleet tenant or a business module to the fleet tenant.
    if (!(m.places ?? []).includes(place)) continue;
    // A protected or core module is on whatever an old row says (D46-1: never switched per tenant).
    const v = rec[KEY(m.id)];
    const on = isAlwaysOnModule(m.id) || (v === undefined ? defaultEnabled(m.id) : v === 'true');
    if (on) enabled.add(m.id);
  }
  addCompanions(enabled, mods, place);
  if (cached) {
    try { await SettingService.setCachedEnabledModules(tenantId, hash, [...enabled]); } catch {}
  }
  return enabled;
}

export interface ModuleState {
  id: string;
  name: string;
  icon?: string;
  tier?: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  license: string;
  tags: string[];
  enabled: boolean;
  protected: boolean;
  defaultOn: boolean;
  /** Included in every tenant by config/modules.ts (then `protected` too). */
  included: boolean;
  /** Never listed in a tenant's marketplace (config/modules.ts `hidden`). */
  marketplaceHidden: boolean;
}

export async function listModulesWithState(tenantId: string): Promise<ModuleState[]> {
  const enabled = await getEnabledModuleIds(tenantId);
  return moduleRegistry
    .getModules()
    .map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      tier: m.tier,
      version: m.version,
      description: m.description,
      author: m.author,
      homepage: m.homepage,
      license: m.license,
      tags: m.tags,
      enabled: enabled.has(m.id),
      protected: isAlwaysOnModule(m.id),
      defaultOn: DEFAULT_ON.has(m.id),
      included: isIncludedModule(m.id),
      marketplaceHidden: isMarketplaceHiddenModule(m.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Transitive `requires` closure of a module (the modules it depends on) — the shared registry walk, unfiltered. */
function requiresClosure(id: string): Set<string> {
  return new Set(moduleRegistry.getRequiresClosure(id));
}

/**
 * Enabled modules that depend (transitively) on `id` — disabling `id` would break
 * them. Used to block breaking a dependency chain.
 */
export async function enabledDependentsOf(tenantId: string, id: string): Promise<string[]> {
  const enabled = await getEnabledModuleIds(tenantId);
  return [...enabled].filter((d) => d !== id && requiresClosure(d).has(id));
}

export async function setModuleEnabled(
  tenantId: string,
  id: string,
  enabled: boolean,
  actorId?: string,
): Promise<void> {
  if (!moduleRegistry.getModule(id)) {
    throw new Error(`Unknown module: ${id}`);
  }
  // Never switched on outside its placement (docs/phases/46-module-placement D46-4); the read above ignores such a flag
  // anyway, so writing one would only leave a row that says otherwise.
  if (enabled && !isModulePlacedIn(id, tenantId)) {
    throw new Error(`Module "${id}" cannot be enabled here: its placement is '${moduleRegistry.getModule(id)?.placement}'.`);
  }
  if (!enabled && isAlwaysOnModule(id)) {
    throw new Error(isIncludedModule(id)
      ? `Module "${id}" comes with every tenant of this installation (config/modules.ts) and cannot be disabled.`
      : `Module "${id}" is a core module and cannot be disabled.`);
  }
  // Don't break the dependency chain: refuse to disable a module that other
  // currently-enabled modules still require.
  if (!enabled) {
    const dependents = await enabledDependentsOf(tenantId, id);
    if (dependents.length) {
      throw new Error(
        `Cannot disable "${id}" — still required by enabled module(s): ${dependents.join(', ')}. Disable those first.`,
      );
    }
  }
  await SettingService.updateMany(
    tenantId,
    { [KEY(id)]: String(enabled) },
    actorId ? { actorId } : undefined,
  );
}
