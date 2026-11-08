// path: app/tenant/[tenantId]/api/cron/notification-log-failure-alert/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { assertCronAuth } from '@kuraykaraaslan-labs/common/server/cron-auth'

/**
 * HTTP twin of the `notification-log-failure-alert` BullMQ job (MS-15): the same run over every active tenant. Cron secret only.
 * Safe to re-run: an alert is sent at most once per tenant per hour. Answers counts only.
 */
export async function POST(request: NextRequest) {
  try {
    assertCronAuth(request)
    const { notificationLogFailureAlertJob } = await import('./notification_log.alerts.job')
    return NextResponse.json(await notificationLogFailureAlertJob.run())
  } catch (e) {
    return normalizeError(e)
  }
}
