/**
 * The handler behind `/api/mcp/[moduleId]` (docs/phases/57-mcp-server; ADR-0022). The route file is a thin adapter; the logic and its
 * dependencies live here so the security tests drive it with fakes.
 *
 * Order, and why:
 *   1. method (POST only: no event stream, no sessions; the route exports POST alone, so the dispatcher answers 405 to the rest), Origin
 *      (a browser page must not drive a credential, F1) and the declared size: before any work for an unauthenticated caller
 *   2. authenticate: the tenant guard decides first, as on every tenant route (`mcp_server.connect`): its key lane verifies an API key
 *      and acts as its holder (phase 48 D48-1, D48-2); its MCP grant lane (this route opts in) verifies an OAuth access token and acts as
 *      the person who consented; the grant must cover this server (RFC 8707 resource) and each tool's kind (scope). A cookie session the
 *      guard let through is still refused 401. A 401 carries the server's protected-resource metadata (RFC 9728).
 *   3. content type (after the guard, so every refusal of a caller is the guard's own answer)
 *   4. the workspace's MCP switch (Settings → MCP, off by default: 403), then the server: a module with registered tools that is
 *      enabled for the tenant, else 404 (the same answer for both); tools the workspace switched off are dropped here
 *   5. the caller's tools: the holder's current rights intersected with the key's own permissions (`grantedPermissions`, D48-4)
 *   6. bounded body read, JSON parse; a call to a tool the caller cannot use is audited as refused (the SDK answers it -32602)
 *   7. dispatch: 2025-era requests (every host today) to a stateless transport that answers JSON only; 2026-07-28 requests to
 *      `createMcpHandler` with `legacy: 'reject'` (the 57.0 finding: the SDK's own stateless leg answers as an event stream)
 */
import { NextResponse } from 'next/server';
import {
  createMcpHandler,
  isLegacyRequest,
  originValidationResponse,
  WebStandardStreamableHTTPServerTransport,
  type McpServer,
} from '@modelcontextprotocol/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import type { McpCaller, McpToolDefinition } from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';
import { MAX_MCP_BODY_BYTES } from './mcp_server.protocol';
import { buildServer } from './mcp_server.server';
import { toolKey, type McpPolicy } from './mcp_server.settings-policy';
import type { ToolCallDeps, ToolCallRecord } from './mcp_server.register';

export interface McpAuthenticated {
  caller: McpCaller;
  /** Which of these permission ids the caller holds now (the phase 48 ceiling). */
  granted(permissionIds: string[]): Promise<Set<string>>;
  /** Whether the credential's consent covers tools of this kind (an OAuth grant's scope; an API key: every kind its permissions reach). */
  allowsKind(kind: 'read' | 'write'): boolean;
}

export interface McpHttpDeps {
  /** Verifies the credential for the URL's tenant and this server, or throws an AppError (401 / 403 / 429). */
  authenticate(request: Request, tenantId: string, moduleId: string): Promise<McpAuthenticated>;
  /** The `WWW-Authenticate` value of a 401: the server's protected-resource metadata (RFC 9728), so an OAuth client can sign in. */
  challenge(tenantId: string, moduleId: string): Promise<string>;
  /** The module's tools, sorted, or null when the module has none. */
  toolsOf(moduleId: string): Promise<readonly McpToolDefinition[] | null>;
  /** Whether the module is enabled for the tenant now (placement, bans, the tenant's switch). */
  moduleEnabled(tenantId: string, moduleId: string): Promise<boolean>;
  /** The workspace's MCP settings; fails closed (off). */
  policy(tenantId: string): Promise<McpPolicy>;
  calls: ToolCallDeps;
}


const rpcError = (status: number, code: number, message: string, headers?: Record<string, string>) =>
  NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers });

/** The request's own host name (no port), as the client addressed it: the one Origin a browser could legitimately send. */
function ownHostname(request: Request): string | null {
  const raw = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || '';
  if (!raw) return null;
  try { return new URL(`http://${raw}`).hostname.toLowerCase(); } catch { return null; }
}

