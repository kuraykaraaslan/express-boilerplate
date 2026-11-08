import 'reflect-metadata';
import type { SelectQueryBuilder } from 'typeorm';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import { WebhookDelivery as WebhookDeliveryEntity } from './entities/webhook_delivery.entity';
import { WebhookDeliveryListRowSchema, WEBHOOK_DELIVERY_LIST_COLUMNS } from './webhook.types';
import type {
  WebhookDeliveryListRow,
  WebhookMetrics,
  WebhookReport,
  WebhookTimeSeriesPoint,
  WebhookFailurePattern,
  WebhookResponseCodeBucket,
  WebhookEndpointReliability,
  WebhookAutoDisabledEndpoint,
} from './webhook.types';
import { escapeLike } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { DELIVERY_SORTABLE, type ListDeliveriesInput } from './webhook.dto';
import { replayableDeadLetterWhere, WEBHOOK_ENDPOINT_DISABLED } from './webhook.dead-letters';

type DeliveryScope = { webhookId?: string; since?: Date };

/**
 * 41-ui-fixes/12 3.6, 4.3: a row the worker dead-lettered because its endpoint was disabled before the job ran was never
 * sent. It is not a failure of the receiver, so the failure counts, the success rate, the daily chart and the error
 * patterns leave it out and count it as its own outcome (`skipped`). It stays a dead letter for the replay.
 * The code is a constant of this module, never input, so it is written into the SQL as a literal.
 */
const NEVER_SENT_SQL = `(d."status" = 'DEAD_LETTERED' AND d."errorMessage" = '${WEBHOOK_ENDPOINT_DISABLED}')`;
/** A finished delivery that was sent and failed: FAILED, or DEAD_LETTERED for any reason but a disabled endpoint. */
const SENT_AND_FAILED_SQL = `(d."status" = 'FAILED' OR (d."status" = 'DEAD_LETTERED' AND d."errorMessage" IS DISTINCT FROM '${WEBHOOK_ENDPOINT_DISABLED}'))`;
/** Every row but the never-sent ones (null-safe: a row without an error message is kept). */
const WAS_SENT_SQL = `(d."status" <> 'DEAD_LETTERED' OR d."errorMessage" IS DISTINCT FROM '${WEBHOOK_ENDPOINT_DISABLED}')`;

/**
 * Read-side queries over `webhook_deliveries`: paginated delivery listing,
 * aggregate delivery metrics, and the reporting suite (daily time-series,
 * failure analysis, per-endpoint reliability). Split out of {@link WebhookService}
 * so the Postgres-specific reporting stays isolated from the dispatch/delivery path.
 */
export default class WebhookMetricsService {

  /**
   * Shared scoped query builder over `webhook_deliveries` (tenant + optional
   * webhook + optional `since` window). Reused across every aggregate below.
   */
  private static scoped(
    repo: import('typeorm').Repository<WebhookDeliveryEntity>,
    tenantId: string,
    opts: DeliveryScope,
  ): SelectQueryBuilder<WebhookDeliveryEntity> {
    const qb = repo.createQueryBuilder('d').where('d."tenantId" = :tenantId', { tenantId });
    if (opts.webhookId) qb.andWhere('d."webhookId" = :webhookId', { webhookId: opts.webhookId });
    if (opts.since) qb.andWhere('d."createdAt" >= :since', { since: opts.since });
    return qb;
  }

