import type { NextRequest } from 'next/server'
import { handleDetach } from './config/config.http'

/** POST /api/observability/config/detach: hand a code-managed resource to the console. Session (the manage permission of its kind) or api key (observability_config:write). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  return handleDetach(request, ctx)
}
