import Logger from '@kuraykaraaslan-labs/logger';

/**
 * The declaration point of the columns a tenant data key protects (P7-TDEK, decision F16 of docs/phases/02-fleet/decisions-2026-10-18.md).
 *
 * `db:tenant_key_columns` (catalog): the module that owns a table contributes, next to its entity and in the same commit as the code that encrypts
 * the columns under the tenant's key, a default export `TENANT_KEY_COLUMNS: TenantKeyColumnSet[]`. db resolves the point and never imports the owner.
 * The declarations drive the online re-encryption backfill (F17), the `encryption.tdek_enabled` judge and the deletion receipt's list of
 * key-protected families; the ratchet test (db.tenant-key-columns.ratchet.test.ts) requires every secret- or special-category-patterned column of a
 * tenant-scoped table to be declared or explicitly waived.
 *
 * User scope (decision F27): a user-level table (keyed on `userId`, no tenant column: `user_social_accounts`, `user_securities`) declares its columns
 * on the same point with `keyScope: 'user'`: they are sealed under the row user's per-user data key (db.user-keys.service.ts) instead, moved by the
 * same backfill and counted by the same judge; the ratchet covers the user-level tables the same way.
 */
export const TENANT_KEY_COLUMNS_POINT = 'db:tenant_key_columns';

export interface TenantKeyColumnSet {
  /** The table (`@Entity` name). Tenant-scoped (`tenantColumn` names whose key encrypts each row), or user-level with `keyScope: 'user'`. */
  table: string;
  /** Its primary key column (keyset pagination of the backfill). */
  idColumn: string;
  /** Whose data key seals the columns: the row tenant's (default) or the row user's (F27: `userColumn`, a person's secrets on a user-level table). */
  keyScope?: 'tenant' | 'user';
  /** The column naming the row's tenant; default `tenantId`. Tenant scope only. */
  tenantColumn?: string;
  /** The column naming the row's user; default `userId`. User scope only. */
  userColumn?: string;
  /** The text columns that hold field-encryption envelopes under the tenant's key. */
  columns: string[];
  /**
   * Only rows whose `column` is one of `values` hold a protected value (a key-value table such as `settings`). `prefixes` adds the members of a
   * family named at run time (`ssoClientSecret:<provider>`): a value that starts with a prefix and is longer than it (04-tenant-setting 2.1).
   */
  rowFilter?: { column: string; values: string[]; prefixes?: string[] };
  /** What the columns hold, for the deletion receipt and the RoPA (a category, never a value). */
  family: string;
  /**
   * Companion blind-index columns (`tenantKeys.blindIndex(tenantId, purpose, normaliseBlindIndexValue(plaintext of `of`))`): the backfill fills
   * `column` when it seals `of`, so a row moved by the backfill is found by value exactly like a row written by its owner.
   */
  blindIndexes?: Array<{ column: string; of: string; purpose: string }>;
  /** Stored markers that are not a protected value (a scrubbed `[redacted]`): the backfill leaves them as they are. */
  skipValues?: string[];
}

/** The column naming whose key seals a set's rows: the tenant column, or the user column of a user-scope set (F27). */
export function keyOwnerColumn(set: Pick<TenantKeyColumnSet, 'keyScope' | 'tenantColumn' | 'userColumn'>): string {
  return set.keyScope === 'user' ? (set.userColumn ?? 'userId') : (set.tenantColumn ?? 'tenantId');
}

/** The kid prefix of a set's own data keys: `tdek-` (tenant) or `udek-` (user, F27). */
export function keyKidPrefix(set: Pick<TenantKeyColumnSet, 'keyScope'>): 'tdek-' | 'udek-' {
  return set.keyScope === 'user' ? 'udek-' : 'tdek-';
}

/** A LIKE pattern for the values longer than `prefix` that start with it: a backslash, `%` and `_` in the prefix match only themselves (2.1). */
export const prefixLikePattern = (prefix: string): string => `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}_%`;

/**
 * The SQL of a set's row filter (04-tenant-setting 2.1), appended to a WHERE: ` AND (col = ANY($n::text[]) OR col LIKE ANY($m::text[]))`, the
 * second half only with `prefixes`. `bind` adds a parameter and returns its placeholder. The backfill and the coverage judge must agree on it.
 */
export function rowFilterSql(filter: NonNullable<TenantKeyColumnSet['rowFilter']>, bind: (value: unknown) => string): string {
  const col = `"${filter.column.replace(/"/g, '""')}"`;
  const exact = `${col} = ANY(${bind(filter.values)}::text[])`;
  if (!filter.prefixes?.length) return ` AND ${exact}`;
  return ` AND (${exact} OR ${col} LIKE ANY(${bind(filter.prefixes.map(prefixLikePattern))}::text[]))`;
}

