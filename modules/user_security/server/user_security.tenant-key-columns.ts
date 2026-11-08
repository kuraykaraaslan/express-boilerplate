import type { TenantKeyColumnSet } from '@kuraykaraaslan-labs/db/server/db.tenant-key-columns';

/**
 * user_security's columns under a data key (point `db:tenant_key_columns`, decision F27 of docs/phases/02-fleet/decisions-2026-10-18.md): the auth
 * TOTP secret, sealed under the row USER's per-user key (`keyScope: 'user'`, db.user-keys.service.ts) by user_security.helpers.ts `encryptWrite`.
 * The table is user-level (keyed on `userId`): a person's second factor belongs to no workspace.
 */
export const TENANT_KEY_COLUMNS: TenantKeyColumnSet[] = [
  { table: 'user_securities', idColumn: 'userSecurityId', keyScope: 'user', columns: ['otpSecret'], family: 'the TOTP secret of a person\'s second factor' },
];

export default TENANT_KEY_COLUMNS;
