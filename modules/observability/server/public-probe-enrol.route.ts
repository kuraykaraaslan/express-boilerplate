import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeRunnerService from './probe.runner.service'
import { EnrolDTO } from './probe.dto'
import { MAX_RUNNER_BODY_BYTES } from './probe.runner.http'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST /api/public/probe/enrol — a runner exchanges a single-use enrolment token for an identity. No session: the token is the credential, it is
 * consumed here, and an unknown, expired, used or malformed token is the same 404. The body carries only the runner's PUBLIC key.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'auth')
    const text = await request.text()
    if (text.length > MAX_RUNNER_BODY_BYTES) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR)
    let body: unknown
    try { body = JSON.parse(text) } catch { throw new AppError('The body must be JSON', 400, ErrorCode.VALIDATION_ERROR) }
    const dto = EnrolDTO.parse(body)
    const runner = await ProbeRunnerService.enrol(tenantId, { token: dto.token, publicKeyPem: dto.publicKey, name: dto.name, version: dto.version ?? null, capabilities: dto.capabilities })
    return NextResponse.json({ runnerId: runner.runnerId, locationKey: runner.locationKey, fingerprint: runner.fingerprint }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return normalizeError(e) }
}
