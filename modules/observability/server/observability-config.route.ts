import type { NextRequest } from 'next/server'
import { handleExport } from './config/config.http'

/** GET /api/observability/config: the live state as a roltek-observability-1 document. A session holding the read permission of every kind asked for, or an api key with the scope observability_config:read. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  return handleExport(request, ctx)
}
