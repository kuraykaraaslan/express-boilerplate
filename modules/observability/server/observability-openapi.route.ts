import type { NextRequest } from 'next/server'
import { handleOpenApi } from './config/config.http'

/** GET /api/observability/openapi: the OpenAPI 3.1 document of this REST surface. Any holder of a configuration read grant. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  return handleOpenApi(request, ctx)
}
