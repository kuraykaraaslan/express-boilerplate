import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Setting as SettingEntity } from './entities/setting.entity';
import { SettingHistory } from './entities/setting_history.entity';
import { Setting } from './tenant_setting.types';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { decryptValue } from './tenant_setting.crypto';
import { invalidateWrite } from './tenant_setting.cache';
import { deliverSettingsDrop, recordSettingsDrop } from './tenant_setting.cache-drop';
import { update, updateMany } from './tenant_setting.write.service';

// ── Rollback: restore a previous value from history ──────────────────────
export async function rollback(
  tenantId: string,
  key: string,
  historyId: string,
  options?: { actorId?: string },
): Promise<Setting> {
  const history = await withTenantRepositoryFor(tenantId, SettingHistory, (repo) =>
    repo.findOne({ where: { historyId, tenantId, key } }));
  if (!history) throw new AppError('History record not found', 404, ErrorCode.NOT_FOUND);
  return update(tenantId, key, await decryptValue(tenantId, key, history.previousValue), options);
}

export async function getHistory(tenantId: string, key: string): Promise<SettingHistory[]> {
  return withTenantRepositoryFor(tenantId, SettingHistory, (repo) => repo.find({
    where: { tenantId, key },
    order: { createdAt: 'DESC' },
    take: 50,
  }));
}

// ── Lock / unlock a setting (platform operators only) ─────────────────────
export async function setLocked(tenantId: string, key: string, isLocked: boolean): Promise<void> {
  const drops = await withTenantRepositoryFor(tenantId, SettingEntity, async (repo) => {
    await repo.update({ tenantId, key }, { isLocked });
    return recordSettingsDrop(repo.manager?.queryRunner, tenantId, [key]);
  });
  await invalidateWrite(tenantId, [key]);
  await deliverSettingsDrop(drops);
}

// ── Per-plan setting templates ───────────────────────────────────────────
// Apply a named template bundle to a tenant. Templates are defined in
// setting.templates.ts and keyed by plan slug (e.g. 'starter', 'pro', 'enterprise').
export async function applyTemplate(
  tenantId: string,
  templateName: string,
  options?: { actorId?: string },
): Promise<Setting[]> {
  const { SETTING_TEMPLATES } = await import('./tenant_setting.templates');
  // Own templates only: an inherited member ("constructor", "toString") is not a template.
  const template = Object.hasOwn(SETTING_TEMPLATES, templateName) ? SETTING_TEMPLATES[templateName] : undefined;
  if (!template) throw new AppError(`Unknown setting template: ${templateName}`, 400, ErrorCode.VALIDATION_ERROR);
  return updateMany(tenantId, template, options);
}
