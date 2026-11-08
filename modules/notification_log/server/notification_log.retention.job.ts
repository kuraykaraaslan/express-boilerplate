import { defineRetentionSweepJob } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep.job'

/**
 * How long the delivery ledger keeps a recipient, and a row at all (P7-SWEEPERS). 90 days answers "why did my mail not arrive?" for any support
 * case worth opening; after that the row keeps only what delivery statistics need (channel, provider, status, timings, country). After two years
 * the row itself goes. Platform constants, not tenant settings: the ledger is the platform's delivery evidence (notification_log CHECKLIST, the
 * rejected per-tenant switch), and its retention is stated once in the RoPA rather than per workspace.
 */
export const NOTIFICATION_LOG_ANONYMIZE_AFTER_DAYS = 90
export const NOTIFICATION_LOG_DELETE_AFTER_DAYS = 730

/**
 * Notification ledger retention sweep: anonymises rows older than 90 days (recipient, its blind index, subject and error text) and deletes rows
 * older than two years (`pruneAndAnonymize`). Daily at 03:35, every tenant a retention sweep may touch. The HTTP twin is
 * `POST …/api/cron/notification-log-retention`; both record the run for `privacy.sweepers_scheduled`.
 */
export const notificationLogRetentionJob = defineRetentionSweepJob({
  name: 'notification-log-retention',
  cron: '35 3 * * *',
  perTenant: async (tenantId) => (await import('./notification_log.write.service')).pruneAndAnonymize(tenantId, {
    anonymizeAfterDays: NOTIFICATION_LOG_ANONYMIZE_AFTER_DAYS,
    deleteAfterDays: NOTIFICATION_LOG_DELETE_AFTER_DAYS,
  }),
  summarize: (r) => `anonymized=${r.anonymized} deleted=${r.deleted}`,
})

export const scheduleNotificationLogRetentionJob = (cronPattern?: string) => notificationLogRetentionJob.schedule(cronPattern)
