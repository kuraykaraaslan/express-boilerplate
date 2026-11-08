// path: app/tenant/[tenantId]/api/cron/notification-log-retention/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { assertCronAuth } from '@kuraykaraaslan-labs/common/server/cron-auth'

/**
 * HTTP twin of the `notification-log-retention` BullMQ job: the same run over every tenant a retention sweep may touch. Safe to re-run: an
 * anonymised row is not selected again and a deleted one is gone. Answers counts only.
 */
export async function POST(request: NextRequest) {
  try {
    assertCronAuth(request)
    const { notificationLogRetentionJob } = await import('./notification_log.retention.job')
    return NextResponse.json(await notificationLogRetentionJob.run())
  } catch (e) {
    return normalizeError(e)
  }
}
