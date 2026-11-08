import 'reflect-metadata';
import { erasurePseudonym } from './audit_log.pseudonym';
import { LessThanOrEqual, type QueryRunner } from 'typeorm';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { env } from '@kuraykaraaslan-labs/env';
import { FLEET_TENANT_ID, ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AuditLog as AuditLogRow } from './entities/audit_log.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { type AuditArchiveExporter } from './audit_log.types';
import { toAuditLog } from './audit_log.actors';
import {
  CreateAuditLogDTO,
  PurgeAuditLogsDTO,
  AnonymizeActorDTO,
  type CreateAuditLogInput,
  type PurgeAuditLogsInput,
  type AnonymizeActorInput,
} from './audit_log.dto';
import { severityForAction, HIGH_RISK_SEVERITIES, type AuditSeverity } from './audit_log.enums';
import { AUDIT_LOG_SETTING_KEYS, RETENTION_KEEP_FOREVER } from './audit_log.setting.keys';
import AuditLogMessages from './audit_log.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { auditErasureSeal, auditSubjectDigest, computeKeyedRowHash, scrubMetadata } from './audit_log.hash';
import { advanceLegacyHead, rebaseLegacyHead } from './audit_log.chain-head';
import { breakGlassGrantFor } from './audit_log.context';
import { serializeForArchive } from './audit_log.serialize';
import { resolveChainMode, invalidateChainMode } from './audit_log.mode';
import { deriveActorRef } from './audit_log.actor-ref';
import { auditSqlNames } from './audit_log.sql';
import { notifyRecordSinks } from './audit_log.record-sink';

/** Read the tenant's retention window (days). 0 / unset = keep forever. */
/**
 * audit_log.10 (fixed 2026-10-20): the platform floor of the retention window. `auditLogRetentionDays` is a tenant setting, and any
 * positive value used to be honoured, so a tenant admin could set 1 and have the nightly sweep delete the evidence of their own actions.
 */
export const MIN_RETENTION_DAYS = 30;

/** audit_log.04: rows per purge batch, and the most an inline (exporter-less) archive may carry in one run. */
export const PURGE_BATCH = 1000;
export const PURGE_INLINE_ARCHIVE_MAX = 100_000;

export async function getRetentionDays(tenantId: string): Promise<number> {
  const raw = await SettingService.getValue(tenantId, AUDIT_LOG_SETTING_KEYS.RETENTION_DAYS);
  if (raw == null) return RETENTION_KEEP_FOREVER;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(parsed, MIN_RETENTION_DAYS) : RETENTION_KEEP_FOREVER;
}

/** One line of the [AUDIT] log: CR / LF and other control characters are escaped (audit_log.13). */
const oneLine = (v: unknown): string => String(v).replace(/[\u0000-\u001f\u007f]/g, (c) => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));

/** The sealed chain's trigger refuses a write the cached mode allowed (SQLSTATE check_violation, our own message). */
function isSealedRefusal(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '23514' && typeof e.message === 'string' && e.message.includes('audit chain is sealed');
}

/** What a write reports back: when it happened and who the log line may name (a sealed row never names the person). */
interface WrittenRow { at: Date; actor: string; sealed: boolean }

interface SealedRow {
  tenantId: string;
  actorId: string | null;
  onBehalfOfActorId: string | null;
  actorType: string;
  action: string;
  severity: AuditSeverity;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  actorTenantId: string | null;
  commandJti: string | null;
  nodeId: string | null;
}

/**
 * The sealed (hashVersion 2) write: ONE INSERT, in the caller's transaction. The BEFORE INSERT trigger takes the chain
 * lock, reads the head and sets prevHash, createdAt and rowHash, so there is no head read and no lock here.
 *
 * Identities never reach audit_logs: the actor (and the impersonated user) become pseudonymous references derived with a
 * per-tenant key, and the reference -> id mapping is written in the same transaction (a mapping that fails fails the
 * audit row too, so no row is ever written whose actor can no longer be resolved). Without the key the row is refused:
 * a row that carried the bare id would defeat the design. The trigger is checked on the way out (hashVersion must be 2):
 * a database whose migrations did not run would otherwise store an unhashed row without a word.
 *
 * Returns the createdAt the trigger assigned (UTC, millisecond) and the short reference used in the log line.
 */
