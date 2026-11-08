import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeOps, runAudited } from './ops/ops.auth'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertService from './alert.service'

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string, alertId: string }> }) {
  try {
    const { tenantId, alertId } = await params
    await Limiter.checkRateLimit(request, 'api')
    // Two lanes: a console session with the permission, or an api key holding exactly observability_ops:ack (ops/ops.auth.ts).
    const who = await authorizeOps(request, tenantId, 'ack', 'observability.alerts.manage')
    const userId = who.actor.type === 'USER' ? who.actor.id : null
    return NextResponse.json({ item: await runAudited(who, { type: 'alert', id: alertId }, () => AlertService.acknowledge(tenantId, alertId, userId)) })
  } catch (e) { return normalizeError(e) }
}
