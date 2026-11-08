import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { authorizeOps, runAudited } from './ops/ops.auth'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertSilenceTemplateService from './alert.silence-template.service'
import { MAX_SILENCE_MINUTES } from './alert.dto'

const StartDTO = z.object({
  templateId: z.string().uuid(),
  durationMinutes: z.number().int().min(1).max(MAX_SILENCE_MINUTES).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict()

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.read', scope: 'TENANT' })
    return NextResponse.json({ items: await AlertSilenceTemplateService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

/** POST /api/alert-silence-templates: start a template, i.e. create a normal time-bound silence from it. Templates themselves are applied from code. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    // Two lanes: a console session with the permission, or an api key holding exactly observability_ops:silence (ops/ops.auth.ts).
    const who = await authorizeOps(request, tenantId, 'silence', 'observability.alerts.manage')
    const { templateId, ...overrides } = StartDTO.parse(await request.json())
    const userId = who.actor.type === 'USER' ? who.actor.id : null
    return NextResponse.json({ item: await runAudited(who, { type: 'alert_silence_template', id: templateId }, () => AlertSilenceTemplateService.start(tenantId, templateId, userId, overrides)) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
