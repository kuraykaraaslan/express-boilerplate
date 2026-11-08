import { NextRequest } from 'next/server'
import { handleMcp } from './mcp/mcp.route.shared'

type Ctx = { params: Promise<{ tenantId?: string }> }

/**
 * POST /api/mcp/observability: the MCP server (streamable HTTP, JSON-RPC 2.0, stateless). Authenticated by a tenant API key that holds
 * `observability:mcp:read` (and, for the three write tools, `observability:mcp:write`); the tenant is the key's, and the workspace in the
 * URL must be the same one. GET and DELETE answer 405 (there is no event stream and there are no sessions).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { tenantId } = await params
  return handleMcp(request, tenantId)
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { tenantId } = await params
  return handleMcp(request, tenantId)
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { tenantId } = await params
  return handleMcp(request, tenantId)
}
