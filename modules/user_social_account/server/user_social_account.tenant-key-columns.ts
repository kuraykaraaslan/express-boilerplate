import type { TenantKeyColumnSet } from '@kuraykaraaslan-labs/db/server/db.tenant-key-columns';

/**
 * user_social_account's columns under a data key (point `db:tenant_key_columns`, decision F27 of docs/phases/02-fleet/decisions-2026-10-18.md): the
 * OAuth access and refresh tokens of a linked identity, sealed under the row USER's per-user key (`keyScope: 'user'`, db.user-keys.service.ts) by
 * user_social_account.token.service.ts and .link.service.ts. The table is user-level (no tenant column): a person's tokens belong to no workspace.
 */
export const TENANT_KEY_COLUMNS: TenantKeyColumnSet[] = [
  { table: 'user_social_accounts', idColumn: 'userSocialAccountId', keyScope: 'user', columns: ['accessToken', 'refreshToken'], family: 'OAuth tokens of a person\'s linked social identities' },
];

export default TENANT_KEY_COLUMNS;
