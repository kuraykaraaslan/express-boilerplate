// Setting levels, the operator's side (docs/phases/53-setting-levels, 53.3): what ROOT has chosen for each module, for the whole
// installation and per tenant, and the one place those choices are written. The choices are ROOT's own rows
// (`settingLevel.<moduleId>` and `settingLevel.<moduleId>:<tenantId>`, tenant_setting.level.setting.keys.ts), written through the
// ordinary low-level writers, so each change gets its history row, audit row, webhook and cache invalidation.

import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID, isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { SETTING_LEVELS_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { getAllAsRecord, getSettingLevel } from './tenant_setting.read.service';
import { updateMany, remove } from './tenant_setting.write.service';
import { settingLevelKey, settingLevelOverrideKey, SETTING_LEVEL_KEY_PREFIX } from './tenant_setting.level.setting.keys';
import type { ResolvedSettingLevel, SettingLevel } from './tenant_setting.levels';

/** One module's level as the operator sees it. */
export interface ModuleSettingLevelState {
  moduleId: string;
  /** The module's name (module.json), for the operator's screens. */
  name: string;
  allowed: readonly SettingLevel[];
  /** The module's own default (module.json). */
  default: SettingLevel;
  /** The installation's choice, or null when the module's default applies. */
  installation: SettingLevel | null;
  /** The per-tenant overrides, `tenantId -> level`. */
  overrides: Record<string, SettingLevel>;
}

const isLevel = (moduleId: string, v: string | undefined): v is SettingLevel =>
  !!v && (SETTING_LEVELS_BY_MODULE[moduleId]?.allowed as readonly string[] | undefined)?.includes(v) === true;

/** Every module with a setting level and what ROOT has chosen for it. A stored value the module does not allow is not shown. */
export async function listSettingLevels(): Promise<ModuleSettingLevelState[]> {
  const root = await getAllAsRecord(ROOT_TENANT_ID);
  const states = new Map<string, ModuleSettingLevelState>();
  for (const [moduleId, declared] of Object.entries(SETTING_LEVELS_BY_MODULE).sort(([a], [b]) => a.localeCompare(b))) {
    const installation = root[settingLevelKey(moduleId)];
    states.set(moduleId, {
      moduleId,
      name: moduleRegistry.getModule(moduleId)?.name ?? moduleId,
      allowed: declared.allowed,
      default: declared.default,
      installation: isLevel(moduleId, installation) ? installation : null,
      overrides: {},
    });
  }
  for (const [key, value] of Object.entries(root)) {
    if (!key.startsWith(SETTING_LEVEL_KEY_PREFIX)) continue;
    const [moduleId, tenantId] = key.slice(SETTING_LEVEL_KEY_PREFIX.length).split(':');
    const state = moduleId ? states.get(moduleId) : undefined;
    if (state && tenantId && isLevel(moduleId, value)) state.overrides[tenantId] = value;
  }
  return [...states.values()];
}

/** `tenantId`'s level for every module with one, and where each comes from. */
export async function tenantSettingLevels(tenantId: string): Promise<Record<string, ResolvedSettingLevel>> {
  const out: Record<string, ResolvedSettingLevel> = {};
  for (const moduleId of Object.keys(SETTING_LEVELS_BY_MODULE).sort()) {
    const level = await getSettingLevel(tenantId, moduleId);
    if (level) out[moduleId] = level;
  }
  return out;
}

/**
 * Sets a module's level for the installation, or for one tenant with `tenantId`; `level: null` clears the choice (the
 * installation's default or the module's applies again). Refused: a module without a level (404), a fixed one (400), a level the
 * module does not allow (400), and ROOT as the tenant (400: ROOT always reads its own rows).
 */
export async function setSettingLevel(
  input: { moduleId: string; level: SettingLevel | null; tenantId?: string },
  options?: { actorId?: string },
): Promise<ModuleSettingLevelState> {
  const declared = SETTING_LEVELS_BY_MODULE[input.moduleId];
  if (!declared) throw new AppError(`Module "${input.moduleId}" has no setting level.`, 404, ErrorCode.NOT_FOUND);
  if (declared.allowed.length === 1) {
    throw new AppError(`The setting level of "${input.moduleId}" is fixed to ${declared.allowed[0]}.`, 400, ErrorCode.VALIDATION_ERROR);
  }
  if (input.level !== null && !declared.allowed.includes(input.level)) {
    throw new AppError(`"${input.moduleId}" does not allow the level ${input.level}.`, 400, ErrorCode.VALIDATION_ERROR);
  }
  if (input.tenantId !== undefined && isRootTenant(input.tenantId)) {
    throw new AppError('The root tenant always uses its own settings; its level cannot be set.', 400, ErrorCode.VALIDATION_ERROR);
  }
  const key = input.tenantId ? settingLevelOverrideKey(input.moduleId, input.tenantId) : settingLevelKey(input.moduleId);
  if (input.level === null) await remove(ROOT_TENANT_ID, key, options);
  else await updateMany(ROOT_TENANT_ID, { [key]: input.level }, options);
  return (await listSettingLevels()).find((s) => s.moduleId === input.moduleId)!;
}
