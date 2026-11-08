import 'reflect-metadata';
import { Like } from 'typeorm';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { Setting as SettingEntity } from './entities/setting.entity';
import { Setting } from './tenant_setting.types';
import SettingMessages from './tenant_setting.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { validateSettingValue as validateValue, isSensitiveKey, isMaskedSecretEcho } from './tenant_setting.validation';
import { env } from '@kuraykaraaslan-labs/env';
import { assertAbacShadowWriteAllowed } from './tenant_setting.abac-shadow';
import { invalidateWrite } from './tenant_setting.cache';
import { deliverSettingsDrop, recordSettingsDrop } from './tenant_setting.cache-drop';
import { encryptValue, parseRow, parseRows } from './tenant_setting.crypto';
import { getValue, getSettingLevel } from './tenant_setting.read.service';
import { recordHistory, emitAuditLog, emitSettingChangedWebhook } from './tenant_setting.write.effects';
import {
  SETTING_CHANGE_ENTITY_TYPE,
  MAKER_CHECKER_SETTING,
  isMakerCheckerGateable,
} from './tenant_setting.write.maker-checker';
import type { PendingSettingChange, GatedUpdateResult } from './tenant_setting.write.maker-checker';
import { settingChangeReviewer } from './tenant_setting.change-review';
import { assertDeclaredSettingKeys, enforceSettingKeyPolicy, isGenericWriteRefusedKey, type SettingWriter } from './tenant_setting.key-policy';
import { assertPaymentDefaultWriteAllowed } from './tenant_setting.payment-default';

// Re-exported so `tenant_setting.write.service` keeps the same public surface
// after the mechanical split into focused siblings (effects + maker-checker).
export { recordHistory, emitAuditLog, emitSettingChangedWebhook };
export { SETTING_CHANGE_ENTITY_TYPE, MAKER_CHECKER_SETTING, isMakerCheckerGateable };
export type { PendingSettingChange, GatedUpdateResult };

/**
 * What every write here checks first: the per-key value rules, then the process role's (docs/phases/02-fleet P9-10: no ABAC shadow mode on a fleet
 * node or the fleet instance). The approved write of a parked change lands through `create`, so it is checked too.
 */
function validateSettingValue(key: string, value: string): void {
  validateValue(key, value);
  assertAbacShadowWriteAllowed(key, value, env.FLEET_ROLE);
}

export async function create(
  tenantId: string,
  key: string,
  value: string,
  group?: string,
  type?: string,
  options?: { actorId?: string; isLocked?: boolean },
): Promise<Setting> {
  validateSettingValue(key, value);
  const encrypted = await encryptValue(tenantId, key, value);
  const now = new Date();
  const { existing, saved, drops } = await withTenantRepositoryFor(tenantId, SettingEntity, async (repo) => {
    const existing = await repo.findOne({ where: { tenantId, key } });
    if (existing) {
      if (existing.isLocked) {
        throw new AppError(SettingMessages.SETTING_NOT_FOUND, 403, ErrorCode.FORBIDDEN);
      }
      await repo.update({ tenantId, key }, { value: encrypted, group: group ?? existing.group, type: type ?? existing.type, updatedAt: now });
    } else {
      await repo.insert({
        tenantId, key, value: encrypted,
        group: group ?? 'general',
        type: type ?? 'string',
        isLocked: options?.isLocked ?? false,
        createdAt: now, updatedAt: now,
      });
    }
    // D270: the cache drop commits with the write (a drop that cannot be recorded rolls the write back)
    const drops = await recordSettingsDrop(repo.manager?.queryRunner, tenantId, [key]);
    return { existing, saved: await repo.findOne({ where: { tenantId, key } }), drops };
  });
  // History, cache, audit and webhook after the block — i.e. after commit.
  if (existing) await recordHistory(tenantId, key, existing.value, encrypted, options?.actorId);
  const parsed = await parseRow(saved!);
  await invalidateWrite(tenantId, [key]);
  await deliverSettingsDrop(drops);
  await emitAuditLog(tenantId, 'setting.created', key, options?.actorId);
  await emitSettingChangedWebhook(tenantId, key, existing ? 'updated' : 'created', value, options?.actorId);
  return parsed;
}