/** The one normalisation every blind index is computed over (owner writes, lookups and the backfill must agree). */
export const normaliseBlindIndexValue = (value: string): string => value.trim().toLowerCase();

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** Structural problems of one contribution's declarations; empty when they are well formed. */
export function validateTenantKeyColumnSets(sets: unknown): string[] {
  if (!Array.isArray(sets)) return ['TENANT_KEY_COLUMNS is not an array'];
  const errors: string[] = [];
  sets.forEach((raw, i) => {
    const s = raw as Partial<TenantKeyColumnSet> | null;
    const at = `[${i}]${s && typeof s.table === 'string' ? ` ${s.table}` : ''}`;
    if (!s || typeof s !== 'object') { errors.push(`${at}: not an object`); return; }
    if (typeof s.table !== 'string' || !IDENT.test(s.table)) errors.push(`${at}: table is not an identifier`);
    if (typeof s.idColumn !== 'string' || !IDENT.test(s.idColumn)) errors.push(`${at}: idColumn is not an identifier`);
    if (s.keyScope !== undefined && s.keyScope !== 'tenant' && s.keyScope !== 'user') errors.push(`${at}: keyScope is 'tenant' or 'user'`);
    if (s.tenantColumn !== undefined && (typeof s.tenantColumn !== 'string' || !IDENT.test(s.tenantColumn))) errors.push(`${at}: tenantColumn is not an identifier`);
    if (s.userColumn !== undefined && (typeof s.userColumn !== 'string' || !IDENT.test(s.userColumn))) errors.push(`${at}: userColumn is not an identifier`);
    if (s.keyScope === 'user' && s.tenantColumn !== undefined) errors.push(`${at}: a user-scope set names no tenantColumn`);
    if (s.keyScope !== 'user' && s.userColumn !== undefined) errors.push(`${at}: userColumn needs keyScope 'user'`);
    if (s.keyScope === 'user' && s.blindIndexes !== undefined) errors.push(`${at}: blind indexes are tenant scope only`);
    if (!Array.isArray(s.columns) || s.columns.length === 0 || !s.columns.every((c) => typeof c === 'string' && IDENT.test(c))) errors.push(`${at}: columns must be a non-empty list of identifiers`);
    else if (new Set(s.columns).size !== s.columns.length) errors.push(`${at}: a column is listed twice`);
    if (s.rowFilter !== undefined) {
      const f = s.rowFilter as { column?: unknown; values?: unknown };
      if (typeof f.column !== 'string' || !IDENT.test(f.column) || !Array.isArray(f.values) || f.values.length === 0 || !f.values.every((v) => typeof v === 'string' && v.length > 0)) {
        errors.push(`${at}: rowFilter needs a column and a non-empty list of values`);
      }
      const p = (s.rowFilter as { prefixes?: unknown }).prefixes;
      if (p !== undefined && (!Array.isArray(p) || p.length === 0 || !p.every((v) => typeof v === 'string' && v.length > 0))) {
        errors.push(`${at}: rowFilter prefixes must be a non-empty list of non-empty strings`);
      }
    }
    if (typeof s.family !== 'string' || s.family.trim().length < 3) errors.push(`${at}: family must say what the columns hold`);
    if (s.blindIndexes !== undefined) {
      const ok = Array.isArray(s.blindIndexes) && s.blindIndexes.every((b) => !!b && typeof b === 'object'
        && typeof b.column === 'string' && IDENT.test(b.column) && typeof b.of === 'string' && Array.isArray(s.columns) && s.columns.includes(b.of)
        && typeof b.purpose === 'string' && /^[a-z0-9.:_-]{1,64}$/.test(b.purpose) && !s.columns.includes(b.column));
      if (!ok) errors.push(`${at}: blindIndexes need a column outside columns, the declared column it indexes and a purpose`);
    }
    if (s.skipValues !== undefined && (!Array.isArray(s.skipValues) || s.skipValues.length === 0 || !s.skipValues.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 64))) {
      errors.push(`${at}: skipValues must be a non-empty list of short markers`);
    }
  });
  return errors;
}

/**
 * Column names that hold a secret or a special-category personal value, and so must be declared (encrypted under the tenant's key) or waived with
 * a reason. Deliberately narrower than "personal data": names, e-mail addresses and phone numbers of ordinary business rows are covered by retention
 * and erasure, not by the key (docs/phases/02-fleet/99-progress, open point 6: "TDEK covers declared columns only"). Only TEXT-like columns are
 * candidates (an envelope is a string): a date of birth or a salary stored as a date or a number is outside what field encryption can hold.
 */
export const SECRET_COLUMN_RE = /(secret|token|password|passwd|private_?key|api_?key|credential|totp|otp_?seed|signing_?key)/i;
export const SPECIAL_CATEGORY_COLUMN_RE = /(national_?id|identity_?number|tckn|iban|bank_?account|account_?number|passport|tax_?(id|number)|ssn|social_?security|date_?of_?birth|birth_?date|salary|medical|health|disability|recipient)/i;
/**
 * Names that match a pattern but hold no secret: a hash, a last-four, an expiry, a type, a count or a plural count (`inputTokens`), a foreign id, a
 * flag, a country, the NAME of the setting or the URL where a secret lives. A tax or national id ends in `Id` but is a value, not a foreign key.
 */
