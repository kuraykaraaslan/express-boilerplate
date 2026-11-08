import { Setting as SettingEntity } from './entities/setting.entity';
import { Setting, SettingSchema } from './tenant_setting.types';
import { isEncryptedField } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { tenantKeys } from '@kuraykaraaslan-labs/db/server/db.tenant-keys.service';
import { isSensitiveKey } from './tenant_setting.validation';

/**
 * The sensitive values (`isSensitiveKey`: the listed keys and the credential families such as `ssoClientSecret:<provider>`) of `settings` and `setting_history` are encrypted under the tenant's data key (P7-TDEK, decision F16; declared in
 * tenant_setting.tenant-key-columns.ts with a row filter on the key). Old rows (v1 node-key envelopes, plaintext) stay readable through the
 * key service's dual read until the online backfill moves them.
 */
export async function encryptValue(tenantId: string, key: string, value: string): Promise<string> {
  return isSensitiveKey(key) ? tenantKeys.encryptOpt(tenantId, value) : value;
}

/**
 * The stored value of `key` read in the context of `tenantId`. Keeps the legacy fallback of the node-key reader: a sensitive value that does not
 * open (counted with its reason) answers the stored text itself, an envelope, never another tenant's plaintext.
 */
export async function decryptValue(tenantId: string, key: string, value: string): Promise<string> {
  if (!isSensitiveKey(key)) return value;
  return (await tenantKeys.decryptOpt(tenantId, value)) ?? value;
}

const MASK = '***SET***';

function maskValue(key: string, value: string): string {
  if (!isSensitiveKey(key)) return value;
  return isEncryptedField(value) || value ? MASK : value;
}

/** A stored row as the API shape. A masked read never decrypts: the mask only says whether a sensitive value is set. */
export async function parseRow(row: SettingEntity, masked = false): Promise<Setting> {
  const value = masked ? maskValue(row.key, row.value) : await decryptValue(row.tenantId, row.key, row.value);
  return SettingSchema.parse({ ...row, value });
}

export function parseRows(rows: SettingEntity[], masked = false): Promise<Setting[]> {
  return Promise.all(rows.map((r) => parseRow(r, masked)));
}
