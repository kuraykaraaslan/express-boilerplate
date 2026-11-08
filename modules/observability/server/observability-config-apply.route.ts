import type { NextRequest } from 'next/server'
import { handleApply } from './config/config.http'

/** POST /api/observability/config/apply: apply a document, idempotently. Session (the manage permission of every kind asked for) or api key (observability_config:write). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  return handleApply(request, ctx)
}
