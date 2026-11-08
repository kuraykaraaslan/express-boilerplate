import { FieldDecryptError } from '@kuraykaraaslan-labs/common/server/field-encryption';
import type { BatchRunner } from './db.encrypted-columns';
import { keyKidPrefix, keyOwnerColumn, normaliseBlindIndexValue, rowFilterSql, type TenantKeyColumnSet } from './db.tenant-key-columns';

/**
 * The online re-encryption backfill of the declared tenant-key columns (P7-TDEK, decision F17 of docs/phases/02-fleet/decisions-2026-10-18.md:
 * always online, dual read, batched and throttled, whatever the node size).
 *
 * For every column declared on `db:tenant_key_columns`, every stored value that is not yet under a tenant data key (a legacy plaintext, a v1
 * envelope or a v2 envelope under the node key) is opened in its row tenant's context (the key service's dual read) and sealed again under that
 * tenant's ACTIVE key; a declared companion blind index (`blindIndexes`) is filled from the same plaintext with the same normalisation as the owner.
 * The owners' readers keep opening both shapes meanwhile, so nothing waits for the pass and nothing is ever offline.
 *
 *  - Batched and throttled: one page of `batchSize` rows is read in one short transaction, sealed with no transaction open (the key service may
 *    reach the control database and the key provider), and written back in another; `pauseMs` sleeps between pages.
 *  - Race-safe: every UPDATE is guarded on the exact value read, so a row the application rewrote meanwhile (it is sealed by then) is left alone
 *    and counted `raced`.
 *  - Idempotent and resumable: a value under a tenant key (`v2.tdek-…`) is never selected, so a rerun picks up only what is left. `budgetMs` stops a
 *    run between pages and returns the cursor, which the next run may pass back as `resume`.
 *  - Index-driven pages: the keyset compares the columns in their own types, never as text (an expression no index covers made every page a
 *    sequential scan and a sort of every unconverted row, O(N^2 / batchSize) per pass). When `idColumn` alone is unique (its primary key or a
 *    one-column unique index) the keyset is that column and every page is a range scan of its index that stops after one page of matches; otherwise
 *    (a key-value table such as `settings`, unique per tenant) it is (tenant, id), which the table's (tenant, id) unique index serves. A row that never
 *    converts (`unreadable`, `purged`) is therefore read once per pass, not once per page.
 *  - `tenantId` restricts a pass to one tenant (the purge seals a tenant's leftovers before its keys are destroyed, tenant.purge-keys.ts); `userId`
 *    restricts it to one user's rows of the user-scope sets (the erasure of a person does the same before their keys go, privacy.user-keys.ts).
 *  - What it does not convert: a declared marker (`skipValues`, such as a scrubbed `[redacted]`); a value that does not open (no node key for a v1 envelope, a damaged value, another tenant's envelope) stays as it
 *    is (`unreadable`); a row of a purged tenant stays as it is (`purged`: its key is gone for good, the purge deletes the row); a row whose tenant
 *    column is not a lower-case uuid (`invalid`). A database or key-store fault stops the run (thrown): the next run resumes.
 *  - User scope (decision F27): a set declared with `keyScope: 'user'` (a person's secrets on a user-level table) is moved the same way under its
 *    row USER's key (`userKeys`, db.user-keys.service.ts): the owner column is the set's user column, a value under a user key (`v2.udek-…`) is
 *    never selected, and a row of an erased user (its key destroyed for good) is counted `purged`. Without `userKeys` such a set is left alone.
 *  - Never logs or returns a value: counts only.
 */

export interface TenantKeyBackfillKeys {
  canEncrypt(): Promise<boolean>;
  decrypt(tenantId: string, value: string): Promise<string>;
  encrypt(tenantId: string, plaintext: string): Promise<string>;
  blindIndex(tenantId: string, purpose: string, value: string): Promise<string | null>;
}

/** The per-user keys (db.user-keys.service.ts) as the backfill needs them, for the user-scope sets (F27). */
export interface UserKeyBackfillKeys {
  decrypt(userId: string, value: string): Promise<string>;
  encrypt(userId: string, plaintext: string): Promise<string>;
}

/** `afterTenant` is the last row's key OWNER: its tenant, or its user for a user-scope set. */
export interface TenantKeyBackfillCursor { table: string; column: string; afterTenant: string; afterId: string }

export interface TenantKeyBackfillColumnReport { scanned: number; sealed: number; unreadable: number; purged: number; invalid: number; raced: number }

