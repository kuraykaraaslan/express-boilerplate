import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { checkTenantBudget } from './observability.tenant-budget'
import { acquireTenantSlot } from './observability.concurrency'
import AlertIntegrationService from './alert.integration.service'
import AlertService from './alert.service'
import { hardenSignal } from './alert.ingest.hardening'
import { parseIngest } from './alert.ingest.parsers'
import { alertMetrics } from './alert.metrics'
import type { IntegrationKind } from './alert.enums'
import { refusalDetails, refusalForReason } from './observability.refusals'

type Ctx = { params: Promise<{ tenantId: string; key: string }> }

export const MAX_INGEST_BODY_BYTES = 1_000_000

/**
 * POST /api/public/alerts/ingest/<key>
 *
 * No session: the key is the credential, and it fixes the tenant, the parser (generic, Alertmanager or Grafana), the highest severity
 * and the default labels. A key that is unknown, malformed, rotated away or disabled answers the same 404. The body is capped, the
 * alert count per request is capped, and what the sender may say is limited to labels and annotations (see `alert.ingest.hardening`).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, key } = await params
    await Limiter.checkRateLimit(request, 'api')
    const integration = await AlertIntegrationService.authenticate(tenantId, key)
    await checkTenantBudget(tenantId, 'alert_ingest')

    const release = acquireTenantSlot(tenantId, 'alert_ingest')
    try {
      const declared = Number(request.headers.get('content-length') ?? 0)
      if (declared > MAX_INGEST_BODY_BYTES) { alertMetrics.ingestRejected.inc({ reason: 'too_large' }); throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR) }
      const text = await request.text()
      if (text.length > MAX_INGEST_BODY_BYTES) { alertMetrics.ingestRejected.inc({ reason: 'too_large' }); throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR) }
      let body: unknown
      try { body = JSON.parse(text) } catch { alertMetrics.ingestRejected.inc({ reason: 'not_json' }); throw new AppError('The body must be JSON', 400, ErrorCode.VALIDATION_ERROR) }

      const signals = parseIngest(integration.kind as IntegrationKind, body, integration.integrationId).map((s) => hardenSignal(s, integration))
      const summary = await AlertService.ingestMany(tenantId, signals)
      // Everything refused for the open-alert cap: tell the sender to back off instead of a 202 that hides it.
      if (summary.rejected && summary.accepted + summary.resolved === 0) {
        throw new AppError('Too many open alerts; resolve some before sending more.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { details: { reason: 'open_alert_cap', ...refusalDetails(refusalForReason('open_alert_cap')) } })
      }
      return NextResponse.json(summary, { status: 202, headers: { 'Cache-Control': 'no-store' } })
    } finally { release() }
  } catch (e) {
    return normalizeError(e)
  }
}
