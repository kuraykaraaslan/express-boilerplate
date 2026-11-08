import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentTemplateService, { RenderTemplateDTO } from './incident.templates.service'

/** POST: the text for a public update, from the tenant's wording or the default, with the incident's details filled in. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ text: await IncidentTemplateService.render(tenantId, RenderTemplateDTO.parse(await request.json())) })
  } catch (e) { return normalizeError(e) }
}
