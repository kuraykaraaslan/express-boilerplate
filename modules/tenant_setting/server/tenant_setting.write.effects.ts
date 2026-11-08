import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { SettingHistory } from './entities/setting_history.entity';
import { isSensitiveKey } from './tenant_setting.validation';

export async function recordHistory(
  tenantId: string,
  key: string,
  previousValue: string,
  newValue: string,
  changedByUserId?: string,
): Promise<void> {
  // The swallowing catch wraps the block, never sits inside it: a failed insert
  // aborts the block's transaction (docs/phases/10-db Faz 3). Callers therefore write
  // history AFTER their own block commits, never from inside it.
  try {
    await withTenantRepositoryFor(tenantId, SettingHistory, (repo) => repo.insert({
      tenantId,
      key,
      previousValue,
      newValue,
      changedByUserId,
    }));
  } catch { /* best-effort */ }
}

export async function emitAuditLog(
  tenantId: string,
  action: string,
  key: string,
  actorId?: string,
): Promise<void> {
  try {
    const AuditLogService = (await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')).default;
    await AuditLogService.log({
      tenantId,
      actorId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      action,
      resourceType: 'setting',
      resourceId: key,
    });
  } catch { /* best-effort */ }
}

/**
 * Best-effort webhook fired when a setting VALUE is written. Carries the key and
 * who changed it; the raw value is included ONLY for non-sensitive keys — secrets
 * (`isSensitiveKey`, credential families included) are never emitted off-box, just flagged `sensitive: true`.
 * Lazily imported because `webhook.config` statically imports this module, so a
 * static back-import would form an init-time cycle (the same reason `emitAuditLog`
 * above uses a dynamic import). Never throws.
 */
export async function emitSettingChangedWebhook(
  tenantId: string,
  key: string,
  action: 'created' | 'updated',
  value: string,
  actorId?: string,
): Promise<void> {
  try {
    const WebhookService = (await import('@kuraykaraaslan-labs/webhook/server/webhook.service')).default;
    const sensitive = isSensitiveKey(key);
    await WebhookService.dispatchEvent(tenantId, 'tenant_setting.changed', {
      tenantId,
      key,
      action,
      changedByUserId: actorId ?? null,
      sensitive,
      ...(sensitive ? {} : { value }),
    });
  } catch { /* best-effort */ }
}
