import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { recordClientError } from './observability.extension-health'

type Ctx = { params: Promise<{ tenantId: string }> }

const ReportDTO = z.object({
  where: z.string().trim().min(1).max(120),
  component: z.string().trim().min(1).max(200),
  message: z.string().max(200).optional(),
}).strict()

/**
 * POST { where, component, message? } — a contribution failed to render in this member's browser
 * (docs/phases/37-extensions/05). Counted and logged; nothing is stored. Any signed-in member may report; rate-limited.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.extensions.report', scope: 'TENANT' })
    recordClientError(tenantId, ReportDTO.parse(await request.json()))
    return new NextResponse(null, { status: 204 })
  } catch (e) { return normalizeError(e) }
}
