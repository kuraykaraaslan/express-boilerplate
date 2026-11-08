import { decryptField, encryptFieldOpt, isEncryptedField } from '@kuraykaraaslan-labs/common/server/field-encryption';

/**
 * The DSN of a `tenant_databases` row. db.02 (contract, 2026-10-21): only the ciphertext `databaseUrlEnc` exists; there is no
 * plaintext fallback. Every reader goes through `resolveTenantDatabaseUrl`.
 *
 * Deliberately free of the logger and env modules: the deploy script imports it before any runtime configuration exists.
 */

export interface TenantDatabaseUrlSource {
  tenantId?: string;
  databaseUrlEnc?: string | null;
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The connection string of a row; a missing or unreadable ciphertext fails closed with the tenant id and no secret. */
export function resolveTenantDatabaseUrl(
  row: TenantDatabaseUrlSource,
  _warn: (message: string) => void = (message) => console.warn(message),
): string {
  const who = row.tenantId ? ` for tenant ${row.tenantId}` : '';
  if (!present(row.databaseUrlEnc)) throw new Error(`[tenant-database] the registry row${who} has no database URL`);
  let url: string | null = null;
  try { url = decryptField(row.databaseUrlEnc); } catch { /* handled below */ }
  if (!present(url)) throw new Error(`[tenant-database] the encrypted database URL${who} cannot be read (missing or rotated SETTINGS_ENCRYPTION_KEY?)`);
  return url;
}

/**
 * The value for `databaseUrlEnc`. db.02: a DSN is never stored in the clear, so without a configured `SETTINGS_ENCRYPTION_KEY`
 * this throws (a dedicated database cannot be registered without the key). A malformed configured key throws too.
 */
export function encryptTenantDatabaseUrl(url: string): string {
  const out = encryptFieldOpt(url);
  if (!isEncryptedField(out) || out === url) {
    throw new Error('[tenant-database] SETTINGS_ENCRYPTION_KEY is required to store a tenant database URL (it is kept encrypted only)');
  }
  return out;
}

/** The backfill's variant: null instead of throwing when no key is configured (the deploy then refuses, see the backfill). */
export function encryptTenantDatabaseUrlOrNull(url: string): string | null {
  try { return encryptTenantDatabaseUrl(url); } catch { return null; }
}

/**
 * Whether this deployment keeps only the ciphertext of a tenant database URL: the fleet roles (`FLEET_ROLE=node|fleet`, P9-6). Their env
 * refuses to boot without `SETTINGS_ENCRYPTION_KEY`, and no fleet-role release ever read the plaintext column alone (the readers that prefer
 * `databaseUrlEnc` shipped with the expand migration, before any fleet node was released), so nothing there needs the plaintext copy. The
 * db.02 (2026-10-21) made every role ciphertext-only; this predicate stays for the callers that still branch on it.
 * The caller passes the role (the deploy script reads its environment directly, the runtime its validated `env`): this file stays free of
 * the env module.
 */
export function ciphertextOnlyRole(role: string | undefined): boolean {
  return role === 'node' || role === 'fleet';
}
