import type { TimeSeriesTable } from '@kuraykaraaslan-labs/db/server/db.time-series';
import { EVENTS_CHUNK_INTERVAL, EVENTS_MAX_RETENTION_DAYS, EVENTS_TABLE } from './store/ai_firewall.store';

/**
 * The `db:time_series` contribution (docs/phases/55-ai-firewall/01 §1.7): the stored security events are a hypertable with 1-day chunks,
 * owned by the owner role behind `ai_firewall_events_v` where TimescaleDB is present; without it a plain table with a BRIN time index
 * and the batched-delete retention. Tenant-scoped: its key starts with the tenant and holds the time column (migration 001).
 *
 * The retention declared here is the platform's backstop, the longest any tenant may keep events (365 days, the setting's ceiling):
 * chunk drop is per table, never per tenant. Each tenant's own retention (setting `aiFirewallRetentionDays`, default 90 days) is the
 * per-tenant delete of `ai_firewall.retention.job.ts`. No compression and no rollups: an RLS hypertable cannot be compressed, and the
 * features of 02 read the rows themselves.
 */
export const TIME_SERIES_TABLES: TimeSeriesTable[] = [
  { table: EVENTS_TABLE, timeColumn: 'at', chunkInterval: EVENTS_CHUNK_INTERVAL, retention: `${EVENTS_MAX_RETENTION_DAYS} days`, tenantColumn: 'tenantId' },
];

export default TIME_SERIES_TABLES;