async function writeSealed(qr: QueryRunner, row: SealedRow): Promise<WrittenRow> {
  const masterKey = env.SETTINGS_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error('the sealed audit chain needs SETTINGS_ENCRYPTION_KEY to derive actor references; the row was not written');
  }
  const actor = row.actorId ? deriveActorRef(masterKey, row.tenantId, row.actorId) : null;
  const behalf = row.onBehalfOfActorId ? deriveActorRef(masterKey, row.tenantId, row.onBehalfOfActorId) : null;

  const sql = auditSqlNames(qr);
  const mappings: Array<{ actorRef: string; actorId: string; keyVersion: number }> = [];
  if (actor && row.actorId) mappings.push({ actorRef: actor.actorRef, actorId: row.actorId, keyVersion: actor.keyVersion });
  if (behalf && row.onBehalfOfActorId) mappings.push({ actorRef: behalf.actorRef, actorId: row.onBehalfOfActorId, keyVersion: behalf.keyVersion });
  if (mappings.length > 0) {
    const params: unknown[] = [row.tenantId];
    const tuples = mappings.map((m) => {
      params.push(m.actorRef, m.actorId, m.keyVersion);
      const at = params.length;
      return `($1, $${at - 2}, $${at - 1}, $${at})`;
    });
    await qr.query(
      `INSERT INTO ${sql.actorIdentities} ("tenantId", "actorRef", "actorId", "keyVersion") VALUES ${tuples.join(', ')} ON CONFLICT ("tenantId", "actorRef") DO NOTHING`,
      params,
    );
  }

  const inserted = await qr.query(
    `INSERT INTO ${sql.auditLogs} ("tenantId", "actorRef", "onBehalfOfRef", "actorType", "action", "severity", "resourceType", "resourceId", "metadata", "ipAddress", "userAgent", "actorTenantId", "commandJti", "nodeId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
     RETURNING "hashVersion", to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt"`,
    [
      row.tenantId, actor?.actorRef ?? null, behalf?.actorRef ?? null, row.actorType, row.action, row.severity,
      row.resourceType, row.resourceId, row.metadata === null ? null : JSON.stringify(row.metadata),
      row.ipAddress, row.userAgent, row.actorTenantId, row.commandJti, row.nodeId,
    ],
  ) as Array<{ hashVersion: number | null; occurredAt: string }>;
  const first = inserted[0];
  if (!first || Number(first.hashVersion) !== 2) {
    throw new Error('the audit_logs trigger did not seal the row (hashVersion != 2); is migration audit_log:003 applied? The row was not kept');
  }
  return { at: new Date(first.occurredAt), actor: actor ? `ref:${actor.actorRef.slice(0, 12)}` : 'system', sealed: true };
}

/**
 * Write an audit-log row. Every log belongs to a tenant; when the caller
 * omits `tenantId` we fall back to the platform tenant (`ROOT_TENANT_ID`)
 * so platform-level events still land in a real tenant's audit table.
 *
 * Two chains, selected per tenant (audit_log.mode.ts): the LEGACY chain computes the per-tenant append-only hash
 * (prevHash/rowHash) here in JavaScript, exactly as it always has; the SEALED chain is written with one INSERT and
 * hashed by the database trigger (see `writeSealed`). For high-risk severities a best-effort `audit.high_risk` webhook
 * fires either way.
 * Never throws — failures are caught and logged so auditing can't break the
 * calling operation.
 */
/**
 * `opts.strict`: the caller cannot proceed without its audit row (an access that must leave evidence, document.12): a failed write
 * throws a 503 after it has been reported, instead of returning normally.
 */
