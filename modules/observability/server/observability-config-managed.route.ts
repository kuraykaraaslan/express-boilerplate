import type { NextRequest } from 'next/server'
import { handleManaged } from './config/config.http'

/** GET /api/observability/config/managed: the resources applied from code. Session (read permissions) or api key (observability_config:read). */
export async function GET(request: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  return handleManaged(request, ctx)
}
