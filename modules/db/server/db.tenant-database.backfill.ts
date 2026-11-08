import { decryptField } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { encryptTenantDatabaseUrlOrNull } from './db.tenant-database.url';

/**
 * The TypeScript half of the `tenant_databases` EXPAND migration (the SQL half only adds the columns): fill
 * `databaseUrlEnc` from the plaintext `databaseUrl` of every row that has none. Run by the deploy pipeline under the
 * deploy lock, so it is idempotent and safe to repeat; the plaintext column is left alone (N-1 code reads it) on the `single`
 * role, and cleared on the fleet roles by `clearPlaintextTenantDatabaseUrls` once its ciphertext is proven to open to it.
 *
 * Takes a minimal `query` interface (a `pg` client) and an injectable `encrypt` so it is testable without a database.
 */

export interface BackfillQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface BackfillReport {
  /** Why nothing was done, or null when the pass ran. */
  skipped: 'no-table' | 'no-column' | 'no-key' | null;
  /** Rows that still had no ciphertext when the pass started. */
  pending: number;
  /** Rows that now have one. */
  encrypted: number;
}

export async function backfillTenantDatabaseUrls(
  db: BackfillQueryable,
  encrypt: (url: string) => string | null = encryptTenantDatabaseUrlOrNull,
): Promise<BackfillReport> {
  // A fleet node on `migrate` mode before the baseline migration has no such table yet; nothing to do then.
  const table = await db.query(`SELECT to_regclass('tenant_databases') IS NOT NULL AS present`);
  if ((table.rows[0] as { present?: boolean } | undefined)?.present !== true) return { skipped: 'no-table', pending: 0, encrypted: 0 };

  // db.02: once the plaintext column is dropped there is nothing to backfill from.
  if (!(await hasPlaintextColumn(db))) return { skipped: 'no-column', pending: 0, encrypted: 0 };

  // Without a key every row would stay plaintext-only; say so once instead of reading the table.
  if (encrypt('probe') === null) return { skipped: 'no-key', pending: 0, encrypted: 0 };

  const { rows } = await db.query(
    `SELECT "tenantId", "databaseUrl" FROM tenant_databases
     WHERE "databaseUrlEnc" IS NULL AND "databaseUrl" IS NOT NULL AND "databaseUrl" <> '' ORDER BY "tenantId"`,
  );
  let encrypted = 0;
  for (const row of rows as Array<{ tenantId: string; databaseUrl: string }>) {
    const ciphertext = encrypt(row.databaseUrl);
    if (ciphertext === null) continue;
    // Guarded on the value that was read: a URL changed in between keeps its newer plaintext and is picked up next run.
    const result = await db.query(
      `UPDATE tenant_databases SET "databaseUrlEnc" = $2
       WHERE "tenantId" = $1 AND "databaseUrlEnc" IS NULL AND "databaseUrl" = $3 RETURNING "tenantId"`,
      [row.tenantId, ciphertext, row.databaseUrl],
    );
    encrypted += result.rows.length;
  }
  return { skipped: null, pending: rows.length, encrypted };
}

export interface ClearPlaintextReport {
  skipped: 'no-table' | 'no-column' | null;
  /** Rows that had both columns when the pass started. */
  candidates: number;
  /** Rows whose plaintext is now NULL. */
  cleared: number;
  /** Rows kept as they were: the ciphertext does not open here, or opens to another URL (the next run tries again). */
  kept: number;
}

function openOrNull(ciphertext: string): string | null {
  try { return decryptField(ciphertext); } catch { return null; }
}

/**
 * The fleet roles' half of P9-6 (`secrets.no_plaintext_columns` reads `tenant_databases.databaseUrl`): NULL the plaintext DSN of every row
 * whose `databaseUrlEnc` opens, with this deployment's key, to exactly that DSN. Nothing is lost (the ciphertext holds the same value and
 * every reader prefers it) and the column itself stays, so this is a data step of the expand phase, not the contract migration that
 * drops the column on every role. A row whose ciphertext does not open here or disagrees with the plaintext is never touched: the
 * plaintext is then the only copy anyone can read. Each UPDATE is guarded on both values read, so a row rewritten in between is left
 * for the next run. Run by the deploy pipeline after `backfillTenantDatabaseUrls`, on `FLEET_ROLE=node|fleet` only (the caller decides).
 */
