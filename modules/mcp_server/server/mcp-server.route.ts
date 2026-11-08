import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { handleMcpRequest } from './mcp_server.http'
import { defaultMcpHttpDeps } from './mcp_server.deps'

type Ctx = { params: Promise<{ tenantId: string; moduleId: string }> }

/**
 * POST /tenant/[tenantId]/api/mcp/[moduleId]: one MCP server per contributing module (Streamable HTTP, JSON-RPC 2.0, stateless; docs/phases/57-mcp-server).
 * Authenticated by an API key of the tenant that holds `mcp_server.connect`; each tool also needs its own module permission, held by the
 * key and by its holder now. Only POST is exported: the dispatcher answers 405 to GET and DELETE (no event stream, no sessions).
 * `/api/mcp/observability` is observability's own endpoint until 57.5 (a literal route wins over this one).
 */
async function serve(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, moduleId } = await params
    await Limiter.checkRateLimit(request, 'api')
    return await handleMcpRequest(request, { tenantId, moduleId }, defaultMcpHttpDeps)
  } catch (e) {
    return normalizeError(e)
  }
}

export const POST = serve