export interface TenantKeyBackfillReport {
  /** Why nothing was done (`no-key`: the node cannot hold tenant keys), or null when the pass ran. */
  skipped: 'no-key' | null;
  /** True when every declared column was scanned to its end in this run. */
  complete: boolean;
  /** Where a run cut by its budget stopped; pass it back as `resume`. Null when complete. */
  cursor: TenantKeyBackfillCursor | null;
  /** Per `table.column`. A table or column absent from this database reports zeros. */
  columns: Record<string, TenantKeyBackfillColumnReport>;
}

export interface TenantKeyBackfillOptions {
  batchSize?: number;
  /** Sleep between pages (throttle). Default 50 ms. */
  pauseMs?: number;
  /** Stop starting pages after this long; the report carries the cursor. Default: no budget. */
  budgetMs?: number;
  resume?: TenantKeyBackfillCursor | null;
  /** Only this tenant's rows (a lower-case uuid). The user-scope sets are left out: their rows belong to no tenant. */
  tenantId?: string;
  /** The per-user keys for the user-scope sets (F27); without them those sets are skipped (they report zeros). */
  userKeys?: UserKeyBackfillKeys;
  /**
   * Only this user's rows of the user-scope sets (a lower-case uuid); the tenant-scope sets are left out. The erasure of a person reseals their
   * leftovers under their key before it is destroyed (privacy.user-keys.ts, `resealUserKeyColumns`). Exclusive with `tenantId`.
   */
  userId?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The prefix of an envelope under a tenant data key: such a value is done (or belongs to its owner's reader) and is never touched. */
export const TENANT_ENVELOPE_PREFIX = 'v2.tdek-';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] } | null)?.rows ?? [])) as Record<string, unknown>[];
/** Whether `column` alone is unique in `table` (its primary key, or a one-column unique index without a predicate). */
async function idIsUnique(batch: BatchRunner, table: string, column: string): Promise<boolean> {
  return batch(async (q) => rowsOf(await q.query(
    `SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
       WHERE n.nspname = current_schema() AND c.relname = $1 AND i.indisunique AND i.indpred IS NULL AND i.indnkeyatts = 1 AND a.attname = $2) AS ok`,
    [table, column],
  ))[0]?.ok === true);
}

const isPurged = (e: unknown): boolean => (e as { name?: string; reason?: string } | null)?.name === 'TenantKeyUnavailableError'
  && ['PURGED', 'DESTROYED'].includes(String((e as { reason?: string }).reason));