export async function update(
  tenantId: string,
  key: string,
  value: string,
  options?: { actorId?: string },
): Promise<Setting> {
  validateSettingValue(key, value);
  const encrypted = await encryptValue(tenantId, key, value);
  const { existing, updated, drops } = await withTenantRepositoryFor(tenantId, SettingEntity, async (repo) => {
    const existing = await repo.findOne({ where: { tenantId, key } });
    if (!existing) throw new AppError(SettingMessages.SETTING_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (existing.isLocked) throw new AppError('Setting is locked and cannot be modified', 403, ErrorCode.FORBIDDEN);
    await repo.update({ tenantId, key }, { value: encrypted, updatedAt: new Date() });
    const drops = await recordSettingsDrop(repo.manager?.queryRunner, tenantId, [key]);
    return { existing, updated: await repo.findOne({ where: { tenantId, key } }), drops };
  });
  await recordHistory(tenantId, key, existing.value, encrypted, options?.actorId);
  const parsed = await parseRow(updated!);
  await invalidateWrite(tenantId, [key]);
  await deliverSettingsDrop(drops);
  await emitAuditLog(tenantId, 'setting.updated', key, options?.actorId);
  await emitSettingChangedWebhook(tenantId, key, 'updated', value, options?.actorId);
  return parsed;
}

export async function updateMany(
  tenantId: string,
  settings: Record<string, string>,
  options?: { actorId?: string },
): Promise<Setting[]> {
  for (const [key, value] of Object.entries(settings)) validateSettingValue(key, value);

  const now = new Date();

  // Keys actually written (locked ones are skipped) with their raw value +
  // whether the row was created or updated — used to emit per-key webhooks
  // AFTER the transaction commits (never dispatch a side effect mid-transaction).
  const changed: Array<{ key: string; value: string; action: 'created' | 'updated' }> = [];
  // History rows likewise: `recordHistory` is best-effort on its own block, and
  // a swallowed failure inside OUR transaction would have aborted it.
  const history: Array<{ key: string; previousValue: string; newValue: string }> = [];

  // Sealed before the transaction opens: the key service may unwrap or create the tenant's key on the control database.
  const sealed = new Map<string, string>();
  for (const [key, value] of Object.entries(settings)) sealed.set(key, await encryptValue(tenantId, key, value));

  const { saved, drops } = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(SettingEntity);
    const result: SettingEntity[] = [];
    for (const key in settings) {
      const value = settings[key];
      const encrypted = sealed.get(key)!;
      const existing = await repo.findOne({ where: { tenantId, key } });
      if (existing) {
        if (existing.isLocked) continue; // silently skip locked keys
        history.push({ key, previousValue: existing.value, newValue: encrypted });
        await repo.update({ tenantId, key }, { value: encrypted, updatedAt: now });
        changed.push({ key, value, action: 'updated' });
      } else {
        await repo.insert({ tenantId, key, value: encrypted, group: 'general', type: 'string', createdAt: now, updatedAt: now });
        changed.push({ key, value, action: 'created' });
      }
      result.push((await repo.findOne({ where: { tenantId, key } }))!);
    }
    const drops = changed.length ? await recordSettingsDrop(qr, tenantId, changed.map((c) => c.key)) : [];
    return { saved: result, drops };
  });
  const updatedSettings = await parseRows(saved);

  for (const h of history) {
    await recordHistory(tenantId, h.key, h.previousValue, h.newValue, options?.actorId);
  }
  await invalidateWrite(tenantId, updatedSettings.map((p) => p.key));
  await deliverSettingsDrop(drops);
  await emitAuditLog(tenantId, 'setting.bulk_updated', Object.keys(settings).join(','), options?.actorId);
  for (const c of changed) {
    await emitSettingChangedWebhook(tenantId, c.key, c.action, c.value, options?.actorId);
  }
  return updatedSettings;
}

