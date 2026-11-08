import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import MonitorService from './uptime.monitor.service'
import CheckDetailService from './uptime.check-detail.service'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

type Ctx = { params: Promise<{ tenantId: string; monitorId: string }> }

/** GET /api/monitors/{id}/checks?limit=50 — recent probe results, newest first. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    const limit = parseInt(new URL(request.url).searchParams.get('limit') || '50', 10) || 50
    const checks = await MonitorService.listChecks(tenantId, monitorId, { limit })
    // A BROWSER sample carries its bounded run record (per-step timings, web-vitals) and says whether a failure screenshot exists; the bytes are a separate route.
    const details = await CheckDetailService.forChecks(tenantId, monitorId, checks.map((c) => c.checkId)).catch(() => new Map())
    const items = checks.map((c) => { const d = details.get(c.checkId); return d ? { ...c, browser: d.detail, hasScreenshot: d.hasScreenshot } : c })
    return NextResponse.json({ items })
  } catch (e) {
    return normalizeError(e)
  }
}