export async function log(input: CreateAuditLogInput, opts: { strict?: boolean } = {}): Promise<void> {
  try {
    const data = CreateAuditLogDTO.parse(input);
    const tenantId = data.tenantId ?? ROOT_TENANT_ID;
    const { tenantId: _ignored, severity: severityOverride, actorTenantId: explicitActorTenantId, commandJti, nodeId, ...rest } = data;
    const severity: AuditSeverity = severityOverride ?? severityForAction(data.action);
    // A break-glass session's act is tagged with its grant (inside the hashed metadata, so it cannot be edited away) and attributed to the fleet tenant
    // in the cross-tenant actor column, stamped from the request context so no call site has to remember to pass it.
    // An explicit actorTenantId (even null) wins.
    const breakGlassGrantId = breakGlassGrantFor(tenantId);
    const actorTenantId = explicitActorTenantId !== undefined ? explicitActorTenantId : breakGlassGrantId ? FLEET_TENANT_ID : null;
    if (breakGlassGrantId) rest.metadata = { ...(rest.metadata ?? {}), breakGlassGrantId };

    // One retry, and only when the database refuses a legacy write for a tenant that has just been sealed: the cached
    // mode was a few seconds old. The second attempt reads the mode afresh and writes the sealed way.
    let written: WrittenRow | null = null;
    for (let attempt = 0; written === null; attempt += 1) {
      const mode = await resolveChainMode(tenantId);
      try {
        written = await withTenantTransactionFor(tenantId, async (qr) => {
          if (mode === 'sealed') {
            return writeSealed(qr, {
              tenantId,
              actorId: rest.actorId ?? null,
              onBehalfOfActorId: rest.onBehalfOfActorId ?? null,
              actorType: rest.actorType,
              action: rest.action,
              severity,
              resourceType: rest.resourceType ?? null,
              resourceId: rest.resourceId ?? null,
              metadata: rest.metadata ?? null,
              ipAddress: rest.ipAddress ?? null,
              userAgent: rest.userAgent ?? null,
              actorTenantId: actorTenantId ?? null,
              commandJti: commandJti ?? null,
              nodeId: nodeId ?? null,
            });
          }
          // Append-only hash chain: link to the previous (non-deleted) row's hash.
          // Read-prev + insert run in ONE transaction under a per-tenant advisory
          // lock (docs/phases/10-db Faz 3). Unserialized, two concurrent writes read the
          // same `prev` and both linked to it — a forked chain that `verifyChain`
          // then reported as tampering, on a trail nobody had touched.
          await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit_log:chain:${tenantId}`]);
          const repo = qr.manager.getRepository(AuditLogRow);
          const prev = await repo.findOne({ where: { tenantId }, order: { createdAt: 'DESC' } });
          const prevHash = prev?.rowHash ?? null;
          // Stamped under the lock, so chain order and createdAt order agree, and
          // strictly after the head. `verifyChain` walks by createdAt, and the head
          // above is "latest createdAt". Two writes in the same millisecond (a
          // request that audits twice), or a pod whose clock runs behind the one
          // that wrote the head, used to produce a tie or an inversion. Either one
          // reordered the chain, so an untouched trail reported tampering.
          // Found 2026-09-25 alongside approval's same-millisecond fork.
          const now = Date.now();
          const headAt = prev?.createdAt ? new Date(prev.createdAt).getTime() : -Infinity;
          const at = new Date(Math.max(now, headAt + 1));
          // The keyed chain (audit_log.02 / .12): the person-bearing fields, IP and user agent included, enter the hash as one
          // keyed digest, and the row hash is an HMAC (audit_log.hash.ts).
          const subjectDigest = auditSubjectDigest({
            actorId: rest.actorId ?? null,
            onBehalfOfActorId: rest.onBehalfOfActorId ?? null,
            metadata: rest.metadata ?? null,
            ipAddress: rest.ipAddress ?? null,
            userAgent: rest.userAgent ?? null,
          });
          const rowHash = computeKeyedRowHash(prevHash, {
            tenantId,
            actorType: rest.actorType,
            action: rest.action,
            severity,
            resourceType: rest.resourceType ?? null,
            resourceId: rest.resourceId ?? null,
            createdAt: at,
            actorTenantId,
            subjectDigest,
          });
          await repo.save(repo.create({ ...rest, tenantId, actorTenantId, severity, prevHash, rowHash, subjectDigest, createdAt: at } as Partial<AuditLogRow>));
          // The external anchor (audit_log.11), in the same transaction and under the same lock.
          await advanceLegacyHead(qr, tenantId, rowHash);
          return { at, actor: data.actorId ?? 'system', sealed: false };
        });
      } catch (err: unknown) {
        if (attempt === 0 && mode === 'legacy' && isSealedRefusal(err)) {
          invalidateChainMode(tenantId);
          continue;
        }
        throw err;
      }
    }
    const createdAt = written.at;

    // audit_log.13 (fixed 2026-10-20): attacker-influenced fields are escaped, so a newline cannot forge a second log line.
    Logger.info(oneLine(
      `[AUDIT] ${data.actorType}:${written.actor}` +
      (data.onBehalfOfActorId && !written.sealed ? ` (on behalf of ${data.onBehalfOfActorId})` : '') +
      (actorTenantId ? ` (delegated from tenant:${actorTenantId})` : '') +
      ` → ${data.action} [${severity}]` +
      (data.resourceType ? ` on ${data.resourceType}:${data.resourceId ?? '?'}` : '') +
      ` [tenant:${tenantId}]`
    ));

    // audit_log:record_sink (phase 55 01 §1.4a): told after the row committed, detached; a slow or failing sink never delays or fails the write.
    try {
      notifyRecordSinks({
        tenantId,
        action: data.action,
        severity,
        actorType: data.actorType,
        actorId: data.actorId ?? null,
        onBehalfOfActorId: data.onBehalfOfActorId ?? null,
        actorTenantId: actorTenantId ?? null,
        resourceType: data.resourceType ?? null,
        resourceId: data.resourceId ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        metadata: rest.metadata ?? null,
        nodeId: nodeId ?? null,
        occurredAt: createdAt,
        sealed: written.sealed,
      });
    } catch {
      // never reached (notifyRecordSinks does not throw); kept so a future change there cannot turn a written row into a reported failure
    }

    // Real-time alert on high-risk events. Fire-and-forget — a webhook failure
    // must never break the audit write.
    if (HIGH_RISK_SEVERITIES.includes(severity)) {
      void WebhookService.dispatchEvent(tenantId, 'audit.high_risk', {
        action: data.action,
        severity,
        actorId: data.actorId ?? null,
        actorType: data.actorType,
        onBehalfOfActorId: data.onBehalfOfActorId ?? null,
        resourceType: data.resourceType ?? null,
        resourceId: data.resourceId ?? null,
        tenantId,
        occurredAt: createdAt.toISOString(),
      }).catch((err: unknown) => {
        Logger.error(`[AUDIT] high_risk webhook dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  } catch (err: unknown) {
    Logger.error(`[AUDIT] Failed to write audit log: ${err instanceof Error ? err.message : String(err)}`);
    // audit_log.05 (fixed 2026-10-20): a lost audit row is surfaced to error monitoring, not only a log line. The write still never
    // throws into the audited operation (callers rely on that).
    await import('@kuraykaraaslan-labs/observability')
      .then((m) => m.default.recordError(err instanceof Error ? err : new Error(String(err)), {
        tenantId: (input as { tenantId?: string } | null)?.tenantId ?? undefined, fingerprint: ['audit_log', 'write_failed'], level: 'error',
        extra: { action: (input as { action?: string } | null)?.action, severity: (input as { severity?: string } | null)?.severity ?? null },
      }))
      .catch(() => undefined);
    if (opts.strict) throw new AppError('The audit trail could not be written', 503, ErrorCode.INTERNAL_ERROR);
  }
}

/** `covered_through` as the function returns it ('YYYY-MM-DD HH24:MI:SS.US', a UTC wall time) as a Date. */
const checkpointDate = (text: string): Date => new Date(`${text.replace(' ', 'T')}Z`);

/**
 * The purge of a SEALED chain: checkpoint (nothing deleted yet), then the optional archive of exactly the rows the checkpoint covers, then the purge.
 * The archive is written before the delete and a failing exporter stops the purge, so a row is never deleted that was meant to be archived; the checkpoint
 * row stays and the next run extends it. The archived rows are the stored ones (pseudonymous: `actorRef`, no resolved identity), so erasure holds for
 * the archive too.
 */
async function purgeSealed(
  tenantId: string, doArchive: boolean, exporter?: AuditArchiveExporter,
): Promise<{ purged: number; cutoff: Date | null; archive: string | null }> {
  const cp = await withTenantTransactionFor(tenantId, async (qr) => {
    const sql = auditSqlNames(qr);
    const fresh = await qr.query(`SELECT * FROM ${sql.fn('audit_chain_checkpoint')}($1)`, [tenantId]) as Array<{ covered_through: string; covered_through_id: string }>;
    if (fresh[0]) return fresh[0];
    // Nothing new may go, but an earlier run can have recorded a checkpoint and then stopped before the purge (a failing exporter, a crash): its rows are
    // still there and the purge is idempotent, so finish that one.
    const [last] = await qr.query(
      `SELECT to_char("coveredThrough", 'YYYY-MM-DD HH24:MI:SS.US') AS covered_through, "coveredThroughId" AS covered_through_id FROM ${sql.checkpoints} WHERE "tenantId" = $1 ORDER BY "coveredThrough" DESC, "coveredThroughId" DESC LIMIT 1`, [tenantId],
    ) as Array<{ covered_through: string; covered_through_id: string }>;
    return last ?? null;
  });
  // Nothing allowed to go: no retention window, nothing old enough, or nothing the control plane has acknowledged yet, and no checkpoint left to finish.
  if (!cp) return { purged: 0, cutoff: null, archive: null };

  let archive: string | null = null;
  if (doArchive) {
    const doomed = await withTenantTransactionFor(tenantId, async (qr) => qr.query(
      `SELECT * FROM ${auditSqlNames(qr).auditLogs} WHERE "tenantId" = $1 AND ("createdAt", "auditLogId") <= ($2::timestamp, $3::uuid) ORDER BY "createdAt", "auditLogId"`,
      [tenantId, cp.covered_through, cp.covered_through_id],
    )) as unknown[];
    if (doomed.length > 0) {
      const ndjson = serializeForArchive(doomed.map((r) => toAuditLog(r)));
      if (exporter) await exporter.export(tenantId, ndjson, doomed.length);
      else archive = ndjson;
    }
  }

  const purged = await withTenantTransactionFor(tenantId, async (qr) => {
    const [res] = await qr.query(`SELECT ${auditSqlNames(qr).fn('audit_chain_purge')}($1) AS "n"`, [tenantId]) as Array<{ n: number }>;
    return Number(res?.n ?? 0);
  });
  Logger.info(`[AuditLog] purgeExpired (sealed) tenant=${tenantId} purged=${purged} through=${cp.covered_through}`);
  return { purged, cutoff: checkpointDate(cp.covered_through), archive };
}

/**
 * Per-tenant configurable retention purge. Deletes (hard-deletes) rows older
 * than the tenant's `auditLogRetentionDays` window. 0 / unset = keep forever
 * → no-op. Optionally serializes the doomed batch to NDJSON before deletion
 * (archive-before-delete); when an exporter is provided it receives the batch
 * before the hard delete, otherwise the NDJSON is returned to the caller.
 */
export async function purgeExpired(
  input: PurgeAuditLogsInput,
  exporter?: AuditArchiveExporter,
  opts: { batchSize?: number } = {},
): Promise<{ purged: number; cutoff: Date | null; archive: string | null }> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? PURGE_BATCH, PURGE_BATCH));
  const parsed = PurgeAuditLogsDTO.safeParse(input);
  if (!parsed.success) {
    throw new AppError(AuditLogMessages.INVALID_INPUT, 400, ErrorCode.VALIDATION_ERROR);
  }
  const { tenantId, archive: doArchive } = parsed.data;

  try {
    // A sealed chain is purged through the database: `audit_chain_checkpoint` records how far the purge may go (rows older than the operator's
    // retention window AND acknowledged by the control plane) and `audit_chain_purge` deletes exactly that. The tenant setting below is the legacy chain's.
    if (await resolveChainMode(tenantId) === 'sealed') return purgeSealed(tenantId, doArchive, exporter);

    const retentionDays = await getRetentionDays(tenantId);
    if (retentionDays <= RETENTION_KEEP_FOREVER) {
      return { purged: 0, cutoff: null, archive: null };
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // audit_log.04 (fixed 2026-10-20, the purge half): in batches of PURGE_BATCH rows, oldest first, so a busy tenant's purge never
    // loads its whole expired trail into memory. Each batch is archived (when asked), then deleted together with the anchor's new
    // base in one transaction under the chain lock (audit_log.02). An inline archive (no exporter) is bounded too: the purge stops
    // at PURGE_INLINE_ARCHIVE_MAX rows and the next run continues where it stopped.
    let purged = 0;
    const archived: string[] = [];
    for (;;) {
      const batch = await withTenantRepositoryFor(tenantId, AuditLogRow, (repo) =>
        // withDeleted: the verifier walks soft-deleted rows too, so the purged run must be the chain's prefix including them.
        repo.find({ where: { tenantId, createdAt: LessThanOrEqual(cutoff) }, order: { createdAt: 'ASC' }, withDeleted: true, take: batchSize }));
      if (batch.length === 0) break;

      if (doArchive) {
        const ndjson = serializeForArchive(batch.map((r) => toAuditLog(r)));
        if (exporter) await exporter.export(tenantId, ndjson, batch.length);
        else archived.push(ndjson);
      }

      // Hard delete after archive (purge bypasses the soft-delete guard). The
      // exporter (external I/O) ran while no block was open (docs/phases/10-db Faz 3).
      await withTenantTransactionFor(tenantId, async (qr) => {
        await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit_log:chain:${tenantId}`]);
        await qr.manager.getRepository(AuditLogRow).delete(batch.map((r) => r.auditLogId));
        await rebaseLegacyHead(qr, tenantId, batch[batch.length - 1]!.rowHash ?? null, batch.filter((r) => r.hashVersion == null).length);
      });
      purged += batch.length;
      if (batch.length < batchSize) break;
      if (doArchive && !exporter && purged >= PURGE_INLINE_ARCHIVE_MAX) break;
    }
    if (purged === 0) return { purged: 0, cutoff, archive: null };
    Logger.info(`[AuditLog] purgeExpired tenant=${tenantId} purged=${purged} cutoff=${cutoff.toISOString()}`);
    return { purged, cutoff, archive: doArchive && !exporter ? archived.join('\n') : null };
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.error(`[AuditLog] purgeExpired failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.PURGE_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}

/**
 * Right-to-erasure (GDPR Art. 17): pseudonymize an actor across the tenant's
 * audit trail. Nulls `actorId` / `onBehalfOfActorId`, stores a stable hash of
 * the erased id for correlation, and scrubs PII-ish metadata — while
 * preserving the row + action (audit completeness).
 */
export async function anonymizeActor(input: AnonymizeActorInput): Promise<{ anonymized: number }> {
  const parsed = AnonymizeActorDTO.safeParse(input);
  if (!parsed.success) {
    throw new AppError(AuditLogMessages.INVALID_INPUT, 400, ErrorCode.VALIDATION_ERROR);
  }
  const { tenantId, actorId } = parsed.data;

  try {
    // A sealed chain keeps identities in audit_actor_identities, not in the rows: the scrub below would find nothing and
    // report success while the actor stays resolvable. Erasure there withdraws the identity from the mapping, through a SECURITY
    // DEFINER function that also appends the `audit.anonymised` row (migration 005). No audit row and no hashed column changes.
    if (await resolveChainMode(tenantId) === 'sealed') {
      const anonymized = await withTenantTransactionFor(tenantId, async (qr) => {
        const [res] = await qr.query(`SELECT ${auditSqlNames(qr).fn('audit_anonymise_actor')}($1, $2) AS "rows"`, [tenantId, actorId]) as Array<{ rows: number }>;
        return Number(res?.rows ?? 0);
      });
      if (anonymized > 0) Logger.info(`[AuditLog] anonymizeActor (sealed) tenant=${tenantId} rows=${anonymized}`);
      return { anonymized };
    }
    const pseudonym = erasurePseudonym(actorId);

    // Find + rewrite in ONE transaction: an erasure either covers every row
    // of the actor or none (docs/phases/10-db Faz 3).
    const rows = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(AuditLogRow);
      const found = await repo.find({
        where: [
          { tenantId, actorId },
          { tenantId, onBehalfOfActorId: actorId },
        ],
      });
      if (found.length === 0) return found;

      for (const row of found) {
        if (row.actorId === actorId) row.actorId = null;
        if (row.onBehalfOfActorId === actorId) row.onBehalfOfActorId = null;
        row.metadata = scrubMetadata(row.metadata);
        const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata as Record<string, unknown> : {};
        row.metadata = { ...meta, anonymizedActor: pseudonym, anonymizedAt: new Date().toISOString() };
        row.ipAddress = null;
        row.userAgent = null;
        // A keyed row's erasure is sealed (audit_log.02): the chain still verifies over the stored subject digest, and the scrubbed
        // values are bound to the row by the server key. A v1 row (before 2026-10-20) has no digest and reports broken once erased.
        if (row.subjectDigest && row.rowHash) row.erasureSeal = auditErasureSeal(row.rowHash, { actorId: row.actorId ?? null, onBehalfOfActorId: row.onBehalfOfActorId ?? null, metadata: row.metadata, ipAddress: row.ipAddress ?? null, userAgent: row.userAgent ?? null });
      }
      await repo.save(found);
      return found;
    });
    if (rows.length === 0) return { anonymized: 0 };
    Logger.info(`[AuditLog] anonymizeActor tenant=${tenantId} rows=${rows.length}`);
    return { anonymized: rows.length };
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.error(`[AuditLog] anonymizeActor failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(AuditLogMessages.ANONYMIZE_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
}
