import { NextRequest } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { serveLocalObject } from './storage.local.serve'

type Params = { params: Promise<{ tenantId: string }> }

/**
 * GET /tenant/[tenantId]/api/storage/local/object?key=&exp=&sig=
 * An object of the local disk store, for the holder of its app-signed URL (no session: the signature is the credential).
 * Unknown / expired / tampered / other-tenant / missing all answer the same 404. Supports `Range`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params
    return await serveLocalObject(request, tenantId)
  } catch (e) {
    return normalizeError(e)
  }
}

/** HEAD: same checks and headers as GET, no body. */
export async function HEAD(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params
    return await serveLocalObject(request, tenantId)
  } catch (e) {
    return normalizeError(e)
  }
}
