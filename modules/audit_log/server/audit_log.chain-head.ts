import type { QueryRunner } from 'typeorm';
import { chainedRowHashV2 } from '@kuraykaraaslan-labs/common/server/common.hash-chain';
import { auditSqlNames } from './audit_log.sql';

/**
 * The external anchor of the LEGACY audit chain (audit_log.11 and .02, fixed 2026-10-20): `audit_legacy_chain_heads`, one row per tenant.
 *
 *  - every legacy write moves the head to its own row and counts it (`advanceLegacyHead`, in the write's transaction, under the chain lock);
 *  - a retention purge records what the oldest kept row now links to and how many legacy rows went (`rebaseLegacyHead`, in the purge's transaction);
 *  - the verifier walks the whole chain from `baseHash` and must reach `headHash` after exactly `rowCount` legacy rows (`readLegacyHead`).
 *
 * `rowCount` counts the LEGACY writer's rows (hashVersion NULL) from the base through the head. Rows the trigger chains into the same walk (a
 * hash-less insert, hashVersion 2) are verified by the database and are not counted: the JavaScript writer cannot see them coming, and a count
 * that mixed both never matched a chain that interleaves them.
 *
 * The row is sealed with the chain key (`common.hash-chain` v2), so editing it to match a truncated chain needs the key. A head whose seal
 * does not verify is never laundered: the next write carries the break forward (`BROKEN_SEAL`) and the verifier keeps reporting it.
 *
 * Raw SQL on purpose: the statements run on the write's own QueryRunner, and the table path is asked of the connection like every other
 * hand-written statement of this module (a dedicated schema is not on the default search_path).
 */
export interface LegacyChainHead {
  headHash: string | null;
  rowCount: number;
  baseHash: string | null;
  /** False when the stored seal does not match (the row was edited outside the application). */
  sealOk: boolean;
}

const BROKEN_SEAL = '0'.repeat(64);

function headSeal(tenantId: string, h: { headHash: string | null; rowCount: number; baseHash: string | null }): string {
  return chainedRowHashV2(null, { audit_legacy_chain_head: tenantId, headHash: h.headHash, rowCount: h.rowCount, baseHash: h.baseHash });
}

type SqlRunner = Pick<QueryRunner, 'query'> & { connection?: QueryRunner['connection'] };

function tables(qr: SqlRunner): { heads: string; logs: string } {
  if (!qr.connection) return { heads: '"audit_legacy_chain_heads"', logs: '"audit_logs"' };
  const names = auditSqlNames(qr as QueryRunner);
  return { heads: names.legacyHeads, logs: names.auditLogs };
}

/** The tenant's anchor, or null when its legacy chain was never anchored. `lock` takes the row for the rest of the transaction. */
export async function readLegacyHead(qr: SqlRunner, tenantId: string, lock = false): Promise<LegacyChainHead | null> {
  const rows = await qr.query(
    `SELECT "headHash", "rowCount", "baseHash", "seal" FROM ${tables(qr).heads} WHERE "tenantId" = $1${lock ? ' FOR UPDATE' : ''}`,
    [tenantId],
  ) as Array<{ headHash: string | null; rowCount: number | string; baseHash: string | null; seal: string }> | undefined;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  // Only a row of this table's shape is an anchor (a driver or a fake that answers something else is "no anchor").
  if (!row || typeof row.seal !== 'string' || !Number.isFinite(Number(row.rowCount))) return null;
  const head = { headHash: row.headHash ?? null, rowCount: Number(row.rowCount), baseHash: row.baseHash ?? null };
  return { ...head, sealOk: row.seal !== BROKEN_SEAL && row.seal === headSeal(tenantId, head) };
}

async function writeHead(qr: SqlRunner, tenantId: string, head: { headHash: string | null; rowCount: number; baseHash: string | null }, sealOk: boolean): Promise<void> {
  await qr.query(
    `INSERT INTO ${tables(qr).heads} ("tenantId", "headHash", "rowCount", "baseHash", "seal", "updatedAt") VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT ("tenantId") DO UPDATE SET "headHash" = EXCLUDED."headHash", "rowCount" = EXCLUDED."rowCount", "baseHash" = EXCLUDED."baseHash",
       "seal" = EXCLUDED."seal", "updatedAt" = now()`,
    [tenantId, head.headHash, head.rowCount, head.baseHash, sealOk ? headSeal(tenantId, head) : BROKEN_SEAL],
  );
}

/** The legacy writer's rows the tenant holds (hashVersion NULL), soft-deleted ones included (the verifier walks them). */
async function countLegacyRows(qr: SqlRunner, tenantId: string): Promise<number> {
  const rows = await qr.query(`SELECT count(*)::int AS "n" FROM ${tables(qr).logs} WHERE "tenantId" = $1 AND "hashVersion" IS NULL`, [tenantId]) as Array<{ n: number | string }> | undefined;
  const n = Array.isArray(rows) ? Number(rows[0]?.n) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * After a legacy write of `rowHash` (already inserted, same transaction, chain lock held). A chain written before the anchor existed is
 * anchored here the first time, counting the rows it has now (the new one included) and starting from wherever it starts.
 */
export async function advanceLegacyHead(qr: SqlRunner, tenantId: string, rowHash: string): Promise<void> {
  const head = await readLegacyHead(qr, tenantId, true);
  if (head) {
    await writeHead(qr, tenantId, { headHash: rowHash, rowCount: head.rowCount + 1, baseHash: head.baseHash }, head.sealOk);
    return;
  }
  const firstPrev = await qr.query(
    `SELECT "prevHash" FROM ${tables(qr).logs} WHERE "tenantId" = $1 ORDER BY "createdAt" ASC, "auditLogId" ASC LIMIT 1`, [tenantId],
  ) as Array<{ prevHash: string | null }> | undefined;
  const baseHash = Array.isArray(firstPrev) ? (firstPrev[0]?.prevHash ?? null) : null;
  await writeHead(qr, tenantId, { headHash: rowHash, rowCount: Math.max(1, await countLegacyRows(qr, tenantId)), baseHash }, true);
}

/**
 * After a retention purge deleted the chain's oldest rows, the newest of which was `lastPurgedHash`, `purgedLegacy` of them legacy-writer rows
 * (same transaction, chain lock held). The oldest kept row links to exactly that hash, so it becomes the base the verifier starts from.
 */
export async function rebaseLegacyHead(qr: SqlRunner, tenantId: string, lastPurgedHash: string | null, purgedLegacy: number): Promise<void> {
  const head = await readLegacyHead(qr, tenantId, true);
  if (head) {
    await writeHead(qr, tenantId, { headHash: head.headHash, rowCount: Math.max(0, head.rowCount - purgedLegacy), baseHash: lastPurgedHash }, head.sealOk);
    return;
  }
  const newest = await qr.query(
    // the head is the newest LEGACY row (the verifier finds the head among the rows the JavaScript writer wrote)
    `SELECT "rowHash" FROM ${tables(qr).logs} WHERE "tenantId" = $1 AND "hashVersion" IS NULL ORDER BY "createdAt" DESC, "auditLogId" DESC LIMIT 1`, [tenantId],
  ) as Array<{ rowHash: string | null }> | undefined;
  const headHash = (Array.isArray(newest) ? newest[0]?.rowHash : null) ?? lastPurgedHash;
  await writeHead(qr, tenantId, { headHash, rowCount: await countLegacyRows(qr, tenantId), baseHash: lastPurgedHash }, true);
}
