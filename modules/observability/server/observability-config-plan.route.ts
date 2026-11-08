import type { NextRequest } from 'next/server'
import { handlePlan } from './config/config.http'

/** POST /api/observability/config/plan: what a document would change; writes nothing. Session (read permissions) or api key (observability_config:read). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  return handlePlan(request, ctx)
}
