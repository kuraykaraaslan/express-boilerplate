import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import SloService from './slo.service'
import { ImportOpenSloDTO } from './slo.dto'
import { parseOpenSlo, stringifyOpenSlos } from './slo.openslo'

/** GET /api/slos/openslo?format=yaml|json: every SLO as OpenSLO v1 documents. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.read', scope: 'TENANT' })
    const format = request.nextUrl.searchParams.get('format') === 'json' ? 'json' : 'yaml'
    const body = stringifyOpenSlos(await SloService.list(tenantId), format)
    return new NextResponse(body, { headers: { 'Content-Type': format === 'json' ? 'application/json' : 'application/yaml', 'Content-Disposition': `attachment; filename="slos.${format}"`, 'Cache-Control': 'no-store' } })
  } catch (e) { return normalizeError(e) }
}

/** POST /api/slos/openslo: import OpenSLO v1 documents. A dry run (the default) only validates; nothing is written unless every document is valid. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.manage', scope: 'TENANT' })
    const input = ImportOpenSloDTO.parse(await request.json())
    const parsed = parseOpenSlo(input.format, input.content)
    let created = 0
    if (!input.dryRun && parsed.errors.length === 0) {
      for (const slo of parsed.slos) { await SloService.create(tenantId, slo, user?.userId ?? null); created += 1 }
    }
    return NextResponse.json({ dryRun: input.dryRun, created, valid: parsed.slos.length, errors: parsed.errors })
  } catch (e) { return normalizeError(e) }
}
