import { FIELD_ENVELOPE_PATTERN, encryptFieldOpt, isFieldEnvelope } from '@kuraykaraaslan-labs/common/server/field-encryption';

/**
 * The data migration that brings a column under field encryption at rest (P9-6): every stored value that is not yet a field-encryption
 * envelope is encrypted in place under this node's key. The owning module declares the column with `encryptedColumnTransformer`
 * (common/server/field-encryption.ts), which encrypts every new write and reads old plaintext rows unchanged (dual read); this pass converts the
 * rows written before that, so the node judge `secrets.no_plaintext_columns` can PASS.
 *
 * Idempotent and prefix detecting: a value that already has the envelope shape is never touched, so a rerun writes nothing, and a row the
 * application rewrote in between (it is encrypted by then) is left alone because every UPDATE is guarded on the exact value that was read.
 * Batched by key (keyset pagination, `batchSize` rows per transaction) so a large table is never locked as a whole: the pass runs online.
 *
 * Takes a `batch` runner instead of a DataSource so the caller decides the scope: a deploy step runs each batch in a transaction with RLS
 * bypassed (`systemBatchesOn`), a test hands a plain client. Never logs or returns a value.
 */

export interface EncryptedColumnTable {
  /** Table name (unquoted, resolved on the connection's search_path). */
  table: string;
  /** Its primary key column. */
  idColumn: string;
  /** The columns that hold field-encrypted values. */
  columns: readonly string[];
}

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** Runs `fn` as one unit of work (one transaction) and returns its result. */
export type BatchRunner = <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;

export interface EncryptedColumnsReport {
  /** Why nothing was done, or null when the pass ran. */
  skipped: 'no-key' | null;
  /** Per `table.column`: values that were plaintext when read, and how many of them are now envelopes. A missing column reports 0/0. */
  columns: Record<string, { pending: number; encrypted: number }>;
}

/** The envelope shape in PostgreSQL regex syntax (v1 and v2); the very pattern of `isFieldEnvelope`. */
export const ENVELOPE_SQL_RE = FIELD_ENVELOPE_PATTERN;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] } | null)?.rows ?? [])) as Record<string, unknown>[];

/** The default encryptor: an envelope under SETTINGS_ENCRYPTION_KEY, or null when no key is configured (the value then stays as it is). */
export function encryptWithNodeKey(plaintext: string): string | null {
  const out = encryptFieldOpt(plaintext);
  return isFieldEnvelope(out) ? out : null;
}

export async function encryptPlaintextColumns(
  batch: BatchRunner,
  spec: EncryptedColumnTable,
  opts: { encrypt?: (plaintext: string) => string | null; batchSize?: number } = {},
): Promise<EncryptedColumnsReport> {
  const encrypt = opts.encrypt ?? encryptWithNodeKey;
  const batchSize = opts.batchSize ?? 500;
  const columns: EncryptedColumnsReport['columns'] = {};
  for (const c of spec.columns) columns[`${spec.table}.${c}`] = { pending: 0, encrypted: 0 };
  // Without a key every value would stay plaintext; say so once instead of reading the table.
  if (encrypt('probe') === null) return { skipped: 'no-key', columns };

  const present = await batch(async (q) => rowsOf(await q.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = ANY($2::text[])`,
    [spec.table, [...spec.columns]],
  )).map((r) => String(r.column_name)));

  const rel = ident(spec.table);
  const id = ident(spec.idColumn);
  for (const column of spec.columns) {
    if (!present.includes(column)) continue;
    const col = ident(column);
    const counts = columns[`${spec.table}.${column}`];
    let after: string | null = null;
    for (;;) {
      const done: boolean = await batch(async (q) => {
        const rows = rowsOf(await q.query(
          `SELECT ${id}::text AS id, ${col} AS value FROM ${rel}
            WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} !~ $1 AND ($2::text IS NULL OR ${id}::text > $2)
            ORDER BY ${id}::text LIMIT ${Math.max(1, Math.floor(batchSize))}`,
          [ENVELOPE_SQL_RE, after],
        )) as { id: string; value: string }[];
        for (const row of rows) {
          counts.pending++;
          const envelope = encrypt(row.value);
          if (envelope === null) continue;
          // Counted through a SELECT over the UPDATE: a TypeORM manager returns `[rows, affected]` for a bare UPDATE ... RETURNING (which
          // counted every row twice), a pg client returns a result object; a SELECT is an array of rows on both.
          const updated = rowsOf(await q.query(
            `WITH u AS (UPDATE ${rel} SET ${col} = $2 WHERE ${id}::text = $1 AND ${col} = $3 RETURNING 1) SELECT count(*)::int AS n FROM u`,
            [row.id, envelope, row.value],
          ));
          counts.encrypted += Number(updated[0]?.n ?? 0);
        }
        if (rows.length > 0) after = rows[rows.length - 1].id;
        return rows.length < batchSize;
      });
      if (done) break;
    }
  }
  return { skipped: null, columns };
}

/** A runner for a deploy step: each batch is one transaction on `ds` with RLS bypassed for it alone (`SET LOCAL`, as `withSystemRLS`). */
export function systemBatchesOn(ds: { transaction<T>(fn: (manager: Queryable) => Promise<T>): Promise<T> }): BatchRunner {
  return (fn) => ds.transaction(async (manager) => {
    await manager.query("SET LOCAL app.bypass_rls = 'on'");
    return fn(manager);
  });
}

/** One line for the deploy log: counts only. */
export function describeEncryptedColumnsReport(report: EncryptedColumnsReport): string {
  if (report.skipped === 'no-key') return 'SETTINGS_ENCRYPTION_KEY not configured: secrets stay in clear';
  return Object.entries(report.columns).map(([k, v]) => `${k} ${v.encrypted}/${v.pending} encrypted`).join(', ');
}