class BodyTooLarge extends Error {}

async function readBounded(request: Request, max: number): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { void reader.cancel().catch(() => undefined); throw new BodyTooLarge(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The tool names of the `tools/call` messages in a body (one message or a batch). */
export function calledToolNames(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  const out: string[] = [];
  for (const m of messages.slice(0, 20)) {
    if (m && typeof m === 'object' && (m as { method?: unknown }).method === 'tools/call') {
      const name = (m as { params?: { name?: unknown } }).params?.name;
      if (typeof name === 'string') out.push(name.slice(0, 64));
    }
  }
  return out;
}

/** Process-lifetime: the modern leg's handler. The server it builds comes from the request's own authInfo, never from module state. */
type BuildFromAuth = () => McpServer;
const modernHandler = createMcpHandler(
  ({ authInfo }) => {
    const build = (authInfo?.extra as { build?: BuildFromAuth } | undefined)?.build;
    if (!build) throw new Error('mcp_server: a request reached the server without a verified caller');
    return build();
  },
  { legacy: 'reject', responseMode: 'json', maxRequestBodySize: MAX_MCP_BODY_BYTES },
);

export async function handleMcpRequest(request: Request, params: { tenantId: string; moduleId: string }, deps: McpHttpDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
    const own = ownHostname(request);
    const originRefused = originValidationResponse(request, own ? [own] : []);
    if (originRefused) return originRefused;
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR);

    const auth = await deps.authenticate(request, params.tenantId, params.moduleId);

    const ct = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/json') throw new AppError('Content-Type must be application/json', 415, ErrorCode.VALIDATION_ERROR);

    const policy = await deps.policy(params.tenantId);
    if (!policy.enabled) throw new AppError('MCP is switched off for this workspace (Settings → MCP)', 403, ErrorCode.FORBIDDEN);
    const registered = await deps.toolsOf(params.moduleId);
    if (!registered || !(await deps.moduleEnabled(params.tenantId, params.moduleId))) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
    const tools = registered.filter((t) => !policy.disabledTools.has(toolKey(params.moduleId, t.name)) && auth.allowsKind(t.kind));
    const granted = await auth.granted([...new Set(tools.map((t) => t.permission))]);

    let parsed: unknown;
    try {
      const text = await readBounded(request, MAX_MCP_BODY_BYTES);
      parsed = JSON.parse(text);
    } catch (e) {
      if (e instanceof BodyTooLarge) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR);
      return rpcError(400, -32700, 'Parse error');
    }

    // A call to a tool the caller cannot use: the SDK answers -32602 (the tool is not listed); the attempt is still a signal.
    for (const name of calledToolNames(parsed)) {
      const tool = tools.find((t) => t.name === name);
      if (!tool || granted.has(tool.permission)) continue;
      const rec: ToolCallRecord = { moduleId: params.moduleId, tool: name, kind: tool.kind, outcome: 'denied', code: 'FORBIDDEN', durationMs: 0, argKeys: [] };
      void deps.calls.audit(auth.caller, rec).catch(() => undefined);
    }

    const build = () => buildServer(params.moduleId, tools, auth.caller, granted, deps.calls);
    const authInfo = { token: 'verified', clientId: auth.caller.credentialId, scopes: [], extra: { build } };

    if (await isLegacyRequest(request, parsed, { maxRequestBodySize: MAX_MCP_BODY_BYTES })) {
      const server = build();
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_MCP_BODY_BYTES });
      await server.connect(transport);
      try {
        return await transport.handleRequest(request, { authInfo, parsedBody: parsed });
      } finally {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      }
    }
    return await modernHandler.fetch(request, { authInfo, parsedBody: parsed });
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 401) {
      let challenge = 'Bearer realm="mcp"';
      try { challenge = await deps.challenge(params.tenantId, params.moduleId); } catch { /* the bare challenge */ }
      return NextResponse.json({ message: e.message, code: e.code }, { status: 401, headers: { ...(e.headers ?? {}), 'WWW-Authenticate': challenge } });
    }
    return normalizeError(e);
  }
}
