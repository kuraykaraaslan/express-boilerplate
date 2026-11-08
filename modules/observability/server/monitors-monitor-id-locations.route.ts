import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeStatsService, { MAX_LONG_DAYS, MAX_RAW_DAYS } from './probe.stats.service'

type Ctx = { params: Promise<{ tenantId: string; monitorId: string }> }

/**
 * GET …/monitors/{id}/locations?days=7 — uptime and latency per location, and who disagrees right now.
 *
 * `days` up to 90 reads the raw checks (as before). `window=long` (or `days` above 90, up to 365) reads the per-location daily rollup instead, which
 * survives raw-check retention; its answer adds `window`, `source`, `perLocation` (where per-location data starts: it has no backfill) and, per
 * location, `p95LatencyMs` (approximate, from fixed buckets) and `from`. The existing fields keep their meaning.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    const q = new URL(request.url).searchParams
    const requested = parseInt(q.get('days') || '', 10)
    const long = q.get('window') === 'long' || requested > MAX_RAW_DAYS
    if (long) {
      const days = Math.min(MAX_LONG_DAYS, Math.max(1, Number.isFinite(requested) ? requested : MAX_RAW_DAYS))
      return NextResponse.json(await ProbeStatsService.forMonitorLong(tenantId, monitorId, days))
    }
    const days = Math.min(MAX_RAW_DAYS, Math.max(1, requested || 7))
    return NextResponse.json(await ProbeStatsService.forMonitor(tenantId, monitorId, days))
  } catch (e) { return normalizeError(e) }
}