export async function backfillTenantKeyColumns(
  batch: BatchRunner,
  sets: readonly TenantKeyColumnSet[],
  keys: TenantKeyBackfillKeys,
  opts: TenantKeyBackfillOptions = {},
): Promise<TenantKeyBackfillReport> {
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? 200));
  const pauseMs = Math.max(0, opts.pauseMs ?? 50);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  const columns: TenantKeyBackfillReport['columns'] = {};
  for (const s of sets) for (const c of s.columns) columns[`${s.table}.${c}`] = { scanned: 0, sealed: 0, unreadable: 0, purged: 0, invalid: 0, raced: 0 };
  if (opts.tenantId !== undefined && !UUID_RE.test(opts.tenantId)) throw new Error('tenant key backfill: tenantId must be a lower-case uuid');
  if (opts.userId !== undefined && (!UUID_RE.test(opts.userId) || opts.tenantId !== undefined)) {
    throw new Error('tenant key backfill: userId must be a lower-case uuid, and never together with tenantId');
  }
  if (!(await keys.canEncrypt())) return { skipped: 'no-key', complete: false, cursor: null, columns };

  // Resuming: the declarations before the cursor's column are done.
  let resume = opts.resume ?? null;
  let skipping = resume !== null;

  for (const set of sets) {
    const userScope = set.keyScope === 'user';
    const owner: TenantKeyBackfillKeys | UserKeyBackfillKeys | undefined = userScope ? opts.userKeys : keys;
    const tenantCol = keyOwnerColumn(set);
    const present = await batch(async (q) => rowsOf(await q.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [set.table],
    )).map((r) => String(r.column_name)));
    for (const column of set.columns) {
      if (skipping) {
        if (resume && resume.table === set.table && resume.column === column) skipping = false;
        else continue;
      }
      const needed = [column, tenantCol, set.idColumn, ...(set.rowFilter ? [set.rowFilter.column] : [])];
      const indexes = (set.blindIndexes ?? []).filter((b) => b.of === column && present.includes(b.column));
      if (!owner || (userScope && opts.tenantId !== undefined) || (!userScope && opts.userId !== undefined) || !needed.every((c) => present.includes(c))) continue;
      const counts = columns[`${set.table}.${column}`];
      const rel = ident(set.table); const col = ident(column); const tcol = ident(tenantCol); const id = ident(set.idColumn);
      // $1 is the envelope prefix; the filters follow, the keyset parameters come last
      const params: unknown[] = [`v2.${keyKidPrefix(set)}%`];
      const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
      let filter = '';
      if (opts.tenantId !== undefined) filter += ` AND ${tcol} = ${bind(opts.tenantId)}`;
      if (opts.userId !== undefined) filter += ` AND ${tcol} = ${bind(opts.userId)}`;
      if (set.rowFilter) filter += rowFilterSql(set.rowFilter, bind);   // 2.1: listed values and family prefixes
      if (set.skipValues?.length) filter += ` AND ${col} <> ALL(${bind(set.skipValues)}::text[])`;
      const byId = await idIsUnique(batch, set.table, set.idColumn);
      const fixed = params.length;
      let afterTenant: string | null = resume?.afterTenant ?? null;
      let afterId: string | null = resume?.afterId ?? null;
      if (afterId === '') afterId = null;
      resume = null;
      for (;;) {
        if (opts.budgetMs !== undefined && now() - started >= opts.budgetMs) {
          return { skipped: null, complete: false, cursor: { table: set.table, column, afterTenant: afterTenant ?? '', afterId: afterId ?? '' }, columns };
        }
        params.length = fixed;
        // the parameters take the columns' own types (never ::text), so the comparison and the order are the index's
        const keyset = afterId === null ? '' : byId ? ` AND ${id} > ${bind(afterId)}` : ` AND (${tcol}, ${id}) > (${bind(afterTenant)}, ${bind(afterId)})`;
        // qualified: a bare name could resolve to the text output column of the same name
        const order = byId ? `${rel}.${id}` : `${rel}.${tcol}, ${rel}.${id}`;
        const page = await batch(async (q) => rowsOf(await q.query(
          `SELECT ${tcol}::text AS tenant, ${id}::text AS id, ${col} AS value FROM ${rel}
            WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} NOT LIKE $1${filter}${keyset}
            ORDER BY ${order} LIMIT ${batchSize}`,
          [...params],
        )) as { tenant: string; id: string; value: string }[]);
        if (page.length === 0) break;

        // Sealed with no transaction open.
        const writes: Array<{ tenant: string; id: string; old: string; value: string; idx: Array<{ column: string; value: string | null }> }> = [];
        for (const row of page) {
          counts.scanned++;
          if (!UUID_RE.test(row.tenant)) { counts.invalid++; continue; }
          let plaintext: string;
          try { plaintext = await owner.decrypt(row.tenant, row.value); } catch (e) {
            if (e instanceof FieldDecryptError) { counts.unreadable++; continue; }
            throw e;
          }
          try {
            const value = await owner.encrypt(row.tenant, plaintext);
            const idx = [];
            for (const b of userScope ? [] : indexes) idx.push({ column: b.column, value: await keys.blindIndex(row.tenant, b.purpose, normaliseBlindIndexValue(plaintext)) });
            writes.push({ tenant: row.tenant, id: row.id, old: row.value, value, idx });
          } catch (e) {
            if (isPurged(e)) { counts.purged++; continue; }
            throw e;
          }
        }
        if (writes.length) {
          await batch(async (q) => {
            for (const w of writes) {
              const sets = [`${col} = $4`, ...w.idx.map((x, i) => `${ident(x.column)} = $${5 + i}`)].join(', ');
              const updated = rowsOf(await q.query(
                `WITH u AS (UPDATE ${rel} SET ${sets} WHERE ${tcol} = $1 AND ${id} = $2 AND ${col} = $3 RETURNING 1) SELECT count(*)::int AS n FROM u`,
                [w.tenant, w.id, w.old, w.value, ...w.idx.map((x) => x.value)],
              ));
              const n = Number(updated[0]?.n ?? 0);
              if (n > 0) counts.sealed += n; else counts.raced++;
            }
          });
        }
        const last = page[page.length - 1];
        afterTenant = last.tenant; afterId = last.id;
        if (page.length < batchSize) break;
        if (pauseMs) await sleep(pauseMs);
      }
    }
  }
  return { skipped: null, complete: true, cursor: null, columns };
}

/** One line for the job log: counts only. */
export function describeTenantKeyBackfill(report: TenantKeyBackfillReport): string {
  if (report.skipped === 'no-key') return 'the node cannot hold tenant keys: nothing to move';
  const parts = Object.entries(report.columns).filter(([, v]) => v.scanned > 0)
    .map(([k, v]) => `${k} ${v.sealed}/${v.scanned} sealed${v.unreadable ? `, ${v.unreadable} unreadable` : ''}${v.purged ? `, ${v.purged} purged` : ''}${v.invalid ? `, ${v.invalid} invalid` : ''}${v.raced ? `, ${v.raced} raced` : ''}`);
  return `${parts.length ? parts.join('; ') : 'nothing left to move'}${report.complete ? '' : ' (cut by the budget, resumes)'}`;
}
