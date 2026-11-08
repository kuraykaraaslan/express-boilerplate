// Setting levels (docs/phases/53-setting-levels, D159-D163): which tenant a key of a module's group is read from. Pure functions over
// the two maps the read service already holds (the tenant's own rows and the root tenant's), so a level costs no round trip.
//
// A module's group (the `level` entry of its module.json settings block: keys and key families) is read from ONE side, never key by key: a tenant's
// endpoint must never be paired with the root tenant's credential (docs/audits/2026-10-31-root-credential-fallback.md).
//   platform      the root tenant's rows only; the tenant's own are kept but not used (D163)
//   tenant        the tenant's rows only; the root tenant's are never used
//   tenant_first  the tenant's rows if it set any key of the group, else the root tenant's
// A cap (a numeric limit of the module) at `platform` is the lower of the two values; at any other level the tenant's own, with the
// root tenant's as default.

import { SETTING_LEVELS_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';
import type { SettingLevel } from '@kuraykaraaslan-labs/common/server/module-manifest.types';
import { settingLevelKey, settingLevelOverrideKey } from './tenant_setting.level.setting.keys';

export type { SettingLevel };

/** Which tenant's row answers a key: the asking tenant's (`own`), the root tenant's (`root`), or neither. */
export type SettingSide = 'own' | 'root' | null;

/** Where a tenant's level for a module comes from: the operator's override, the installation's choice, or the module's default. */
export interface ResolvedSettingLevel {
  level: SettingLevel;
  source: 'override' | 'installation' | 'manifest';
}

interface LevelFollow { moduleId: string; cap: boolean }

const KEY_INDEX = new Map<string, LevelFollow>();
const PREFIX_INDEX: Array<[prefix: string, moduleId: string]> = [];
for (const [moduleId, level] of Object.entries(SETTING_LEVELS_BY_MODULE)) {
  for (const key of level.keys) KEY_INDEX.set(key, { moduleId, cap: false });
  for (const key of level.caps) KEY_INDEX.set(key, { moduleId, cap: true });
  for (const prefix of level.prefixes) PREFIX_INDEX.push([prefix, moduleId]);
}

/** The modules whose level the operator can choose (more than one allowed): ROOT's settings pages offer the choice on these. */
export function selectableLevelModules(): string[] {
  return Object.entries(SETTING_LEVELS_BY_MODULE).filter(([, declared]) => declared.allowed.length > 1).map(([moduleId]) => moduleId).sort();
}

/** The module whose level `key` follows, and whether it is one of its caps; null for a key no level covers. */
export function levelFollowOf(key: string): LevelFollow | null {
  const hit = KEY_INDEX.get(key);
  if (hit) return hit;
  for (const [prefix, moduleId] of PREFIX_INDEX) {
    if (key.length > prefix.length && key.startsWith(prefix)) return { moduleId, cap: false };
  }
  return null;
}

/** A tenant's level for `moduleId`, from the root tenant's rows (`rootValue`). A stored level the module does not allow is ignored. */
export function resolveSettingLevel(moduleId: string, tenantId: string, rootValue: (key: string) => string | undefined): ResolvedSettingLevel {
  const declared = SETTING_LEVELS_BY_MODULE[moduleId];
  const allowed = (v: string | undefined): v is SettingLevel => !!v && (declared.allowed as readonly string[]).includes(v);
  const override = rootValue(settingLevelOverrideKey(moduleId, tenantId));
  if (allowed(override)) return { level: override, source: 'override' };
  const installation = rootValue(settingLevelKey(moduleId));
  if (allowed(installation)) return { level: installation, source: 'installation' };
  return { level: declared.default, source: 'manifest' };
}

const isSet = (row: { value: string } | undefined): boolean => row !== undefined && row.value !== '';

/** Whether the tenant set any key of the module's group (tenant_first). A key stored empty is not set. */
export function tenantHasGroup(moduleId: string, own: ReadonlyMap<string, { value: string }>): boolean {
  const declared = SETTING_LEVELS_BY_MODULE[moduleId];
  if (declared.keys.some((key) => isSet(own.get(key)))) return true;
  if (!declared.prefixes.length) return false;
  for (const [key, row] of own) {
    if (isSet(row) && declared.prefixes.some((p) => key.length > p.length && key.startsWith(p))) return true;
  }
  return false;
}

const numberOf = (row: { value: string } | undefined): number | null => {
  if (!isSet(row)) return null;
  const n = Number(row!.value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The side a cap is read from. At `platform` the lower of the two numbers (a non-number on one side loses to a number on the other;
 * two non-numbers keep the root tenant's, the operator's limit); otherwise the tenant's own, with the root tenant's as default.
 */
export function capSide(level: SettingLevel, own: { value: string } | undefined, root: { value: string } | undefined): SettingSide {
  if (level !== 'platform') return own !== undefined ? 'own' : root !== undefined ? 'root' : null;
  const a = numberOf(own);
  const b = numberOf(root);
  if (a !== null && b !== null) return a < b ? 'own' : 'root';
  if (a !== null) return 'own';
  if (b !== null || root !== undefined) return 'root';
  return own !== undefined ? 'own' : null;
}

/**
 * A resolver over one read's maps: the side each level key is read from, with the level and the group decision made once per
 * module. `root` is null when the asking tenant is the root tenant itself, which always reads its own rows.
 */
export function makeLevelSides(
  tenantId: string,
  own: ReadonlyMap<string, { value: string }>,
  root: ReadonlyMap<string, { value: string }> | null,
): (key: string) => SettingSide | undefined {
  const levels = new Map<string, SettingLevel>();
  const groups = new Map<string, SettingSide>();
  const levelOf = (moduleId: string): SettingLevel => {
    let level = levels.get(moduleId);
    if (!level) {
      level = resolveSettingLevel(moduleId, tenantId, (k) => root?.get(k)?.value).level;
      levels.set(moduleId, level);
    }
    return level;
  };
  /** `undefined` for a key no level covers: the caller applies the ordinary inheritance rule. */
  return (key) => {
    const follow = levelFollowOf(key);
    if (!follow) return undefined;
    if (!root) return own.has(key) ? 'own' : null;
    const level = levelOf(follow.moduleId);
    if (follow.cap) return capSide(level, own.get(key), root.get(key));
    let side = groups.get(follow.moduleId);
    if (side === undefined) {
      side = level === 'platform' ? 'root' : level === 'tenant' ? 'own' : tenantHasGroup(follow.moduleId, own) ? 'own' : 'root';
      groups.set(follow.moduleId, side);
    }
    return side;
  };
}
