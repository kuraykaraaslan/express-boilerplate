import 'reflect-metadata';
import { And, ILike, Between, LessThanOrEqual, MoreThanOrEqual, IsNull, Not, In, type FindOptionsWhere } from 'typeorm';
import { withTenantTransactionFor, withSystemRLS } from '@kuraykaraaslan-labs/db';
import { ROOT_TENANT_ID, isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { AuditLog as AuditLogRow } from './entities/audit_log.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import { type AuditLog, type ChainVerificationResult, type ChainVerificationDetail, type ChainPosition } from './audit_log.types';
import { actorRefsOf, resolveActors, toAuditLog } from './audit_log.actors';
import { auditSqlNames } from './audit_log.sql';
import {
  GetAuditLogsDTO,
  ExportAuditLogsDTO,
  CrossTenantAuditQueryDTO,
  CROSS_TENANT_MAX_DEPTH,
  AUDIT_LOG_SORTABLE,
  type GetAuditLogsInput,
  type ExportAuditLogsInput,
  type CrossTenantAuditQueryInput,
} from './audit_log.dto';
import AuditLogMessages from './audit_log.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { matchLegacyRow } from './audit_log.hash';
import { ChainVersionGuard } from '@kuraykaraaslan-labs/common/server/common.hash-chain';
import { readLegacyHead } from './audit_log.chain-head';
import { resolveChainMode } from './audit_log.mode';
import { serializeForArchive, serializeForCsv } from './audit_log.serialize';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import {
  AUDIT_LOG_SETTING_KEYS,
  AUDIT_LOG_DEFAULT_MAX_PAGE_SIZE,
  AUDIT_LOG_PAGE_SIZE_HARD_CAP,
} from './audit_log.setting.keys';

/**
 * Resolve the effective `GET /audit-logs` pageSize cap for a tenant. Reads
 * `auditLogMaxPageSize`; an unset/invalid/non-positive value falls back to
 * AUDIT_LOG_DEFAULT_MAX_PAGE_SIZE (the module's historical fixed cap), and the
 * result is always clamped to AUDIT_LOG_PAGE_SIZE_HARD_CAP so a misconfigured
 * setting can never make a listing unbounded.
 */
export async function resolveMaxPageSize(tenantId: string): Promise<number> {
  const raw = await SettingService.getValue(tenantId, AUDIT_LOG_SETTING_KEYS.MAX_PAGE_SIZE).catch(() => null);
  const parsed = raw ? Number(raw) : NaN;
  const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : AUDIT_LOG_DEFAULT_MAX_PAGE_SIZE;
  return Math.min(cap, AUDIT_LOG_PAGE_SIZE_HARD_CAP);
}

/** Apply an inclusive createdAt date-range to a where clause. */
export function applyDateRange(where: FindOptionsWhere<AuditLogRow>, from: Date | null, to: Date | null): void {
  if (from && to) where.createdAt = Between(from, to);
  else if (from) where.createdAt = MoreThanOrEqual(from);
  else if (to) where.createdAt = LessThanOrEqual(to);
}

/**
 * Narrow a where clause to one actor. A legacy row names its actor by `actorId`; a sealed row by a reference that only the
 * mapping can tie to an id, so the filter matches either. With no reference on record (every legacy deployment) the
 * clause is the plain `actorId` equality it always was.
 */
export function applyActorFilter(where: FindOptionsWhere<AuditLogRow>, actorId: string, refs: string[]): FindOptionsWhere<AuditLogRow> | FindOptionsWhere<AuditLogRow>[] {
  if (refs.length === 0) return { ...where, actorId };
  return [{ ...where, actorId }, { ...where, actorRef: In(refs) }];
}

/**
 * The `action` column's filter: the list's search (`action`, contains; audit_log.09: `%`, `_` and `\\` matched literally) and the exact
 * names a reader leaves out (`excludeActions`: the home feed's machine events, e2e run 1 E21), both when both are asked.
 */
export function actionFilter(action: string | null | undefined, excludeActions: readonly string[] | undefined): FindOptionsWhere<AuditLogRow>['action'] {
  const contains = action ? ILike(`%${action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined;
  const without = excludeActions?.length ? Not(In([...excludeActions])) : undefined;
  return contains && without ? And(contains, without) : contains ?? without;
}

export async function getAll(input: GetAuditLogsInput): Promise<{ logs: AuditLog[]; total: number }> {
  const parsed = GetAuditLogsDTO.safeParse(input);
  if (!parsed.success) {
    throw new AppError(AuditLogMessages.INVALID_INPUT, 400, ErrorCode.VALIDATION_ERROR);
  }
  const { tenantId: rawTenantId, actorId, actorTenantId, action, excludeActions, severity, resourceType, resourceId, fromDate, toDate, page, sort } = parsed.data;
  const tenantId = rawTenantId ?? ROOT_TENANT_ID;
  const maxPageSize = await resolveMaxPageSize(tenantId);
  const pageSize = Math.min(parsed.data.pageSize, maxPageSize);

  const where: FindOptionsWhere<AuditLogRow> = { tenantId };
  // audit_log.09 (fixed 2026-10-20): `%`, `_` and `\\` in the filter are matched literally (escaped for ILIKE).
  const byAction = actionFilter(action, excludeActions);
  if (byAction) where.action = byAction;
  if (severity) where.severity = severity;
  if (resourceType) where.resourceType = resourceType;
  if (resourceId) where.resourceId = resourceId;
  if (actorTenantId) where.actorTenantId = actorTenantId === 'any' ? Not(IsNull()) : actorTenantId;
  applyDateRange(where, fromDate ?? null, toDate ?? null);

  try {
    // find/count exclude soft-deleted rows automatically (DeleteDateColumn). One transaction: the page, and the
    // identity mapping its sealed rows are resolved through, come from the same snapshot of the tenant's database.
    return await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(AuditLogRow);
      const filter = actorId ? applyActorFilter(where, actorId, await actorRefsOf(qr, tenantId, actorId)) : where;
      // Columns only from AUDIT_LOG_SORTABLE; the id breaks ties so rows written in the same instant never repeat across pages.
      const order = toOrder(sort ?? [{ field: 'createdAt', dir: 'desc' }], AUDIT_LOG_SORTABLE, { auditLogId: 'ASC' }, AuditLogRow);
      const [rows, total] = await repo.findAndCount({ where: filter, order, skip: Math.max(0, (page - 1) * pageSize), take: pageSize });
      return { logs: (await resolveActors(qr, tenantId, rows)).map(toAuditLog), total };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.error(`[AuditLog] getAll failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.FETCH_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/**
 * Right-to-access (GDPR Art. 15) + bulk export. Returns all (non-deleted)
 * rows matching the filter, serialized to CSV or NDJSON. Always tenant-scoped.
 * Pass an actorId for a per-user Subject Access Request export.
 */
/** audit_log.04 (fixed 2026-10-20, export half): one export reads at most this many rows; a larger result says it was truncated. */
export const EXPORT_MAX_ROWS = 100_000;

export async function exportLogs(input: ExportAuditLogsInput): Promise<{ format: 'csv' | 'ndjson'; body: string; count: number; truncated: boolean }> {
  const parsed = ExportAuditLogsDTO.safeParse(input);
  if (!parsed.success) {
    throw new AppError(AuditLogMessages.INVALID_INPUT, 400, ErrorCode.VALIDATION_ERROR);
  }
  const { tenantId, actorId, fromDate, toDate, format } = parsed.data;

  const where: FindOptionsWhere<AuditLogRow> = { tenantId };
  applyDateRange(where, fromDate ?? null, toDate ?? null);

  try {
    const logs = await withTenantTransactionFor(tenantId, async (qr) => {
      const filter = actorId ? applyActorFilter(where, actorId, await actorRefsOf(qr, tenantId, actorId)) : where;
      const rows = await qr.manager.getRepository(AuditLogRow).find({ where: filter, order: { createdAt: 'DESC' }, take: EXPORT_MAX_ROWS + 1 });
      return (await resolveActors(qr, tenantId, rows)).map(toAuditLog);
    });
    const truncated = logs.length > EXPORT_MAX_ROWS;
    const kept = truncated ? logs.slice(0, EXPORT_MAX_ROWS) : logs;
    const body = format === 'csv' ? serializeForCsv(kept) : serializeForArchive(kept);
    return { format, body, count: kept.length, truncated };
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.error(`[AuditLog] exportLogs failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.EXPORT_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/** Rows per verification round trip. Memory is bounded by this, not by the size of the tenant's trail. */
export const VERIFY_BATCH_SIZE = 1000;

export interface VerifyChainOptions {
  /** Resume right after this verified row (the `through` of an earlier run); its rowHash is the link the next row must carry. */
  resumeFrom?: ChainPosition | null;
  /**
   * The hash the first examined row must link to when the walk starts at the beginning of what is KEPT, not at the beginning
   * of the chain: the head hash a retention checkpoint recorded before it deleted the older rows. Without it a chain whose
   * oldest rows were purged is reported broken at its first row, because that row names a predecessor that is gone.
   */
  anchorHash?: string | null;
  batchSize?: number;
  /** Stop after this many rows (a bounded slice of the chain). The legacy anchor does NOT use it: rows past the anchored head are verified too. */
  maxRows?: number;
  /**
   * The legacy anchor's head hash (audit_log.11): the walk reports in `headAtLegacyRow` how many legacy-writer rows it had verified when
   * it reached the row carrying it. The walk itself does not stop there.
   */
  headHash?: string | null;
}

/** One v1 row as the verifier reads it: the stored columns plus the exact createdAt text used as the cursor. */
type V1Row = {
  auditLogId: string; tenantId: string; actorId: string | null; actorType: string; onBehalfOfActorId: string | null;
  actorTenantId: string | null; action: string; severity: string; resourceType: string | null; resourceId: string | null;
  metadata: unknown; prevHash: string | null; rowHash: string | null; hashVersion: number | null; createdAt: Date; createdAtKey: string;
  ipAddress?: string | null; userAgent?: string | null; subjectDigest?: string | null; erasureSeal?: string | null;
};

type VerifyStep = {
  verified: number;
  brokenAt: string | null;
  /** True when this round reached the end of the chain (fewer rows than asked for, nothing left to read). */
  done: boolean;
};

/**
 * Verify the append-only hash chain of a tenant, in rounds of `batchSize` rows.
 *
 * Two kinds of row can share one chain and each is checked the way it was written:
 *  - v2 (`hashVersion` 2, written by the database trigger): recomputed IN the database, by `audit_verify_chain`. A v2 hash
 *    is never re-derived in JavaScript: createdAt is `timestamp without time zone`, which node-postgres reads in the
 *    process time zone.
 *  - v1 (`hashVersion` NULL, the JavaScript writer, every row before the hardening): recomputed with `computeRowHash`, as
 *    it always was.
 * Rows are walked by (createdAt, auditLogId) and soft-deleted rows are INCLUDED: a soft delete must not hide a row from
 * the check (it used to, and the row after it then looked like a forged link). An unknown hashVersion is a break.
 */
export async function verifyChainRange(tenantId: string, opts: VerifyChainOptions = {}): Promise<ChainVerificationDetail> {
  const batch = opts.batchSize ?? VERIFY_BATCH_SIZE;
  let position: ChainPosition | null = opts.resumeFrom ?? null;
  let expectedPrev: string | null = position ? position.rowHash : (opts.anchorHash ?? null);
  let checked = 0;
  // One guard for the whole walk (it spans rounds): after the first keyed JavaScript row, an unkeyed one is a break.
  const guard = new ChainVersionGuard();
  let keyed = false;
  // Legacy-writer rows verified so far, and that count at the anchored head's row (audit_log.11).
  let legacyRows = 0;
  let headAtLegacyRow: number | null = null;
  const tracking = opts.headHash != null;
  const extra = () => ({ ...(keyed ? { keyed } : {}), ...(tracking ? { headAtLegacyRow } : {}) });

  for (;;) {
    const limit = opts.maxRows != null ? Math.min(batch, opts.maxRows - checked) : batch;
    if (limit <= 0) return { ok: true, checked, brokenAt: null, through: position, ...extra() };
    const step: VerifyStep = await withTenantTransactionFor(tenantId, async (qr) => {
      let verified = 0;
      const advance = (p: ChainPosition) => { position = p; expectedPrev = p.rowHash; };

      const sql = auditSqlNames(qr);
      const [res] = await qr.query(`SELECT * FROM ${sql.fn('audit_verify_chain')}($1, $2, $3, $4, $5)`, [
        tenantId, position?.createdAt ?? null, position?.auditLogId ?? null, expectedPrev, limit,
      ]) as Array<{ checked: number; broken_id: string | null; last_at: string | null; last_id: string | null; last_hash: string | null; stopped_at_v1: boolean }>;
      if (!res) throw new Error('audit_verify_chain returned no row');
      verified += Number(res.checked);
      if (Number(res.checked) > 0 && res.last_at && res.last_id) {
        advance({ createdAt: res.last_at, auditLogId: res.last_id, rowHash: res.last_hash });
      }
      if (res.broken_id) return { verified, brokenAt: res.broken_id, done: true };
      if (!res.stopped_at_v1) return { verified, brokenAt: null, done: Number(res.checked) < limit };
      const jsLimit = opts.maxRows != null ? limit - verified : batch;
      if (jsLimit <= 0) return { verified, brokenAt: null, done: false };

      // The walk stopped in front of a v1 row: JavaScript verifies the run of v1 rows from there.
      const rows = await qr.query(
        `SELECT "auditLogId", "tenantId", "actorId", "actorType", "onBehalfOfActorId", "actorTenantId", "action", "severity",
                "resourceType", "resourceId", "metadata", "prevHash", "rowHash", "hashVersion", "createdAt",
                "ipAddress", "userAgent", "subjectDigest", "erasureSeal",
                to_char("createdAt", 'YYYY-MM-DD HH24:MI:SS.US') AS "createdAtKey"
           FROM ${sql.auditLogs}
          WHERE "tenantId" = $1 AND ($3::uuid IS NULL OR ("createdAt", "auditLogId") > ($2::timestamp, $3::uuid))
          ORDER BY "createdAt", "auditLogId"
          LIMIT $4`,
        [tenantId, position?.createdAt ?? null, position?.auditLogId ?? null, jsLimit],
      ) as V1Row[];
      for (const row of rows) {
        if (row.hashVersion !== null) return { verified, brokenAt: null, done: false };
        // Keyed (since 2026-10-20) or unkeyed v1, and never an unkeyed row after a keyed one: a forger without the key cannot append
        // v1 rows after the cutover (audit_log.02 / .12, audit_log.hash.ts).
        const version = (row.prevHash ?? null) === expectedPrev ? matchLegacyRow(expectedPrev, {
          tenantId: row.tenantId, actorId: row.actorId ?? null, actorType: row.actorType, onBehalfOfActorId: row.onBehalfOfActorId ?? null,
          action: row.action, severity: row.severity, resourceType: row.resourceType ?? null, resourceId: row.resourceId ?? null,
          metadata: row.metadata ?? null, createdAt: row.createdAt, actorTenantId: row.actorTenantId ?? null,
          ipAddress: row.ipAddress ?? null, userAgent: row.userAgent ?? null, rowHash: row.rowHash ?? null,
          subjectDigest: row.subjectDigest ?? null, erasureSeal: row.erasureSeal ?? null,
        }) : null;
        if (!guard.accept(version)) {
          return { verified, brokenAt: row.auditLogId, done: true };
        }
        if (version === 2) keyed = true;
        verified += 1;
        legacyRows += 1;
        if (tracking && headAtLegacyRow === null && row.rowHash === opts.headHash) headAtLegacyRow = legacyRows;
        advance({ createdAt: row.createdAtKey, auditLogId: row.auditLogId, rowHash: row.rowHash });
      }
      return { verified, brokenAt: null, done: rows.length < jsLimit };
    });

    checked += step.verified;
    if (step.brokenAt) return { ok: false, checked: checked + 1, brokenAt: step.brokenAt, through: position, ...extra() };
    if (step.done) return { ok: true, checked, brokenAt: null, through: position, ...extra() };
  }
}

/**
 * Verify the append-only hash chain for a tenant. Recomputes each row's hash
 * from the previous row's stored rowHash + canonical content and confirms the
 * chain links match. Detects tampering / deletion within the kept window.
 */
/**
 * The legacy chain judged against its external anchor (audit_log.11 / .02), shared by `verifyChain` and the weekly sweep so both catch a
 * truncation the same way. 'sealed': the chain is anchored by its checkpoints and the control plane instead. 'unanchored': no anchor row, so only
 * an all-v1 chain from before the anchor existed is acceptable (the caller walks it and refuses a keyed one).
 *
 * The walk starts at the base a retention purge recorded and covers the WHOLE chain: every row, including those past the anchored head (a row
 * appended outside the writer, a hash-less insert with the trigger off, must break it, not go unread). The anchored head must be on the walk,
 * reached after exactly the anchored number of legacy-writer rows (trigger-chained rows are verified in the database and not counted), which is
 * what makes a truncated chain fail. A row past the head is a later write: it verifies like any other, and an unkeyed one after a keyed one is a
 * break.
 */
export async function legacyAnchorVerdict(tenantId: string): Promise<ChainVerificationResult | 'sealed' | 'unanchored'> {
  if (await resolveChainMode(tenantId) === 'sealed') return 'sealed';
  const head = await withTenantTransactionFor(tenantId, (qr) => readLegacyHead(qr, tenantId));
  if (!head) return 'unanchored';
  const range = await verifyChainRange(tenantId, { anchorHash: head.baseHash ?? null, ...(head.headHash ? { headHash: head.headHash } : {}) });
  if (!range.ok) return { ok: false, checked: range.checked, brokenAt: range.brokenAt };
  const last = range.through?.auditLogId ?? null;
  if (!head.sealOk) return { ok: false, checked: range.checked, brokenAt: last };
  if (head.headHash === null || head.rowCount === 0) {
    // no anchored legacy row is kept (a purge reached the head): what remains must not hold a keyed row the head does not know
    if (head.rowCount !== 0 || range.keyed) return { ok: false, checked: range.checked, brokenAt: last };
  } else if (range.headAtLegacyRow !== head.rowCount) {
    return { ok: false, checked: range.checked, brokenAt: last };
  }
  return { ok: true, checked: range.checked, brokenAt: null };
}

/** A walk without the legacy anchor: a keyed chain must have one (every keyed write moves it), so a keyed chain without one lost it. */
export function refuseUnanchoredKeyed(range: ChainVerificationDetail): ChainVerificationResult {
  if (range.ok && range.keyed) return { ok: false, checked: range.checked, brokenAt: range.through?.auditLogId ?? null };
  return { ok: range.ok, checked: range.checked, brokenAt: range.brokenAt };
}

export async function verifyChain(tenantId: string): Promise<ChainVerificationResult> {
  try {
    const legacy = await legacyAnchorVerdict(tenantId);
    if (typeof legacy === 'object') return legacy;
    const range = await verifyChainRange(tenantId);
    // A sealed chain is anchored by its checkpoints and the control plane, not by the legacy anchor.
    if (legacy === 'sealed') return { ok: range.ok, checked: range.checked, brokenAt: range.brokenAt };
    return refuseUnanchoredKeyed(range);
  } catch (error) {
    Logger.error(`[AuditLog] verifyChain failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.VERIFY_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

export interface AppendOnlyStatus {
  /** True when the runtime role holds no forbidden privilege on any protected relation; false when it holds one; null when it cannot be judged (no `app_runtime` role: a single-role deployment). */
  enforced: boolean | null;
  relations: Array<{ relation: string; forbidden: string[]; writable: boolean | null }>;
}

/**
 * Whether the application role can still rewrite or erase the audit trail (`audit_append_only_status()`, migration 008; the REVOKE is the manual file
 * `append-only-enable.sql`). Reads privileges, not tenant data, so it runs on the system connection. For a compliance check and an operator; it changes nothing.
 */
export async function getAppendOnlyStatus(): Promise<AppendOnlyStatus> {
  try {
    const rows = await withSystemRLS((qr) => qr.query(`SELECT * FROM ${auditSqlNames(qr).fn('audit_append_only_status')}()`)) as Array<{ relation: string; forbidden: string[]; writable: boolean | null }>;
    const relations = rows.map((r) => ({ relation: r.relation, forbidden: r.forbidden, writable: r.writable }));
    const unknown = relations.length === 0 || relations.some((r) => r.writable === null);
    return { enforced: unknown ? null : relations.every((r) => r.writable === false), relations };
  } catch (error) {
    Logger.error(`[AuditLog] getAppendOnlyStatus failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.VERIFY_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/**
 * The `headHash` of the newest retention checkpoint of a tenant, or null when its chain was never purged through one. A sealed chain is purged only through
 * `audit_chain_checkpoint` / `audit_chain_purge`, so for it this is exactly what the first kept row must link to: pass it as `anchorHash` and the verifier
 * accepts that link and nothing weaker (unlike `firstRowPrevHash`, which forgives whatever the first kept row names).
 */
export async function latestCheckpointHead(tenantId: string): Promise<string | null> {
  try {
    return await withTenantTransactionFor(tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT "headHash" FROM ${auditSqlNames(qr).checkpoints} WHERE "tenantId" = $1 ORDER BY "coveredThrough" DESC, "coveredThroughId" DESC LIMIT 1`, [tenantId],
      ) as Array<{ headHash: string }>;
      return row?.headHash ?? null;
    });
  } catch (error) {
    Logger.error(`[AuditLog] latestCheckpointHead failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.VERIFY_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/**
 * The `prevHash` of the OLDEST row a tenant still holds (null for a chain that starts at its genesis, or an empty one). After a retention purge the
 * oldest kept row names a predecessor that was deleted on purpose; passing this as `anchorHash` makes the verifier accept that one missing link and
 * check everything from there on. It forgives exactly the first row's predecessor and nothing else: until the purge records a checkpoint
 * (audit hardening item 9) a deletion at the old end of the chain cannot be told from a retention purge.
 */
export async function firstRowPrevHash(tenantId: string): Promise<string | null> {
  try {
    return await withTenantTransactionFor(tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT "prevHash" FROM ${auditSqlNames(qr).auditLogs} WHERE "tenantId" = $1 ORDER BY "createdAt" ASC, "auditLogId" ASC LIMIT 1`, [tenantId],
      ) as Array<{ prevHash: string | null }>;
      return row?.prevHash ?? null;
    });
  } catch (error) {
    Logger.error(`[AuditLog] firstRowPrevHash failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.VERIFY_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/** The head of one tenant's chain as the control plane's own audit root commits to it. */
export interface ChainHead {
  /** `rowHash` of the newest row, by (createdAt, auditLogId): the order the verifier walks. */
  headHash: string;
  /** Rows the chain holds now. After a retention purge this is what is kept, not what was ever written (the purge checkpoint that records the purged count is next wave). */
  rowCount: number;
}

/**
 * The head of a tenant's chain, or null when the tenant has no hashed row yet. Hash and count only, never a row. Read in the tenant's own
 * transaction like every other read, so a dedicated-database tenant is read where its rows are.
 */
export async function getChainHead(tenantId: string): Promise<ChainHead | null> {
  try {
    return await withTenantTransactionFor(tenantId, async (qr) => {
      const t = auditSqlNames(qr).auditLogs;
      const [head] = await qr.query(
        `SELECT "rowHash" FROM ${t} WHERE "tenantId" = $1 AND "rowHash" IS NOT NULL ORDER BY "createdAt" DESC, "auditLogId" DESC LIMIT 1`, [tenantId],
      ) as Array<{ rowHash: string }>;
      if (!head) return null;
      const [{ count }] = await qr.query(`SELECT count(*)::int AS count FROM ${t} WHERE "tenantId" = $1`, [tenantId]) as Array<{ count: number }>;
      return { headHash: head.rowHash, rowCount: Number(count) };
    });
  } catch (error) {
    Logger.error(`[AuditLog] getChainHead failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.VERIFY_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/**
 * Whether the tenant's chain still holds a head the control plane acknowledged (`audit.chain_proof`, docs/phases/02-fleet/08 section 7): a row with that
 * hash, or the head of a checkpoint a retention purge recorded (a purge may remove the acknowledged row itself, never the checkpoint that remembers
 * it). Read in the tenant's own transaction, so a tenant with a database of its own is read there. False is a rewritten or truncated history.
 */
export async function chainHolds(tenantId: string, headHash: string): Promise<boolean> {
  return withTenantTransactionFor(tenantId, async (qr) => {
    const t = auditSqlNames(qr);
    const [row] = await qr.query(`SELECT EXISTS (SELECT 1 FROM ${t.auditLogs} WHERE "tenantId" = $1 AND "rowHash" = $2) AS ok`, [tenantId, headHash]) as Array<{ ok: boolean }>;
    if (row?.ok) return true;
    const [cp] = await qr.query(`SELECT EXISTS (SELECT 1 FROM ${t.checkpoints} WHERE "tenantId" = $1 AND "headHash" = $2) AS ok`, [tenantId, headHash]) as Array<{ ok: boolean }>;
    return cp?.ok === true;
  });
}

/**
 * The verdict as a code and nothing else, for compliance checks that may report a status but never a row or an id
 * (`audit.chain_ok`, docs/phases/02-fleet/03 section 8.9).
 */
export async function verifyChainStatus(tenantId: string): Promise<'CHAIN_OK' | 'CHAIN_BROKEN'> {
  return (await verifyChain(tenantId)).ok ? 'CHAIN_OK' : 'CHAIN_BROKEN';
}

/** Whether any row names an actor only by reference, i.e. whether resolving actors would query the mapping at all. */
function needsActorResolution(rows: AuditLogRow[]): boolean {
  return rows.some((r) => (!r.actorId && r.actorRef) || (!r.onBehalfOfActorId && r.onBehalfOfRef));
}

/**
 * Cross-tenant aggregated view — root tenant only. Queries every tenant's
 * audit table for matching events within a time window. Used by the platform
 * security team for cross-tenant incident investigation.
 *
 * Each tenant is still read through its own `withTenantTransactionFor`, never
 * one system query: a dedicated-database tenant's rows are not in the shared
 * database, so a single query would silently miss them.
 *
 * Bounded on purpose (it used to fetch page * pageSize rows plus a full COUNT
 * per tenant, then parse and resolve every fetched row):
 *  - depth is capped at CROSS_TENANT_MAX_DEPTH rows (the DTO refuses deeper);
 *  - raw rows are merge-sorted first, and only the returned page is parsed and
 *    has its actors resolved;
 *  - `total` is capped at CROSS_TENANT_MAX_DEPTH. A tenant that returned fewer
 *    rows than the page needed already told us its exact count; only a tenant
 *    that filled it is counted further, and then only up to the cap (a bounded
 *    id read, not a COUNT over the whole window). `hasMore` says whether any
 *    matching row exists past this page, including past the cap.
 */
export async function queryCrossTenant(callerTenantId: string, input: CrossTenantAuditQueryInput) {
  if (!isRootTenant(callerTenantId)) {
    throw new AppError(AuditLogMessages.ROOT_ONLY, 403, ErrorCode.FORBIDDEN);
  }
  const parsed = CrossTenantAuditQueryDTO.safeParse(input);
  if (!parsed.success) {
    throw new AppError(AuditLogMessages.INVALID_INPUT, 400, ErrorCode.VALIDATION_ERROR);
  }
  const { tenantId: filterTenantId, action, excludeActions, severity, fromDate, toDate, page, pageSize, sort } = parsed.data;
  const dir = sort?.[0]?.dir === 'asc' ? 'ASC' : 'DESC';

  try {
    // Every tenant, not just ACTIVE ones: an incident investigation needs a
    // suspended tenant's trail most of all. Cross-tenant → SYSTEM connection.
    const allTenants = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).find());
    // When a tenant filter is supplied, scope the scan to just that tenant.
    const scope = filterTenantId
      ? allTenants.filter((t) => t.tenantId === filterTenantId)
      : allTenants;
    const tenantNameMap = Object.fromEntries(allTenants.map((t) => [t.tenantId, t.name]));

    // For a global page N we never need more than offset+pageSize rows from any
    // single tenant, so fetch that many per tenant, merge-sort, then slice.
    const need = page * pageSize;

    const merged: AuditLogRow[] = [];
    let counted = 0;
    for (const tenant of scope) {
      const where: FindOptionsWhere<AuditLogRow> = { tenantId: tenant.tenantId };
      const byAction = actionFilter(action, excludeActions);
      if (byAction) where.action = byAction;
      if (severity) where.severity = severity;
      applyDateRange(where, fromDate ?? null, toDate ?? null);

      // Page + capped count in one tenant-scoped transaction (one snapshot).
      const [rows, count] = await withTenantTransactionFor(tenant.tenantId, async (qr) => {
        const repo = qr.manager.getRepository(AuditLogRow);
        const found = await repo.find({ where, order: { createdAt: dir }, take: need });
        if (found.length < need) return [found, found.length] as const;
        // One past the cap is enough to know the total is capped.
        const ids = await repo.find({ where, select: { auditLogId: true }, order: { createdAt: 'DESC' }, take: CROSS_TENANT_MAX_DEPTH + 1 });
        return [found, Math.max(found.length, ids.length)] as const;
      });
      counted += count;
      merged.push(...rows);
    }

    merged.sort((a, b) => (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * (dir === 'ASC' ? -1 : 1));
    const offset = Math.max(0, (page - 1) * pageSize);
    const pageRows = merged.slice(offset, offset + pageSize);

    // Resolve actors per tenant for the returned page only, through that
    // tenant's own mapping; a tenant whose page rows all carry ids is skipped.
    const byTenant = new Map<string, AuditLogRow[]>();
    for (const r of pageRows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);
    const resolved = new Map<AuditLogRow, AuditLogRow>();
    for (const [tid, rows] of byTenant) {
      if (!needsActorResolution(rows)) continue;
      const out = await withTenantTransactionFor(tid, (qr) => resolveActors(qr, tid, rows));
      rows.forEach((r, i) => resolved.set(r, out[i]!));
    }

    const logs = pageRows.map((r) => ({
      ...toAuditLog(resolved.get(r) ?? r),
      tenant: { tenantId: r.tenantId, name: tenantNameMap[r.tenantId] ?? r.tenantId },
    }));
    const total = Math.min(counted, CROSS_TENANT_MAX_DEPTH);
    const hasMore = counted > offset + pageRows.length;
    return { logs, total, hasMore };
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.error(`[AuditLog] queryCrossTenant failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.FETCH_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/** Bounds of {@link actionActivityCrossTenant}: how many exact action names, count windows and newest rows one call may ask for. */
export const ACTION_ACTIVITY_MAX_ACTIONS = 50;
export const ACTION_ACTIVITY_MAX_WINDOWS = 5;
export const ACTION_ACTIVITY_MAX_LATEST = 100;
/** The oldest window start one call may ask for: a week, so the counts stay short index ranges on (tenantId, action, createdAt). */
export const ACTION_ACTIVITY_MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ActionActivityInput {
  /** Exact action names (no search, no wildcard), 1 to ACTION_ACTIVITY_MAX_ACTIONS. */
  actions: readonly string[];
  /** Window starts, 1 to ACTION_ACTIVITY_MAX_WINDOWS, none in the future and none older than ACTION_ACTIVITY_MAX_LOOKBACK_MS. */
  since: readonly Date[];
  /** How many of the newest matching rows to return, 0 to ACTION_ACTIVITY_MAX_LATEST (default 50). */
  latest?: number;
  /** The end of every window (default: the call's time). */
  now?: Date;
}

export interface ActionActivity {
  /** `counts[action][i]`: rows of `action` written in [since[i], now], every tenant summed. Every asked action is present. */
  counts: Record<string, number[]>;
  /** The newest `latest` rows of the asked actions in [oldest since, now], across tenants, newest first, actors resolved. */
  latest: Array<AuditLog & { tenant: { tenantId: string; name: string } }>;
  /** Tenants whose database could not be read (left out of `counts` and `latest`, each logged); 0 when every tenant was read. */
  skippedTenants: number;
}

/**
 * Security activity across every tenant, ROOT TENANT ONLY (the AI firewall's activity page, docs/phases/55-ai-firewall): per
 * exact action, how many rows each window holds, and the newest rows of those actions. The same reach as
 * {@link queryCrossTenant}: every tenant (suspended ones too) listed through the SYSTEM connection, then each tenant read in its
 * own `withTenantTransactionFor`, so a dedicated-database tenant is not missed.
 *
 * Bounded: at most ACTION_ACTIVITY_MAX_ACTIONS exact names, ACTION_ACTIVITY_MAX_WINDOWS windows no older than a week, and per
 * tenant one grouped COUNT plus at most `latest` rows; only the returned rows are parsed and have their actors resolved. The COUNT
 * returns one row per action, but Postgres still visits every matching row of the window to count it: the composite index
 * (tenantId, action, createdAt) (migration audit_log:013) keeps that to the asked actions' own rows, one index range per action,
 * instead of every row the tenant wrote in the window. The caller is expected to cache the result (the activity page polls).
 *
 * One tenant whose database cannot be read (a dedicated database that is down) does not fail the call: it is logged, left out
 * and counted in `skippedTenants`, and the other tenants still answer. Listing the tenants failing is a 500 as before.
 */
export async function actionActivityCrossTenant(callerTenantId: string, input: ActionActivityInput): Promise<ActionActivity> {
  if (!isRootTenant(callerTenantId)) {
    throw new AppError(AuditLogMessages.ROOT_ONLY, 403, ErrorCode.FORBIDDEN);
  }
  const now = input.now ?? new Date();
  const actions = [...new Set(input.actions)];
  const since = [...input.since];
  const take = input.latest ?? 50;
  const validAction = (a: unknown) => typeof a === 'string' && a.length > 0 && a.length <= 128;
  const validSince = (d: unknown) => d instanceof Date && Number.isFinite(d.getTime())
    && d.getTime() <= now.getTime() && now.getTime() - d.getTime() <= ACTION_ACTIVITY_MAX_LOOKBACK_MS;
  if (
    !Number.isFinite(now.getTime())
    || actions.length === 0 || actions.length > ACTION_ACTIVITY_MAX_ACTIONS || !actions.every(validAction)
    || since.length === 0 || since.length > ACTION_ACTIVITY_MAX_WINDOWS || !since.every(validSince)
    || !Number.isInteger(take) || take < 0 || take > ACTION_ACTIVITY_MAX_LATEST
  ) {
    throw new AppError(AuditLogMessages.INVALID_INPUT, 400, ErrorCode.VALIDATION_ERROR);
  }
  const oldest = new Date(Math.min(...since.map((d) => d.getTime())));

  try {
    const allTenants = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).find());
    const tenantNameMap = Object.fromEntries(allTenants.map((t) => [t.tenantId, t.name]));
    const counts: Record<string, number[]> = Object.fromEntries(actions.map((a) => [a, since.map(() => 0)]));
    const merged: AuditLogRow[] = [];
    let skippedTenants = 0;

    for (const tenant of allTenants) {
      const tenantId = tenant.tenantId;
      let read: readonly [Record<string, unknown>[], AuditLogRow[]];
      try {
        read = await withTenantTransactionFor(tenantId, async (qr) => {
          const repo = qr.manager.getRepository(AuditLogRow);
          const qb = repo.createQueryBuilder('a').select('a.action', 'action');
          since.forEach((s, i) => {
            qb.addSelect(`COUNT(*) FILTER (WHERE a.createdAt >= :since${i})::int`, `c${i}`);
            qb.setParameter(`since${i}`, s);
          });
          const groupedRows = await qb
            .where('a.tenantId = :tenantId', { tenantId })
            .andWhere('a.action IN (:...actions)', { actions })
            .andWhere('a.createdAt >= :oldest', { oldest })
            .andWhere('a.createdAt <= :now', { now })
            .groupBy('a.action')
            .getRawMany<Record<string, unknown>>();
          const newest = take > 0
            ? await repo.find({ where: { tenantId, action: In(actions), createdAt: Between(oldest, now) }, order: { createdAt: 'DESC' }, take })
            : [];
          return [groupedRows, newest] as const;
        });
      } catch (error) {
        skippedTenants += 1;
        Logger.warn(`[AuditLog] actionActivityCrossTenant: tenant ${tenantId} could not be read, left out: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const [grouped, rows] = read;
      for (const g of grouped) {
        const slot = counts[String(g.action)];
        if (!slot) continue;
        since.forEach((_, i) => { slot[i] = (slot[i] ?? 0) + (Number(g[`c${i}`]) || 0); });
      }
      merged.push(...rows);
    }

    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const pageRows = merged.slice(0, take);

    const byTenant = new Map<string, AuditLogRow[]>();
    for (const r of pageRows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);
    const resolved = new Map<AuditLogRow, AuditLogRow>();
    for (const [tid, rows] of byTenant) {
      if (!needsActorResolution(rows)) continue;
      try {
        const out = await withTenantTransactionFor(tid, (qr) => resolveActors(qr, tid, rows));
        rows.forEach((r, i) => resolved.set(r, out[i]!));
      } catch (error) {
        // the rows were read; only their actors stay unresolved (pseudonymous), as a tenant that went away between the two reads
        Logger.warn(`[AuditLog] actionActivityCrossTenant: actors of tenant ${tid} not resolved: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const latest = pageRows.map((r) => ({
      ...toAuditLog(resolved.get(r) ?? r),
      tenant: { tenantId: r.tenantId, name: tenantNameMap[r.tenantId] ?? r.tenantId },
    }));
    return { counts, latest, skippedTenants };
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.error(`[AuditLog] actionActivityCrossTenant failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.FETCH_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}