export const NOT_SENSITIVE_COLUMN_RE = /(hash|digest|fingerprint|prefix|last_?4|last_?four|hint|expires|expiry|policy|reference)/i;
const NOT_SENSITIVE_SUFFIX_RE = /(^type$|Type$|Kind$|At$|Count$|(^t|T)okens$|Enabled$|Required$|Verified$|Version$|Ref$|Url$|Status$|Method$|Provider$|Scopes?$|Length$|Name$|Country$|SettingKey$|^is[A-Z]|^has[A-Z])/;
const FOREIGN_ID_RE = /(Id|Ids|_id)$/;
const VALUE_ID_RE = /(tax_?id|national_?id)$/i;
/** A column that already holds an envelope by naming convention (`nationalIdEnc`). */
export const ENCRYPTED_NAME_RE = /(Enc|Encrypted|_enc)$/;

export function isSensitiveColumnName(column: string): boolean {
  if (ENCRYPTED_NAME_RE.test(column)) return true;
  if (!SECRET_COLUMN_RE.test(column) && !SPECIAL_CATEGORY_COLUMN_RE.test(column)) return false;
  if (FOREIGN_ID_RE.test(column) && !VALUE_ID_RE.test(column)) return false;
  return !NOT_SENSITIVE_COLUMN_RE.test(column) && !NOT_SENSITIVE_SUFFIX_RE.test(column);
}

/** The column types an envelope fits in (TypeORM `type` names; an undeclared type of a `string` property counts as text). */
export const TEXT_COLUMN_TYPES: ReadonlySet<string> = new Set(['varchar', 'character varying', 'text', 'char', 'character', 'citext', 'json', 'jsonb', 'string']);

/** A column of a tenant-scoped or user-level table, as the ratchet sees it. */
export interface ColumnFact { table: string; column: string }

/**
 * The ratchet's verdict over the columns of the tenant-scoped tables (`columns`) and their sensitive-patterned text columns (`candidates`):
 * candidates neither declared nor waived, waivers that name no candidate any more (stale: remove them), declarations of a column no tenant-scoped
 * table has, and columns both declared and waived. A declared column need not match a pattern (`settings.value` holds secrets only for some keys).
 */
export function tenantKeyColumnCoverage(
  columns: readonly ColumnFact[], candidates: readonly ColumnFact[], declared: readonly TenantKeyColumnSet[], waived: Readonly<Record<string, string>>,
): { undeclared: string[]; staleWaivers: string[]; unknownDeclared: string[]; declaredAndWaived: string[] } {
  const key = (t: string, c: string) => `${t}.${c}`;
  const all = new Set(columns.map((c) => key(c.table, c.column)));
  const cand = new Set(candidates.map((c) => key(c.table, c.column)));
  const decl = new Set(declared.flatMap((s) => s.columns.map((c) => key(s.table, c))));
  const waivers = Object.keys(waived);
  return {
    undeclared: [...cand].filter((k) => !decl.has(k) && !(k in waived)).sort(),
    staleWaivers: waivers.filter((k) => !cand.has(k)).sort(),
    unknownDeclared: [...decl].filter((k) => !all.has(k)).sort(),
    declaredAndWaived: [...decl].filter((k) => k in waived).sort(),
  };
}

/**
 * Every contribution to `db:tenant_key_columns` through the host runtime. The declarations describe the schema, not a tenant's data, so every
 * installed contribution counts. A contribution that fails to load or declares malformed sets is logged and left out (the backfill and the judge
 * then do not see its columns; the ratchet test catches a malformed declaration before release).
 */
export async function loadTenantKeyColumns(): Promise<TenantKeyColumnSet[]> {
  const { ext, systemCtx } = await import('@kuraykaraaslan-labs/common/server/extensions/ext');
  const { dbTenantKeyColumnsLoaders } = await import('@kuraykaraaslan-labs/common/server/generated/extensions/db.tenant_key_columns');
  const { loaded, failed } = await ext.loadAll<TenantKeyColumnSet[] | { TENANT_KEY_COLUMNS?: TenantKeyColumnSet[] }>(
    TENANT_KEY_COLUMNS_POINT, systemCtx('tenant key columns: database schema, every tenant'), dbTenantKeyColumnsLoaders,
  );
  for (const f of failed) Logger.error(`[tenant-keys] failed to load '${f.contributionId}': ${f.reason}: ${f.message}`);
  const out: TenantKeyColumnSet[] = [];
  for (const { contribution, impl } of loaded) {
    const sets = Array.isArray(impl) ? impl : impl?.TENANT_KEY_COLUMNS;
    const errors = validateTenantKeyColumnSets(sets);
    if (errors.length) { Logger.error(`[tenant-keys] '${contribution.id}' declares malformed TENANT_KEY_COLUMNS; skipped: ${errors.join('; ')}`); continue; }
    out.push(...(sets as TenantKeyColumnSet[]));
  }
  return out;
}
