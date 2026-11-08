import 'reflect-metadata';
import type { Setting } from './tenant_setting.types';
import type { SettingHistory } from './entities/setting_history.entity';
import { clearCache, readModulesEnabled, writeModulesEnabled } from './tenant_setting.cache';
import {
  getAll, getByKey, getByKeys, getValue, getAllAsRecord, getByGroup, getSettingLevel, getSettingLevelsView,
} from './tenant_setting.read.service';
import type { SettingLevelView } from './tenant_setting.read.service';
import type { ResolvedSettingLevel } from './tenant_setting.levels';
import {
  create, update, updateMany, updateManyGated, remove, removeByPrefix,
} from './tenant_setting.write.service';
import type { GatedUpdateResult } from './tenant_setting.write.service';
import {
  rollback, getHistory, setLocked, applyTemplate,
} from './tenant_setting.admin.service';

/**
 * Setting service facade. The implementation is split across focused modules
 * (`setting.read.service`, `setting.write.service`, `setting.admin.service`,
 * plus the `setting.validation` / `setting.cache` / `setting.crypto` helpers);
 * this class preserves the single `SettingService.*` entry point its callers
 * depend on.
 */
export default class SettingService {
  static clearCache(tenantId: string): Promise<void> {
    return clearCache(tenantId);
  }

  /** The cached resolved enabled-module set (see `getEnabledModuleIds`); `ids` is null on a miss. */
  static getCachedEnabledModules(tenantId: string, registryHash: string): Promise<{ ids: string[] | null }> {
    return readModulesEnabled(tenantId, registryHash);
  }

  static setCachedEnabledModules(tenantId: string, registryHash: string, ids: string[]): Promise<void> {
    return writeModulesEnabled(tenantId, registryHash, ids);
  }

  static getAll(tenantId: string, masked = false): Promise<Setting[]> {
    return getAll(tenantId, masked);
  }

  static getByKey(tenantId: string, key: string, masked = false): Promise<Setting | null> {
    return getByKey(tenantId, key, masked);
  }

  /** `fromDatabase` (D270): the rows are read from the database, the map cache neither read nor filled (the refill of a guarded cache built from settings). */
  static getByKeys(tenantId: string, keys: string[], opts?: { fromDatabase?: boolean }): Promise<Record<string, string>> {
    return getByKeys(tenantId, keys, opts);
  }

  static getValue(tenantId: string, key: string): Promise<string | null> {
    return getValue(tenantId, key);
  }

  static getAllAsRecord(tenantId: string): Promise<Record<string, string>> {
    return getAllAsRecord(tenantId);
  }

  static getByGroup(tenantId: string, group: string): Promise<Setting[]> {
    return getByGroup(tenantId, group);
  }

  /** Phase 53: the tenant's setting level for a module (docs/phases/53-setting-levels), or null for a module without one. */
  static getSettingLevel(tenantId: string, moduleId: string): Promise<ResolvedSettingLevel | null> {
    return getSettingLevel(tenantId, moduleId);
  }

  /** Phase 53.6: the tenant's level of every module whose level can be chosen, for its settings pages ({} on ROOT). */
  static getSettingLevelsView(tenantId: string): Promise<Record<string, SettingLevelView>> {
    return getSettingLevelsView(tenantId);
  }

  static create(
    tenantId: string, key: string, value: string,
    group?: string, type?: string, options?: { actorId?: string; isLocked?: boolean },
  ): Promise<Setting> {
    return create(tenantId, key, value, group, type, options);
  }

  static update(tenantId: string, key: string, value: string, options?: { actorId?: string }): Promise<Setting> {
    return update(tenantId, key, value, options);
  }

  static updateMany(tenantId: string, settings: Record<string, string>, options?: { actorId?: string }): Promise<Setting[]> {
    return updateMany(tenantId, settings, options);
  }

  /**
   * `updateMany` with the optional maker-checker gate. When the tenant enables
   * `tenantSettingMakerChecker`, gateable keys are parked in the approval queue
   * (see `updateManyGated`) rather than written; the returned `pending` lists
   * those, `applied` the writes that went through immediately.
   */
  static updateManyGated(tenantId: string, settings: Record<string, string>, options?: { actorId?: string; actorRole?: string | null; isGlobalAdmin?: boolean }): Promise<GatedUpdateResult> {
    return updateManyGated(tenantId, settings, options);
  }

  static delete(tenantId: string, key: string, options?: { actorId?: string }): Promise<Setting | null> {
    return remove(tenantId, key, options);
  }

  static deleteByPrefix(tenantId: string, prefix: string, options?: { actorId?: string }): Promise<number> {
    return removeByPrefix(tenantId, prefix, options);
  }

  static rollback(tenantId: string, key: string, historyId: string, options?: { actorId?: string }): Promise<Setting> {
    return rollback(tenantId, key, historyId, options);
  }

  static getHistory(tenantId: string, key: string): Promise<SettingHistory[]> {
    return getHistory(tenantId, key);
  }

  static setLocked(tenantId: string, key: string, isLocked: boolean): Promise<void> {
    return setLocked(tenantId, key, isLocked);
  }

  static applyTemplate(tenantId: string, templateName: string, options?: { actorId?: string }): Promise<Setting[]> {
    return applyTemplate(tenantId, templateName, options);
  }
}
