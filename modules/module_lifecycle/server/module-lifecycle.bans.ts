import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import Logger from '@kuraykaraaslan-labs/logger';
import {
  MODULE_BANS_KEY, getModuleBans, isProtectedModule, type ModuleBan,
} from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { noticeBanChange, type BanChange } from './module-lifecycle.ban-notice';

/**
 * The operator's kill switch for a built-in module (docs/phases/37-extensions/07): banned, a module is off for every
 * tenant at once — its routes, pages, menus, slots and extension contributions — and its data is kept. The tenant
 * cannot switch it back on; lifting the ban restores what each tenant had, because the tenant's own activation flag
 * was never touched. Erasure and export still reach its data (EXT-2: first-party code, data-gate points).
 *
 * Per-tenant blocks and retirement are module governance's (docs/phases/25-marketplace/03-module-governance); a ban
 * is the immediate, platform-wide safety action.
 */

export interface ModuleBanEntry extends ModuleBan {
  moduleId: string;
}

/** Tell the tenants that use the module, off the request: the ban is in force already, the notice must not hold it up. */
function notifyTenants(moduleId: string, change: BanChange): void {
  void noticeBanChange(moduleId, change).catch((error) => {
    Logger.warn(`[module_lifecycle] ban notice for ${moduleId} failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export async function listModuleBans(): Promise<ModuleBanEntry[]> {
  const bans = await getModuleBans();
  return Object.entries(bans).map(([moduleId, ban]) => ({ moduleId, ...ban })).sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

export async function banModule(moduleId: string, reason: string, actorId: string | null): Promise<ModuleBanEntry> {
  const why = reason.trim();
  if (!why) throw new AppError('A ban needs a reason.', 400, ErrorCode.VALIDATION_ERROR);
  if (!moduleRegistry.getModule(moduleId)) throw new AppError(`Unknown module: ${moduleId}`, 404, ErrorCode.NOT_FOUND);
  if (isProtectedModule(moduleId)) {
    throw new AppError(`"${moduleId}" is a core module; banning it would take the admin, sign-in or tenancy down with it.`, 409, ErrorCode.CONFLICT);
  }
  const bans = await getModuleBans();
  const ban: ModuleBan = { reason: why, by: actorId, at: new Date().toISOString() };
  bans[moduleId] = ban;
  await SettingService.updateMany(ROOT_TENANT_ID, { [MODULE_BANS_KEY]: JSON.stringify(bans) }, actorId ? { actorId } : undefined);
  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID,
    actorId,
    action: 'module_lifecycle.module.banned',
    resourceType: 'module',
    resourceId: moduleId,
    metadata: { reason: why },
  });
  notifyTenants(moduleId, { kind: 'banned', reason: why, at: ban.at });
  return { moduleId, ...ban };
}

export async function liftModuleBan(moduleId: string, actorId: string | null): Promise<void> {
  const bans = await getModuleBans();
  if (!bans[moduleId]) throw new AppError(`"${moduleId}" is not banned.`, 404, ErrorCode.NOT_FOUND);
  const { reason } = bans[moduleId]!;
  delete bans[moduleId];
  await SettingService.updateMany(ROOT_TENANT_ID, { [MODULE_BANS_KEY]: JSON.stringify(bans) }, actorId ? { actorId } : undefined);
  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID,
    actorId,
    action: 'module_lifecycle.module.ban_lifted',
    resourceType: 'module',
    resourceId: moduleId,
    metadata: { reason },
  });
  notifyTenants(moduleId, { kind: 'lifted', reason, at: new Date().toISOString() });
}
