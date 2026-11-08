import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import { SafeWebhookSchema } from './webhook.types';
import type { SafeWebhook } from './webhook.types';
import { WEBHOOK_SORTABLE, type CreateWebhookInput, type UpdateWebhookInput, type ListWebhooksInput, type ListWebhooksQuery } from './webhook.dto';
import { compactWhere, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { IsNull, Not } from 'typeorm';
import { assertSafeWebhookUrlSync } from './webhook.ssrf';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import WebhookMessages from './webhook.messages';
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { generateSecret } from './webhook.crypto';
import { sealWebhookSecret } from './webhook.secrets';
import { scopeForTenant, undeclaredEvents } from './webhook.catalog';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';

/**
 * Refuse events no installed module declares for the tenant's scope (`webhook:event_type`): a tenant cannot subscribe
 * to a platform event, nor to an event of a module this build does not carry. `kept` are names the webhook already
 * holds: an update may keep an event whose module was removed since (it never fires) but may not add one.
 */
export async function assertSubscribableEvents(tenantId: string, events: readonly string[], kept: readonly string[] = []): Promise<void> {
  const added = events.filter((e) => !kept.includes(e));
  if (!added.length) return;
  const unknown = await undeclaredEvents(added, scopeForTenant(isRootTenant(tenantId)));
  if (unknown.length) {
    throw new AppError(`${WebhookMessages.EVENTS_UNDECLARED} (${unknown.join(', ')})`, 422, ErrorCode.VALIDATION_ERROR);
  }
}

/** Lifecycle audit trail for webhook administration and manual sends (best-effort). */
export function auditWebhook(tenantId: string, actorId: string | null, action: string, webhookId: string, metadata?: Record<string, unknown>): void {
  AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'USER' : 'SYSTEM',
    action,
    resourceType: 'Webhook',
    resourceId: webhookId,
    metadata: metadata ?? {},
  }).catch(() => {});
}

/**
 * Endpoint management for webhooks: CRUD plus signing-secret rotation. Split out
 * of {@link WebhookService} (which owns dispatch/delivery) so endpoint
 * administration stays self-contained. All inputs are SSRF-pre-checked.
 */
export default class WebhookCrudService {

