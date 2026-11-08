import type { TenantKeyColumnSet } from '@kuraykaraaslan-labs/db/server/db.tenant-key-columns';
import { SETTING_KEYS_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';
import { SENSITIVE_KEYS, SENSITIVE_KEY_PREFIXES, isSensitiveKey } from './tenant_setting.validation';

/**
 * 04-tenant-setting 2.1: every key `isSensitiveKey` seals: the listed keys plus every declared key of a credential family, and the family prefixes
 * for a member built at run time (`ssoClientSecret:<provider>`), so the backfill seals a legacy plain row of it and the judge counts one.
 */
const SENSITIVE = [...new Set([...SENSITIVE_KEYS, ...Object.values(SETTING_KEYS_BY_MODULE).flat().filter(isSensitiveKey)])].sort();
const SENSITIVE_PREFIXES = [...SENSITIVE_KEY_PREFIXES].sort();
const ROW_FILTER = { column: 'key', values: SENSITIVE, prefixes: SENSITIVE_PREFIXES };

/**
 * tenant_setting's columns under the tenant's data key (P7-TDEK, decision F16; point `db:tenant_key_columns`): the value of a sensitive
 * setting (`isSensitiveKey`), in the live table and in its change history (both store the value as tenant_setting.crypto.ts `encryptValue` seals it). The row filter
 * keeps every other setting out: an ordinary value is plain configuration. Plugin secrets (`plugin_secret:<pluginId>:<key>`) are sealed by
 * plugin_runtime under the node key and stay outside F16's initial set.
 */
export const TENANT_KEY_COLUMNS: TenantKeyColumnSet[] = [
  { table: 'settings', idColumn: 'key', columns: ['value'], rowFilter: ROW_FILTER, family: 'secret credentials in tenant settings' },
  { table: 'setting_history', idColumn: 'historyId', columns: ['previousValue', 'newValue'], rowFilter: ROW_FILTER, family: 'secret credentials in tenant setting history' },
];

export default TENANT_KEY_COLUMNS;
