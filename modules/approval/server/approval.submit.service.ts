import 'reflect-metadata';
import { In } from 'typeorm';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ApprovalQueueItem as ApprovalQueueItemEntity } from './entities/approval_queue_item.entity';
import { ApprovalQueueItemSchema, type ApprovalQueueItem } from './approval.types';
import type { SubmitApprovalDTO } from './approval.dto';
import { APPROVAL_MESSAGES as MSG } from './approval.messages';
import { approvalSlaDueAt, sealDecision, type ApprovalSlaHoursMap } from './approval.constants';
import { OPEN_APPROVAL_STATUSES } from './approval.enums';
import { APPROVAL_SLA_HOUR_KEYS } from './approval.setting.keys';
import { chainOnInsert } from './approval.chain';

const UNIQUE_VIOLATION = '23505';

/**
 * Resolve the per-tenant SLA-hours override map from flat SettingService keys
 * (`approvalSlaHours{Routine,Elevated,High,Urgent}`). Any key left unset falls
 * back to the hardcoded APPROVAL_SLA_HOURS default inside `approvalSlaDueAt`.
 * `slaDueAt` is not hashed, so this is chain-safe. Best-effort — a settings
 * read failure quietly yields the hardcoded defaults.
 */
async function resolveSlaHoursMap(tenantId: string): Promise<ApprovalSlaHoursMap> {
  try {
    const values = await SettingService.getByKeys(tenantId, [...APPROVAL_SLA_HOUR_KEYS]);
    const map: Record<number, number> = {};
    APPROVAL_SLA_HOUR_KEYS.forEach((key, priority) => {
      const raw = values?.[key];
      const parsed = raw != null && raw !== '' ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) map[priority] = parsed;
    });
    return map;
  } catch {
    return {};
  }
}

/** JSON with object keys sorted (jsonb does not keep key order), for comparing two metadata documents. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * Submit an entity for review. Idempotent: if an OPEN item already exists for
 * `(entityType, entityId)` it is returned unchanged; otherwise a PENDING item
 * is created, hash-chained, and a `approval.submitted` webhook is
 * fired (fire-and-forget).
 */
export async function submit(tenantId: string, dto: SubmitApprovalDTO): Promise<ApprovalQueueItem> {
  const slaHoursMap = await resolveSlaHoursMap(tenantId);
  try {
    // Idempotency check, insert and chain link in ONE tenant-scoped transaction;
    // the webhook below fires only after it commits.
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(ApprovalQueueItemEntity);

      const existing = await repo.findOne({
        where: {
          tenantId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          status: In([...OPEN_APPROVAL_STATUSES]),
        },
        order: { createdAt: 'DESC' },
      });
      if (existing) {
        // approval.02 (fixed 2026-10-20): the open item is returned as is only when it is the SAME request (same submitter, same
        // metadata). An item someone else pre-seeded for this entity, with their own metadata, is withdrawn and replaced, so the
        // owning module never acts on an attacker's metadata.
        const sameRequest = (existing.submittedByUserId ?? null) === (dto.submittedByUserId ?? null)
          && stableJson(existing.metadata ?? null) === stableJson(dto.metadata ?? null);
        if (sameRequest) return { row: existing, created: false };
        // Saved through the entity (not a bare update) so the decision seal is rewritten with it (approval.06).
        Object.assign(existing, {
          status: 'WITHDRAWN', decisionNote: 'Superseded by a new submission for the same entity', reviewedAt: new Date(),
        });
        await repo.save(sealDecision(existing));
      }

      const createdAt = new Date();
      const built = repo.create({
        tenantId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        submittedByUserId: dto.submittedByUserId ?? null,
        status: 'PENDING',
        priority: dto.priority,
        reason: dto.reason ?? null,
        decisionNote: null,
        reviewedByUserId: null,
        reviewedAt: null,
        slaDueAt: approvalSlaDueAt(dto.priority, createdAt, slaHoursMap),
        metadata: dto.metadata ?? null,
        createdAt,
      });
      const persisted = await repo.save(built);
      const chained = await chainOnInsert(qr, tenantId, persisted);
      return { row: chained, created: true };
    });

    const item = ApprovalQueueItemSchema.parse(saved.row);
    if (saved.created) {
      void WebhookService.dispatchEvent(tenantId, 'approval.submitted', {
        approvalItemId: item.approvalItemId,
        entityType: item.entityType,
        entityId: item.entityId,
        priority: item.priority,
      }).catch((err) => Logger.error(`[approval] webhook dispatch failed: ${err}`));
    }
    return item;
  } catch (error) {
    // Lost the create race against the partial unique index — re-read the open
    // item in a FRESH block: the violation aborted the transaction above.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      const row = await withTenantRepositoryFor(tenantId, ApprovalQueueItemEntity, (repo) => repo.findOne({
        where: {
          tenantId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          status: In([...OPEN_APPROVAL_STATUSES]),
        },
        order: { createdAt: 'DESC' },
      }));
      if (row) return ApprovalQueueItemSchema.parse(row);
    }
    if (!(error instanceof AppError)) Logger.error(`${MSG.SUBMIT_FAILED}: ${error}`);
    throw error;
  }
}

/** Claim a PENDING item for review (PENDING → IN_REVIEW). */
export async function claim(
  tenantId: string,
  reviewerUserId: string,
  approvalItemId: string,
): Promise<ApprovalQueueItem> {
  const row = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(ApprovalQueueItemEntity);
    const item = await repo.findOne({
      where: { tenantId, approvalItemId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) throw new AppError(MSG.APPROVAL_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (item.status !== 'PENDING') {
      throw new AppError(MSG.CLAIM_FAILED, 409, ErrorCode.CONFLICT);
    }
    item.status = 'IN_REVIEW';
    item.reviewedByUserId = reviewerUserId;
    // A claim does not re-chain (the row hash covers immutable insert-time content), but it re-seals the decision state
    // (approval.06), so the claimed reviewer cannot be swapped afterwards either.
    return repo.save(sealDecision(item));
  });
  return ApprovalQueueItemSchema.parse(row);
}