export async function clearPlaintextTenantDatabaseUrls(
  db: BackfillQueryable,
  decrypt: (ciphertext: string) => string | null = openOrNull,
): Promise<ClearPlaintextReport> {
  const table = await db.query(`SELECT to_regclass('tenant_databases') IS NOT NULL AS present`);
  if ((table.rows[0] as { present?: boolean } | undefined)?.present !== true) return { skipped: 'no-table', candidates: 0, cleared: 0, kept: 0 };
  if (!(await hasPlaintextColumn(db))) return { skipped: 'no-column', candidates: 0, cleared: 0, kept: 0 };
  const { rows } = await db.query(
    `SELECT "tenantId", "databaseUrl", "databaseUrlEnc" FROM tenant_databases
     WHERE "databaseUrl" IS NOT NULL AND "databaseUrl" <> '' AND "databaseUrlEnc" IS NOT NULL AND "databaseUrlEnc" <> '' ORDER BY "tenantId"`,
  );
  let cleared = 0;
  let kept = 0;
  for (const row of rows as Array<{ tenantId: string; databaseUrl: string; databaseUrlEnc: string }>) {
    if (decrypt(row.databaseUrlEnc) !== row.databaseUrl) { kept += 1; continue; }
    const result = await db.query(
      `UPDATE tenant_databases SET "databaseUrl" = NULL
       WHERE "tenantId" = $1 AND "databaseUrl" = $2 AND "databaseUrlEnc" = $3 RETURNING "tenantId"`,
      [row.tenantId, row.databaseUrl, row.databaseUrlEnc],
    );
    if (result.rows.length > 0) cleared += 1; else kept += 1;
  }
  return { skipped: null, candidates: rows.length, cleared, kept };
}

/** Whether `tenant_databases` still has the plaintext `databaseUrl` column (db.02 drops it). */
export async function hasPlaintextColumn(db: BackfillQueryable): Promise<boolean> {
  return hasColumn(db, 'databaseUrl');
}

/** Whether `tenant_databases` has the column (`databaseUrl` before db.02's drop, `databaseUrlEnc` since the expand). */
async function hasColumn(db: BackfillQueryable, column: string): Promise<boolean> {
  // The columns of the table the search path resolves (to_regclass), not of any `tenant_databases` on the path: with
  // `SET search_path TO <schema>, public` a newer public table answered for an older one in <schema>.
  const { rows } = await db.query(
    `SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('tenant_databases') AND attname = $1 AND attnum > 0 AND NOT attisdropped LIMIT 1`,
    [column],
  );
  return rows.length > 0;
}

/**
 * db.02 (decided 2026-10-21: drop the plaintext in this release, no one-release staging): the step the deploy runs BEFORE the
 * schema step. It backfills every row's ciphertext; with `refuse` (synchronize mode, where the entity sync drops the plaintext
 * column in the very next step) it also adds the ciphertext column first when the table predates it, and throws, stopping the
 * deploy before any schema change, while a row still has a plaintext DSN and no ciphertext: dropping the column then would lose
 * that tenant's database address. In migrate mode the contract migration 007 makes the same refusal in SQL. Rows with neither
 * column set are already unroutable and do not block. A no-op once the column is gone or before the table exists.
 */
export async function assertPlaintextDropSafe(
  db: BackfillQueryable,
  encrypt: (url: string) => string | null = encryptTenantDatabaseUrlOrNull,
  opts: { refuse?: boolean } = { refuse: true },
): Promise<{ backfilled: number }> {
  const table = await db.query(`SELECT to_regclass('tenant_databases') IS NOT NULL AS present`);
  if ((table.rows[0] as { present?: boolean } | undefined)?.present !== true) return { backfilled: 0 };
  if (!(await hasPlaintextColumn(db))) return { backfilled: 0 };
  if (!(await hasColumn(db, 'databaseUrlEnc'))) {
    // A table from before the expand migration: in migrate mode the expand runs next and the drop is a later contract step.
    if (!opts.refuse) return { backfilled: 0 };
    await db.query('ALTER TABLE tenant_databases ADD COLUMN IF NOT EXISTS "databaseUrlEnc" text');
  }
  const report = await backfillTenantDatabaseUrls(db, encrypt);
  if (!opts.refuse) return { backfilled: report.encrypted };
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM tenant_databases WHERE "databaseUrlEnc" IS NULL AND "databaseUrl" IS NOT NULL AND "databaseUrl" <> ''`,
  );
  const left = Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
  if (left > 0) {
    throw new Error(
      `[db-deploy] db.02: ${left} tenant database URL(s) have no ciphertext${report.skipped === 'no-key' ? ' (SETTINGS_ENCRYPTION_KEY is not configured)' : ''}; `
      + 'the plaintext column cannot be dropped. Configure the key and deploy again.',
    );
  }
  // The has-url CHECK still names the plaintext column ("databaseUrl" IS NOT NULL OR ...). TypeORM compares checks by NAME, so the sync
  // that follows keeps it as is, then drops the column, and PostgreSQL drops the CHECK with it: the table ended with no has-url CHECK at
  // all (integration lane 2). Rewritten first to the entity's ciphertext-only shape, exactly as contract migration 007 does (NOT VALID
  // there and here: a legacy row with an empty plaintext and no ciphertext is not re-checked; every new write is).
  await db.query('ALTER TABLE tenant_databases DROP CONSTRAINT IF EXISTS "ck_tenant_databases_has_url"');
  await db.query('ALTER TABLE tenant_databases ADD CONSTRAINT "ck_tenant_databases_has_url" CHECK ("databaseUrlEnc" IS NOT NULL) NOT VALID');
  return { backfilled: report.encrypted };
}