  static async list(
    { tenantId, page, pageSize, ...q }: ListWebhooksInput & Partial<Pick<ListWebhooksQuery, 'sort' | 'search' | 'isActive' | 'autoDisabled'>>,
  ): Promise<{ webhooks: SafeWebhook[]; total: number }> {
    const where = compactWhere({
      tenantId,
      isActive: q.isActive,
      autoDisabledAt: q.autoDisabled === undefined ? undefined : q.autoDisabled ? Not(IsNull()) : IsNull(),
    });
    const [rows, total] = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo.findAndCount({
      where: searchWhere(where, q.search, ['name', 'url', 'description']),
      order: toOrder(q.sort ?? [{ field: 'createdAt', dir: 'desc' }], WEBHOOK_SORTABLE, { webhookId: 'ASC' }),
      skip: Math.max(0, (page - 1) * pageSize),
      take: pageSize,
    }));
    return { webhooks: rows.map((r) => SafeWebhookSchema.parse(r)), total };
  }

  static async getById(tenantId: string, webhookId: string): Promise<SafeWebhook> {
    const row = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo.findOne({ where: { webhookId, tenantId } }));
    if (!row) throw new AppError(WebhookMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    return SafeWebhookSchema.parse(row);
  }

  /** Create an endpoint. Callers that must hand the signing secret to a person use {@link createWithSecret}. */
  static async create(tenantId: string, createdByUserId: string, input: CreateWebhookInput): Promise<SafeWebhook> {
    return (await WebhookCrudService.createWithSecret(tenantId, createdByUserId, input)).webhook;
  }

  /**
   * Create an endpoint and return its generated signing secret ONCE, in this answer only (41-ui-fixes/12 1.3, decision a).
   * Every delivery is signed with it; before this, nobody could read it (rotation needs OWNER), so an ADMIN who created
   * an endpoint could never verify a single delivery. Nothing else ever returns it: the endpoint answers are `SafeWebhook`.
   */
  static async createWithSecret(tenantId: string, createdByUserId: string, input: CreateWebhookInput): Promise<{ webhook: SafeWebhook; secret: string }> {
    // SSRF pre-check (no DNS) — instant feedback on obviously-internal targets.
    assertSafeWebhookUrlSync(input.url, input.ipAllowlist);
    await assertSubscribableEvents(tenantId, input.events);
    // sealed under the tenant's data key before the tenant block opens (P7-TDEK, webhook.secrets.ts)
    const plainSecret = generateSecret();
    const secret = await sealWebhookSecret(tenantId, plainSecret);

    const saved = await withTenantRepositoryFor(tenantId, WebhookEntity, async (repo) => {

      const entity = repo.create({
        tenantId,
        createdByUserId,
        name: input.name,
        description: input.description ?? null,
        url: input.url,
        secret,
        events: input.events,
        headers: input.headers ?? null,
        eventFilters: input.eventFilters ?? null,
        tags: input.tags ?? null,
        rateLimitPerMinute: input.rateLimitPerMinute ?? null,
        ipAllowlist: input.ipAllowlist ?? null,
        format: input.format ?? 'json',
        isActive: true,
      });

      return repo.save(entity);
    });
    auditWebhook(tenantId, createdByUserId, 'webhook.created', saved.webhookId, { name: saved.name, url: saved.url, events: saved.events });
    return { webhook: SafeWebhookSchema.parse(saved), secret: plainSecret };
  }

  /** `actorId`: the caller (webhook.07); the audit row names it. */
  static async update(tenantId: string, webhookId: string, input: UpdateWebhookInput, actorId: string | null = null): Promise<SafeWebhook> {
    const saved = await withTenantRepositoryFor(tenantId, WebhookEntity, async (repo) => {

      const row = await repo.findOne({ where: { webhookId, tenantId } });
      if (!row) throw new AppError(WebhookMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);

      // Re-run the SSRF pre-check whenever the URL or allowlist changes.
      if (input.url !== undefined || input.ipAllowlist !== undefined) {
        assertSafeWebhookUrlSync(input.url ?? row.url, input.ipAllowlist ?? row.ipAllowlist);
      }

      if (input.name !== undefined) row.name = input.name;
      if (input.description !== undefined) row.description = input.description ?? null;
      if (input.url !== undefined) row.url = input.url;
      if (input.events !== undefined) {
        await assertSubscribableEvents(tenantId, input.events, row.events);
        row.events = input.events;
      }
      if (input.headers !== undefined) row.headers = input.headers;
      if (input.eventFilters !== undefined) row.eventFilters = input.eventFilters;
      if (input.tags !== undefined) row.tags = input.tags;
      if (input.rateLimitPerMinute !== undefined) row.rateLimitPerMinute = input.rateLimitPerMinute;
      if (input.ipAllowlist !== undefined) row.ipAllowlist = input.ipAllowlist;
      if (input.format !== undefined) row.format = input.format;
      if (input.isActive !== undefined) {
        row.isActive = input.isActive;
        // Re-enabling (manually or after an auto-disable) clears the circuit breaker.
        if (input.isActive) {
          row.autoDisabledAt = null;
          row.consecutiveFailures = 0;
        }
      }

      return repo.save(row);
    });
    auditWebhook(tenantId, actorId, 'webhook.updated', saved.webhookId, { fields: Object.keys(input), isActive: saved.isActive });
    return SafeWebhookSchema.parse(saved);
  }

  static async delete(tenantId: string, webhookId: string, actorId: string | null = null): Promise<void> {
    const row = await withTenantRepositoryFor(tenantId, WebhookEntity, async (repo) => {
      const row = await repo.findOne({ where: { webhookId, tenantId } });
      if (!row) throw new AppError(WebhookMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      await repo.remove(row);
      return row;
    });
    auditWebhook(tenantId, actorId, 'webhook.deleted', webhookId, { name: row.name });
  }

  /**
   * Rotate a webhook's signing secret. The previous secret is kept valid for
   * `overlapMs` (default 48h) so subscribers can swap without dropped events;
   * outgoing requests carry both the new `X-Webhook-Signature` and the
   * `X-Webhook-Signature-Prev` header during the window. Returns the new secret
   * exactly once — callers MUST display it immediately and never persist it.
   *
   * 41-ui-fixes/12 1.7 (decision b, revised): a rotation while the previous secret's window still runs replaces ONLY the
   * current secret. The previous secret and its end date are left as they are, so subscribers still verifying with it
   * keep working until that end date, and a leaked new secret can be replaced at once (a refusal kept it live for up to
   * 168 h). A second rotation used to move the current secret into the overlap slot, dropping the one subscribers still
   * verified with at once. The row is read locked, so two concurrent rotations cannot both read the same overlap state.
   * The answer's `webhook.previousSecretExpiresAt` is the previous secret's end date either way.
   */
  static async rotateSecret(
    tenantId: string,
    webhookId: string,
    overlapMs: number = 48 * 60 * 60 * 1000,
    actorId: string | null = null,
  ): Promise<{ webhook: SafeWebhook; newSecret: string }> {
    // the new secret is sealed under the tenant's data key before the tenant block opens (P7-TDEK, webhook.secrets.ts); the current one moves to
    // the overlap slot as it is stored (a tenant envelope stays one, a legacy value is sealed by the column's transformer)
    const newSecret = generateSecret();
    const sealed = await sealWebhookSecret(tenantId, newSecret);
    const { saved, overlapStarted } = await withTenantRepositoryFor(tenantId, WebhookEntity, async (repo) => {

      const row = await repo.findOne({ where: { webhookId, tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new AppError(WebhookMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      const overlapOpen = !!row.previousSecret && !!row.previousSecretExpiresAt && row.previousSecretExpiresAt.getTime() > Date.now();

      // (41-ui-fixes/12 1.7) inside an open overlap only the current secret changes; the previous one keeps its end date
      if (!overlapOpen) {
        row.previousSecret = row.secret;
        row.previousSecretExpiresAt = new Date(Date.now() + overlapMs);
      }
      row.secret = sealed;

      return { saved: await repo.save(row), overlapStarted: !overlapOpen };
    });
    auditWebhook(tenantId, actorId, 'webhook.secret_rotated', webhookId, { overlapMs });
    Logger.info(
      `[Webhook] Secret rotated for webhook=${webhookId} tenant=${tenantId} (${overlapStarted ? `overlap=${overlapMs}ms` : 'current secret replaced inside the open overlap'})`,
    );
    return { webhook: SafeWebhookSchema.parse(saved), newSecret };
  }
}
