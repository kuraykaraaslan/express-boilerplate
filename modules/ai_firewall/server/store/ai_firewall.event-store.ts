import 'reflect-metadata';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { accessRel } from '@kuraykaraaslan-labs/db/server/db.time-series.rollup';
import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { EVENT_COLUMNS, EVENTS_TABLE, type EventRow } from './ai_firewall.store';

/**
 * Writes stored security events (docs/phases/55-ai-firewall/01 §1.7): one tenant's rows in one transaction on the tenant's own
 * DataSource with the tenant in context (RLS applies, a dedicated tenant database gets its own rows), through the time-series access
 * view in Timescale mode. A row whose key ("tenantId", "at", "signalId") is already stored is skipped (`ON CONFLICT DO NOTHING`): a
 * redelivered stream entry inserts nothing twice. Throws when the write throws; the consumer then leaves the entries pending.
 */
export interface EventStoreDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
}

export const defaultEventStoreDeps: EventStoreDeps = {
  inTenant: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
  accessRel,
};

/** Rows per INSERT statement: 13 parameters each, far under Postgres's 65 535. */
export const INSERT_CHUNK = 500;

const quote = (column: string): string => `"${column}"`;

/** The INSERT of `n` rows into `rel` and its parameters, in EVENT_COLUMNS order (attrs as jsonb, at as timestamptz). */
export function insertStatement(rel: string, rows: readonly EventRow[]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const slots = EVENT_COLUMNS.map((column) => {
      const value = row[column];
      params.push(column === 'attrs' ? JSON.stringify(value ?? {}) : value);
      const n = params.length;
      return column === 'attrs' ? `$${n}::jsonb` : column === 'at' ? `$${n}::timestamptz` : column === 'tenantId' ? `$${n}::uuid` : `$${n}`;
    });
    return `(${slots.join(', ')})`;
  });
  return {
    sql: `INSERT INTO ${rel} (${EVENT_COLUMNS.map(quote).join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING RETURNING "signalId"`,
    params,
  };
}

/**
 * Stores one tenant's rows; answers how many were new (the rest were already stored). Every row must carry `tenantId`: the policy's
 * WITH CHECK refuses another tenant's row, and the caller groups by tenant before it calls.
 */
export async function insertEvents(tenantId: string, rows: readonly EventRow[], deps: EventStoreDeps = defaultEventStoreDeps): Promise<number> {
  if (rows.length === 0) return 0;
  if (rows.some((r) => r.tenantId !== tenantId)) throw new Error('insertEvents: every row must belong to the tenant it is written for');
  return deps.inTenant(tenantId, async (db) => {
    const rel = await deps.accessRel(db, EVENTS_TABLE);
    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const { sql, params } = insertStatement(rel, rows.slice(i, i + INSERT_CHUNK));
      inserted += rowsOf(await db.query(sql, params)).length;
    }
    return inserted;
  });
}
