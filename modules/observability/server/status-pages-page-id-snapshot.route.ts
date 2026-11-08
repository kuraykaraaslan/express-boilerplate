import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import StatusSnapshotService from './status.snapshot.service'

type Ctx = { params: Promise<{ tenantId: string; pageId: string }> }

/**
 * Publish a page's static snapshot now (also the way to see whether storage works). Only a public, enabled page has one. A failure is a
 * 502 with the short reason the admin screen shows; nothing about the failure is secret (class and message only).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, pageId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    const result = await StatusSnapshotService.publishNow(tenantId, pageId)
    if (result.state === 'failed') throw new AppError(result.error ?? 'Snapshot failed', 502, ErrorCode.INTERNAL_ERROR)
    return NextResponse.json({ result })
  } catch (e) { return normalizeError(e) }
}