  static async listDeliveries(
    { tenantId, webhookId, page, pageSize, sort, search, status, event, createdFrom, createdTo, from, to }: ListDeliveriesInput,
  ): Promise<{ deliveries: WebhookDeliveryListRow[]; total: number }> {
    return withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, async (repo) => {
      const qb = repo
        .createQueryBuilder('d')
        // The list's columns only (41-ui-fixes/12 3.8): never the payload, the request body or the response body.
        .select(WEBHOOK_DELIVERY_LIST_COLUMNS.map((c) => `d.${c}`))
        .where('d."tenantId" = :tenantId', { tenantId })
        .andWhere('d."webhookId" = :webhookId', { webhookId });

      const statuses = status === undefined ? [] : Array.isArray(status) ? status : [status];
      if (statuses.length === 1) qb.andWhere('d."status" = :status', { status: statuses[0] });
      else if (statuses.length > 1) qb.andWhere('d."status" IN (:...statuses)', { statuses });
      if (event) qb.andWhere('d."event" = :event', { event });
      else if (search) qb.andWhere(`d."event" ILIKE :search ESCAPE '\\'`, { search: `%${escapeLike(search)}%` });
      if (createdFrom) qb.andWhere('d."createdAt" >= :createdFrom', { createdFrom: new Date(`${createdFrom}T00:00:00.000Z`) });
      if (createdTo) qb.andWhere('d."createdAt" < :createdTo', { createdTo: new Date(Date.parse(`${createdTo}T00:00:00.000Z`) + 86_400_000) });
      if (from) qb.andWhere('d."createdAt" >= :from', { from });
      if (to) qb.andWhere('d."createdAt" <= :to', { to });

      // Columns come only from the whitelist; the id breaks ties so pages never overlap.
      const order = sort?.length ? sort : [{ field: 'createdAt' as const, dir: 'desc' as const }];
      order.forEach((o, i) => {
        const col = `d."${DELIVERY_SORTABLE[o.field]}"`;
        const dir = o.dir === 'asc' ? 'ASC' : 'DESC';
        if (i === 0) qb.orderBy(col, dir); else qb.addOrderBy(col, dir);
      });
      qb.addOrderBy('d."deliveryId"', 'ASC');

      const [rows, total] = await qb
        .skip(Math.max(0, (page - 1) * pageSize))
        .take(pageSize)
        .getManyAndCount();

      return { deliveries: rows.map((r) => WebhookDeliveryListRowSchema.parse(r)), total };
    });
  }

  /**
   * Aggregate delivery metrics from `webhook_deliveries` for a tenant (optionally
   * one webhook / a time window): counts by status, success rate over terminal
   * deliveries, avg + p95 duration, and a per-event breakdown. Postgres-specific
   * (`PERCENTILE_CONT`, `FILTER`). Rows never sent because the endpoint was
   * disabled are `skipped`, not in `byStatus.DEAD_LETTERED` nor in the rate (41-ui-fixes/12 3.6).
   */
  static async getMetrics(
    tenantId: string,
    opts: DeliveryScope = {},
  ): Promise<WebhookMetrics> {
    return withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, async (repo) => {

        const statusRaw = await this.scoped(repo, tenantId, opts)
          .select('d."status"', 'status')
          .addSelect('COUNT(*)', 'count')
          .addSelect(`COUNT(*) FILTER (WHERE ${NEVER_SENT_SQL})`, 'neverSent')
          .groupBy('d."status"')
          .getRawMany<{ status: string; count: string; neverSent?: string | null }>();

        const byStatus: Record<string, number> = {};
        let skipped = 0;
        for (const r of statusRaw) {
          const neverSent = Number(r.neverSent ?? 0) || 0;
          skipped += neverSent;
          const sent = Number(r.count) - neverSent;
          if (sent > 0 || neverSent === 0) byStatus[r.status] = sent;
        }
        const total = Object.values(byStatus).reduce((a, b) => a + b, 0) + skipped;
        const success = byStatus.SUCCESS ?? 0;
        const terminal = success + (byStatus.DEAD_LETTERED ?? 0) + (byStatus.FAILED ?? 0);
        const successRate = terminal > 0 ? success / terminal : null;

        const durRaw = await this.scoped(repo, tenantId, opts)
          .andWhere('d."duration" IS NOT NULL')
          .select('AVG(d."duration")', 'avg')
          .addSelect('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY d."duration")', 'p95')
          .getRawOne<{ avg: string | null; p95: string | null }>();

        const eventRaw = await this.scoped(repo, tenantId, opts)
          .select('d."event"', 'event')
          .addSelect('COUNT(*)', 'count')
          .addSelect(`COUNT(*) FILTER (WHERE d."status" = 'SUCCESS')`, 'success')
          .groupBy('d."event"')
          .orderBy('count', 'DESC')
          .limit(20)
          .getRawMany<{ event: string; count: string; success: string }>();

        return {
          total,
          byStatus,
          skipped,
          successRate,
          avgDurationMs: durRaw?.avg != null ? Math.round(Number(durRaw.avg)) : null,
          p95DurationMs: durRaw?.p95 != null ? Math.round(Number(durRaw.p95)) : null,
          byEvent: eventRaw.map((r) => ({ event: r.event, count: Number(r.count), success: Number(r.success) })),
        };
    });
  }

  /**
   * Daily delivery outcomes over the window: total, success, failure (FAILED +
   * DEAD_LETTERED, but not the rows never sent) and skipped (never sent: the
   * endpoint was disabled; 41-ui-fixes/12 4.3) counts per UTC day, oldest → newest.
   * Backs the success-rate-over-time chart on the detail Overview tab.
   */
  static async getTimeSeries(tenantId: string, opts: DeliveryScope = {}): Promise<WebhookTimeSeriesPoint[]> {
    return withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, async (repo) => {

        const rows = await this.scoped(repo, tenantId, opts)
          .select(`date_trunc('day', d."createdAt")`, 'day')
          .addSelect('COUNT(*)', 'total')
          .addSelect(`COUNT(*) FILTER (WHERE d."status" = 'SUCCESS')`, 'success')
          .addSelect(`COUNT(*) FILTER (WHERE ${SENT_AND_FAILED_SQL})`, 'failed')
          .addSelect(`COUNT(*) FILTER (WHERE ${NEVER_SENT_SQL})`, 'skipped')
          .groupBy('day')
          .orderBy('day', 'ASC')
          .getRawMany<{ day: string; total: string; success: string; failed: string; skipped?: string | null }>();

        return rows.map((r) => ({
          day: new Date(r.day).toISOString(),
          total: Number(r.total),
          success: Number(r.success),
          failed: Number(r.failed),
          skipped: Number(r.skipped ?? 0) || 0,
        }));
    });
  }

  /**
   * Failure analysis over the window: top recurring error messages and the
   * response-code histogram. Both restricted to terminal failures
   * (FAILED / DEAD_LETTERED) for the error patterns; the histogram spans all rows.
   * Rows never sent (the endpoint was disabled) are in neither: they had no
   * receiver to fail or answer (41-ui-fixes/12 3.6).
   */
  static async getFailureAnalysis(
    tenantId: string,
    opts: DeliveryScope = {},
  ): Promise<{ topErrors: WebhookFailurePattern[]; responseCodes: WebhookResponseCodeBucket[] }> {
    return withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, async (repo) => {

        const errorRaw = await this.scoped(repo, tenantId, opts)
          .andWhere(SENT_AND_FAILED_SQL)
          .andWhere('d."errorMessage" IS NOT NULL')
          .select('d."errorMessage"', 'errorMessage')
          .addSelect('COUNT(*)', 'count')
          .groupBy('d."errorMessage"')
          .orderBy('count', 'DESC')
          .limit(10)
          .getRawMany<{ errorMessage: string; count: string }>();

        const codeRaw = await this.scoped(repo, tenantId, opts)
          .andWhere(WAS_SENT_SQL)
          .select('d."responseStatus"', 'responseStatus')
          .addSelect('COUNT(*)', 'count')
          .groupBy('d."responseStatus"')
          .orderBy('count', 'DESC')
          .getRawMany<{ responseStatus: number | null; count: string }>();

        return {
          topErrors: errorRaw.map((r) => ({ errorMessage: r.errorMessage, count: Number(r.count) })),
          responseCodes: codeRaw.map((r) => ({
            responseStatus: r.responseStatus != null ? Number(r.responseStatus) : null,
            count: Number(r.count),
          })),
        };
    });
  }

  /**
   * Per-endpoint reliability snapshot: current circuit-breaker counters
   * (from the webhook row), the timestamp of the last successful delivery, and
   * how many dead letters a replay would re-send now (`deadLetteredCount`, the
   * replay's own criteria, no window: 41-ui-fixes/12 1.4).
   */
  static async getEndpointReliability(tenantId: string, webhookId: string): Promise<WebhookEndpointReliability> {
    const { webhook, lastSuccess, deadLetteredCount } = await withTenantTransactionFor(tenantId, async (qr) => {
      const webhook = await qr.manager.getRepository(WebhookEntity).findOne({ where: { tenantId, webhookId } });

      const lastSuccess = await qr.manager.getRepository(WebhookDeliveryEntity)
        .createQueryBuilder('d')
        .where('d."tenantId" = :tenantId', { tenantId })
        .andWhere('d."webhookId" = :webhookId', { webhookId })
        .andWhere(`d."status" = 'SUCCESS'`)
        .select('MAX(d."createdAt")', 'lastSuccessAt')
        .getRawOne<{ lastSuccessAt: Date | null }>();
      const deadLetteredCount = await qr.manager.getRepository(WebhookDeliveryEntity)
        .count({ where: replayableDeadLetterWhere(tenantId, webhookId) });
      return { webhook, lastSuccess, deadLetteredCount };
    });

    return {
      webhookId,
      consecutiveFailures: webhook?.consecutiveFailures ?? 0,
      autoDisabledAt: webhook?.autoDisabledAt ? webhook.autoDisabledAt.toISOString() : null,
      lastSuccessAt: lastSuccess?.lastSuccessAt ? new Date(lastSuccess.lastSuccessAt).toISOString() : null,
      deadLetteredCount,
    };
  }

  /**
   * How many dead letters "Replay" would re-send right now, with the replay's own criteria (`replayableDeadLetterWhere`:
   * DEAD_LETTERED, test sends excluded, no window). Answered by GET …/deliveries/replay-dead-letter under the replay's own
   * permission (41-ui-fixes/12 1.4), so the confirm's count does not need the report permission. 0 for an endpoint the
   * tenant does not have.
   */
  static async countReplayableDeadLetters(tenantId: string, webhookId: string): Promise<number> {
    return withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, (repo) => repo.count({ where: replayableDeadLetterWhere(tenantId, webhookId) }));
  }

  /**
   * Tenant-wide list of endpoints the circuit breaker auto-disabled
   * (isActive = false AND autoDisabledAt IS NOT NULL).
   */
  static async listAutoDisabled(tenantId: string): Promise<WebhookAutoDisabledEndpoint[]> {
    const rows = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo
      .createQueryBuilder('w')
      .where('w."tenantId" = :tenantId', { tenantId })
      .andWhere('w."isActive" = false')
      .andWhere('w."autoDisabledAt" IS NOT NULL')
      .orderBy('w."autoDisabledAt"', 'DESC')
      .getMany());

    return rows.map((w) => ({
      webhookId: w.webhookId,
      name: w.name,
      url: w.url,
      consecutiveFailures: w.consecutiveFailures,
      autoDisabledAt: w.autoDisabledAt ? w.autoDisabledAt.toISOString() : null,
    }));
  }

  /**
   * Composite report for the detail Overview tab and the list-page reliability
   * panel: time-series, failure analysis, tenant-wide auto-disabled endpoints,
   * and (when a single webhook is in scope) its reliability snapshot.
   */
  static async getReport(
    tenantId: string,
    opts: DeliveryScope = {},
  ): Promise<WebhookReport> {
    const [timeSeries, failure, autoDisabled, reliability] = await Promise.all([
      this.getTimeSeries(tenantId, opts),
      this.getFailureAnalysis(tenantId, opts),
      this.listAutoDisabled(tenantId),
      opts.webhookId ? this.getEndpointReliability(tenantId, opts.webhookId) : Promise.resolve(null),
    ]);

    return {
      timeSeries,
      topErrors: failure.topErrors,
      responseCodes: failure.responseCodes,
      autoDisabled,
      reliability,
    };
  }
}
