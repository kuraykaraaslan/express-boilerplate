import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeRunnerService, { type SignedRequestInput } from './probe.runner.service'
import type { ProbeRunner } from './entities/probe_runner.entity'
import { PROBE_API_PATH, RUNNER_HEADER } from '../runner/probe-runner.protocol'

type Ctx = { params: Promise<{ tenantId: string }> }

/** Largest body a runner may post: a lease response is never sent back, so this only bounds results and heartbeats. */
export const MAX_RUNNER_BODY_BYTES = 64 * 1024
/** `/results` may carry a failure screenshot (a JPEG of at most 300 KB, base64) with the run record: its cap is larger, and only its cap. */
export const MAX_RESULT_BODY_BYTES = 512 * 1024

/**
 * The shared shell of the signed runner endpoints. No session: the signature IS the credential. The per-address limiter runs first, the body is
 * read through a cap, the signature binds the logical route (PROBE_API_PATH + suffix, not the URL a proxy or a tenant prefix rewrote), and every
 * authentication failure is the same 401.
 */
export function signedRunnerHandler(
  suffix: string, handle: (runner: ProbeRunner, body: unknown, tenantId: string) => Promise<unknown>, opts: { maxBytes?: number } = {},
) {
  const maxBytes = opts.maxBytes ?? MAX_RUNNER_BODY_BYTES
  return async (request: NextRequest, { params }: Ctx) => {
    try {
      const { tenantId } = await params
      await Limiter.checkRateLimit(request, 'api')
      const declared = Number(request.headers.get('content-length') ?? 0)
      if (declared > maxBytes) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR)
      const text = await request.text()
      if (text.length > maxBytes) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR)
      const input: SignedRequestInput = {
        method: 'POST', path: `${PROBE_API_PATH}${suffix}`, body: text,
        runnerId: request.headers.get(RUNNER_HEADER.runner), timestamp: request.headers.get(RUNNER_HEADER.timestamp),
        nonce: request.headers.get(RUNNER_HEADER.nonce), signature: request.headers.get(RUNNER_HEADER.signature),
      }
      const runner = await ProbeRunnerService.authenticate(tenantId, input)
      let body: unknown = {}
      if (text.trim()) { try { body = JSON.parse(text) } catch { throw new AppError('The body must be JSON', 400, ErrorCode.VALIDATION_ERROR) } }
      return NextResponse.json(await handle(runner, body, tenantId), { headers: { 'Cache-Control': 'no-store' } })
    } catch (e) { return normalizeError(e) }
  }
}
