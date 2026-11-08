import { type FindOptionsWhere, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import {
  NotificationLog,
  NotificationChannel,
  NotificationStatus,
} from './entities/notification_log.entity';
import { SafeNotificationLogSchema, type SafeNotificationLog, type NotificationLogQuery } from './notification_log.types';
import { openRow, recipientConditions } from './notification_log.recipient';

const toSafe = async (row: NotificationLog): Promise<SafeNotificationLog> => SafeNotificationLogSchema.parse(await openRow(row));

export async function list(
  tenantId: string,
  query: NotificationLogQuery = {},
): Promise<{ logs: SafeNotificationLog[]; total: number }> {
  const base: FindOptionsWhere<NotificationLog> = { tenantId };
  if (query.channel) base.channel = query.channel;
  if (query.status) base.status = query.status;
  if (query.from && query.to) base.sentAt = Between(query.from, query.to);
  else if (query.from) base.sentAt = MoreThanOrEqual(query.from);
  else if (query.to) base.sentAt = LessThanOrEqual(query.to);
  // The recipient is sealed under the tenant's key: matched by its blind index, or by the plaintext of a legacy row (notification_log.recipient.ts).
  const where = query.recipient ? await recipientConditions(tenantId, query.recipient, base)
    : query.recipientSearch ? await recipientConditions(tenantId, query.recipientSearch, base, { substring: true })
    : base;

  const [rows, total] = await withTenantRepositoryFor(tenantId, NotificationLog, async (repo) => {
    return repo.findAndCount({
      where,
      order: { sentAt: 'DESC' },
      skip: query.offset ?? 0,
      take: Math.min(query.limit ?? 50, 200),
    });
  });
  return { logs: await Promise.all(rows.map(toSafe)), total };
}

export async function getById(tenantId: string, id: string): Promise<SafeNotificationLog | null> {
  const row = await withTenantRepositoryFor(tenantId, NotificationLog, (repo) => repo.findOne({ where: { tenantId, notificationLogId: id } }));
  return row ? toSafe(row) : null;
}

/**
 * Cursor-based pagination (stable for large logs / infinite scroll). Returns
 * a page ordered by sentAt DESC plus the cursor to fetch the next page.
 */
export async function listCursor(
  tenantId: string,
  opts: { cursor?: string; limit?: number; channel?: NotificationChannel; status?: NotificationStatus } = {},
): Promise<{ logs: SafeNotificationLog[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const { page, nextCursor } = await withTenantRepositoryFor(tenantId, NotificationLog, async (repo) => {
    const qb = repo.createQueryBuilder('n')
      .where('n."tenantId" = :tenantId', { tenantId })
      .orderBy('n."sentAt"', 'DESC').addOrderBy('n."notificationLogId"', 'DESC')
      .take(limit + 1);
    if (opts.channel) qb.andWhere('n."channel" = :channel', { channel: opts.channel });
    if (opts.status) qb.andWhere('n."status" = :status', { status: opts.status });
    if (opts.cursor) {
      // Cursor encodes the last row's sentAt ISO timestamp.
      qb.andWhere('n."sentAt" < :cursor', { cursor: new Date(opts.cursor) });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { page, nextCursor: hasMore ? page[page.length - 1].sentAt.toISOString() : null };
  });
  return { logs: await Promise.all(page.map(toSafe)), nextCursor };
}

/**
 * Aggregated delivery statistics for a tenant, grouped by channel + status,
 * with overall and per-channel success rates (operator/admin dashboard).
 */
export async function getStats(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<{
  overall: { sent: number; failed: number; pending: number; total: number; successRate: number };
  byChannel: Array<{ channel: string; sent: number; failed: number; pending: number; successRate: number }>;
}> {
  return withTenantRepositoryFor(tenantId, NotificationLog, async (repo) => {
    const qb = repo.createQueryBuilder('n')
      .select('n.channel', 'channel').addSelect('n.status', 'status').addSelect('COUNT(*)', 'count')
      .where('n."tenantId" = :tenantId', { tenantId });
    if (opts.from) qb.andWhere('n."sentAt" >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('n."sentAt" <= :to', { to: opts.to });
    const rows = await qb.groupBy('n.channel').addGroupBy('n.status').getRawMany<{ channel: string; status: string; count: string }>();

    const channels = new Map<string, { sent: number; failed: number; pending: number }>();
    const overall = { sent: 0, failed: 0, pending: 0 };
    for (const r of rows) {
      const c = channels.get(r.channel) ?? { sent: 0, failed: 0, pending: 0 };
      const n = Number(r.count);
      if (r.status === 'sent') { c.sent += n; overall.sent += n; }
      else if (r.status === 'failed') { c.failed += n; overall.failed += n; }
      else { c.pending += n; overall.pending += n; }
      channels.set(r.channel, c);
    }
    const rate = (s: number, f: number) => (s + f) ? Math.round((s / (s + f)) * 1000) / 10 : 0;
    const total = overall.sent + overall.failed + overall.pending;
    return {
      overall: { ...overall, total, successRate: rate(overall.sent, overall.failed) },
      byChannel: [...channels.entries()].map(([channel, c]) => ({ channel, ...c, successRate: rate(c.sent, c.failed) })),
    };
  });
}