export async function remove(
  tenantId: string,
  key: string,
  options?: { actorId?: string },
): Promise<Setting | null> {
  const { setting, drops } = await withTenantRepositoryFor(tenantId, SettingEntity, async (repo) => {
    const found = await repo.findOne({ where: { tenantId, key } });
    if (!found) return { setting: null, drops: [] };
    if (found.isLocked) throw new AppError('Setting is locked and cannot be deleted', 403, ErrorCode.FORBIDDEN);
    await repo.delete({ tenantId, key });
    return { setting: found, drops: await recordSettingsDrop(repo.manager?.queryRunner, tenantId, [key]) };
  });
  if (!setting) return null;
  const parsed = await parseRow(setting);
  await invalidateWrite(tenantId, [key]);
  await deliverSettingsDrop(drops);
  await emitAuditLog(tenantId, 'setting.deleted', key, options?.actorId);
  return parsed;
}

/**
 * Delete every (non-locked) setting whose key starts with `prefix` for a tenant.
 * Used by the marketplace to purge a module's config keys (e.g. `module.blog.`)
 * on uninstall. Returns the number of rows removed.
 */
/** Escape LIKE's wildcards (`%`, `_`) and its escape character (the backslash) in a literal prefix. */
export function escapeLike(literal: string): string {
  return literal.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function removeByPrefix(
  tenantId: string,
  prefix: string,
  options?: { actorId?: string },
): Promise<number> {
  const { deletedKeys, drops } = await withTenantRepositoryFor(tenantId, SettingEntity, async (repo) => {
    // `_` and `%` in the prefix are LIKE wildcards: escape them (Postgres' default LIKE escape character is the
    // backslash), and keep only rows that really start with the prefix, so `plugin:local/a_b:` never matches
    // `plugin:local/a-b:…`.
    const rows = await repo.find({ where: { tenantId, key: Like(`${escapeLike(prefix)}%`) } });
    const deletable = rows.filter((r) => !r.isLocked && r.key.startsWith(prefix));
    if (deletable.length === 0) return { deletedKeys: [] as string[], drops: [] };
    await repo.delete(deletable.map((r) => ({ tenantId, key: r.key })));
    const deletedKeys = deletable.map((r) => r.key);
    return { deletedKeys, drops: await recordSettingsDrop(repo.manager?.queryRunner, tenantId, deletedKeys) };
  });
  const deleted = deletedKeys.length;
  if (deleted === 0) return 0;
  await invalidateWrite(tenantId, deletedKeys);
  await deliverSettingsDrop(drops);
  await emitAuditLog(tenantId, 'setting.deleted', `${prefix}* (${deleted})`, options?.actorId);
  return deleted;
}

/**
 * `updateMany` with an optional maker-checker gate. When the tenant has set
 * `tenantSettingMakerChecker` to `'true'`, gateable keys are NOT written — each
 * is handed to the reviewer (`tenant_setting:change_review`: the approval queue)
 * carrying the intended value (secrets stored via `encryptValue`, never
 * plaintext) and applied later by `applySettingChangeDecision` on APPROVED.
 * The gate-off path falls straight through to `updateMany`, so the core write
 * path is untouched. Every key is gateable, the toggle included (tenant_setting.02).
 *
 * Fails CLOSED: maker-checker is a security control, so with the gate on and
 * no reviewer for the tenant (approval not installed, or switched off) the
 * whole batch is refused with 409 before anything is written. A submit failure
 * of one key is logged and that key is left unpended (neither written nor
 * queued).
 */
export async function updateManyGated(
  tenantId: string,
  submitted: Record<string, string>,
  options?: { actorId?: string; actorRole?: string | null; isGlobalAdmin?: boolean },
): Promise<GatedUpdateResult> {
  // The read routes answer secrets masked (tenant_setting.01); a form that saves the mask back means "unchanged", never
  // "store the mask as the new secret".
  let settings = Object.fromEntries(Object.entries(submitted).filter(([k, v]) => !isMaskedSecretEcho(k, v)));
  // The generic settings API cannot write what a ledger owns (see isLedgerProjectionKey), nor a sandboxed plugin's
  // config, which only the plugin config services write (see isPluginConfigKey), nor a module's internal rows (MS-09) or
  // a key that has its own validating route (MS-21): see isGenericWriteRefusedKey.
  const forbidden = Object.keys(settings).filter((k) => isGenericWriteRefusedKey(k));
  if (forbidden.length > 0) {
    throw new AppError(
      `These settings are managed by the marketplace, a plugin's config page, their own settings page or the platform operator and cannot be written directly: ${forbidden.join(', ')}.`,
      403,
      ErrorCode.FORBIDDEN,
    );
  }
  // Only keys a module declares (F.tsetting.01): an unknown key is a 400, never free storage.
  assertDeclaredSettingKeys(Object.keys(settings));
  // Platform-only and owner-only keys (F.tsetting.01, S3): refused unless the writer may change them; an unchanged value is dropped.
  const writer: SettingWriter = { role: options?.actorRole ?? null, isGlobalAdmin: options?.isGlobalAdmin };
  settings = await enforceSettingKeyPolicy(tenantId, settings, writer, (key) => getValue(tenantId, key),
    async (moduleId) => (await getSettingLevel(tenantId, moduleId))?.level ?? null);
  // Every value is validated before anything is written or queued: a gated key used to reach the review queue unchecked
  // and fail only when the approved write ran (an `abacShadowMode` turned on on a fleet node, an invalid IP list).
  for (const [key, value] of Object.entries(settings)) validateSettingValue(key, value);
  // 08-payment review: the default payment gateway is not switched off (checkout would refuse every payment that falls
  // back to it), neither the tenant's own nor, on a ROOT write, that of the tenants inheriting ROOT's values (review D).
  // Before anything is written or queued; a parked change is checked again when approved and applied (review C).
  await assertPaymentDefaultWriteAllowed(tenantId, settings, (key) => getValue(tenantId, key));
  const makerChecker = await getValue(tenantId, MAKER_CHECKER_SETTING).catch(() => null);
  if (makerChecker !== 'true') {
    return { applied: await updateMany(tenantId, settings, options), pending: [] };
  }

  // Split the batch (every key is gateable today; the split stays so a future exemption has one place to go).
  const immediate: Record<string, string> = {};
  const gated: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(settings)) {
    if (isMakerCheckerGateable(key)) gated.push([key, value]);
    else immediate[key] = value;
  }

  // Before anything is written: a gated change with nobody to review it is refused, never applied unreviewed. The one
  // exception keeps the gate from locking the tenant in: with no reviewer at all, the OWNER (only) may switch the gate off,
  // alone in its batch; the write is audited like any other.
  const reviewer = gated.length > 0 ? await settingChangeReviewer(tenantId) : null;
  if (gated.length > 0 && !reviewer) {
    const keys = Object.keys(settings);
    const ownerSwitchesGateOff = keys.length === 1 && keys[0] === MAKER_CHECKER_SETTING && settings[MAKER_CHECKER_SETTING] !== 'true'
      && (writer.role === 'OWNER' || writer.isGlobalAdmin === true);
    if (ownerSwitchesGateOff) return { applied: await updateMany(tenantId, settings, options), pending: [] };
    throw new AppError(SettingMessages.MAKER_CHECKER_NO_REVIEWER, 409, ErrorCode.CONFLICT);
  }

  const applied = Object.keys(immediate).length > 0
    ? await updateMany(tenantId, immediate, options)
    : [];

  const pending: PendingSettingChange[] = [];
  if (reviewer) {
    for (const [key, value] of gated) {
      try {
        const { reviewId } = await reviewer.submit(tenantId, {
          key,
          value: await encryptValue(tenantId, key, value),
          encrypted: isSensitiveKey(key),
          actorId: options?.actorId ?? null,
        });
        pending.push({ key, approvalItemId: reviewId });
      } catch (err) {
        Logger.warn(
          `[tenant_setting] maker-checker submit failed tenant=${tenantId} key=${key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
  return { applied, pending };
}
