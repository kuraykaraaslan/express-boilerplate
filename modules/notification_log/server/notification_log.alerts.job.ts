import { defineTenantSweepJob } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep.job'

/**
 * The sustained-failure alert, scheduled (MS-15). `checkFailureRate` was written, tested and declared through the
 * `notification.failure_rate_high` webhook event, but nothing ever called it, so a subscriber waited for an alert that could
 * not fire. Observability's alerting does not cover it (its rules route alerts raised from monitors and metrics; nothing raises
 * one from the delivery ledger), so the check is wired here rather than removed.
 *
 * Every 15 minutes, every active tenant: the failure rate of the last 30 minutes, at least 20 attempts, 50 % or more fires the
 * event once per tenant per hour (the check's own Redis dedup). The window is twice the cadence, so a burst is never missed
 * between two runs. Read-only on the ledger (one indexed range read per tenant, `idx_notification_logs_tenant_sent`); the only
 * side effect is the webhook. The HTTP twin is `POST …/api/cron/notification-log-failure-alert`. Importing this file starts
 * nothing.
 */
export const notificationLogFailureAlertJob = defineTenantSweepJob({
  name: 'notification-log-failure-alert',
  cron: '*/15 * * * *',
  perTenant: async (tenantId) => (await import('./notification_log.alerts.service')).checkFailureRate(tenantId),
  summarize: (fired) => `fired=${fired}`,
})

export const scheduleNotificationLogFailureAlertJob = (cronPattern?: string) => notificationLogFailureAlertJob.schedule(cronPattern)
