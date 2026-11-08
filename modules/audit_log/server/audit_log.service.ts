import 'reflect-metadata';
import type { AuditLog, ChainVerificationResult, AuditArchiveExporter } from './audit_log.types';
import type {
  CreateAuditLogInput,
  GetAuditLogsInput,
  PurgeAuditLogsInput,
  ExportAuditLogsInput,
  AnonymizeActorInput,
  CrossTenantAuditQueryInput,
} from './audit_log.dto';
import { computeRowHash, scrubMetadata } from './audit_log.hash';
import { serializeForArchive, serializeForCsv } from './audit_log.serialize';
import {
  getAll, exportLogs, verifyChain, verifyChainStatus, queryCrossTenant, getChainHead, actionActivityCrossTenant,
  type ActionActivity, type ActionActivityInput,
} from './audit_log.query';
import { log, purgeExpired, anonymizeActor } from './audit_log.write.service';

/**
 * Audit-log service facade. The implementation is split across focused modules
 * (`audit_log.write.service`, `audit_log.query`, plus the `audit_log.hash` /
 * `audit_log.serialize` helpers); this class preserves the single
 * `AuditLogService.*` entry point its callers depend on.
 */
export default class AuditLogService {
  static log(input: CreateAuditLogInput, opts?: { strict?: boolean }): Promise<void> {
    return log(input, opts);
  }

  static getAll(input: GetAuditLogsInput): Promise<{ logs: AuditLog[]; total: number }> {
    return getAll(input);
  }

  static purgeExpired(
    input: PurgeAuditLogsInput,
    exporter?: AuditArchiveExporter,
  ): Promise<{ purged: number; cutoff: Date | null; archive: string | null }> {
    return purgeExpired(input, exporter);
  }

  static anonymizeActor(input: AnonymizeActorInput): Promise<{ anonymized: number }> {
    return anonymizeActor(input);
  }

  static exportLogs(input: ExportAuditLogsInput): Promise<{ format: 'csv' | 'ndjson'; body: string; count: number; truncated: boolean }> {
    return exportLogs(input);
  }

  static verifyChain(tenantId: string): Promise<ChainVerificationResult> {
    return verifyChain(tenantId);
  }

  /** The verdict as a code only (`audit.chain_ok` reports a status, never a row or an id). */
  static getChainHead(tenantId: string) {
    return getChainHead(tenantId);
  }

  static verifyChainStatus(tenantId: string): Promise<'CHAIN_OK' | 'CHAIN_BROKEN'> {
    return verifyChainStatus(tenantId);
  }

  static queryCrossTenant(callerTenantId: string, input: CrossTenantAuditQueryInput) {
    return queryCrossTenant(callerTenantId, input);
  }

  /** Per-window counts and the newest rows of exact actions across every tenant; root tenant only, bounded (audit_log.query). */
  static actionActivityCrossTenant(callerTenantId: string, input: ActionActivityInput): Promise<ActionActivity> {
    return actionActivityCrossTenant(callerTenantId, input);
  }

  static computeRowHash(...args: Parameters<typeof computeRowHash>): string {
    return computeRowHash(...args);
  }

  static scrubMetadata(metadata: unknown): Record<string, unknown> | null {
    return scrubMetadata(metadata);
  }

  static serializeForArchive(rows: AuditLog[]): string {
    return serializeForArchive(rows);
  }

  static serializeForCsv(rows: AuditLog[]): string {
    return serializeForCsv(rows);
  }
}
