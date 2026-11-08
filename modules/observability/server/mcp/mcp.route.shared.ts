/**
 * The one handler behind `/api/mcp/observability`. The route file is a thin adapter; the logic and its dependencies live here so the
 * security tests can drive it with a fake verifier, fake data and a fake limiter.
 *
 * Order, and why:
 *   1. method (POST only: no SSE stream, no sessions), Origin (a browser page must not be able to drive a key), content type, protocol header
 *   2. declared size against the ceiling  (before any work for an unauthenticated caller)
 *   3. authenticate: the tenant comes from the key and from nothing else; the URL tenant must match it
 *   4. the key's tenant must have the module on
 *   5. bounded body read, JSON parse, JSON-RPC shape
 *   6. dispatch (per-key rate limit and audit per tool call)
 */
import { NextResponse } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { moduleEnabledGate, type TenantGate } from '../telemetry/telemetry.auth';
import { BodyTooLargeError, readBounded } from '../telemetry/telemetry.http';
import { apiKeyMcpVerifier, assertSameTenant, type McpKeyVerifier } from './mcp.auth';
import { auditToolCall, DefaultMcpLimits, type McpAuditSink, type McpLimits } from './mcp.audit';
import { RPC, SUPPORTED_PROTOCOL_VERSIONS, handleRpc, parseRpc } from './mcp.protocol';
import type { McpData } from './mcp.types';

/** MCP requests are small (a tool name and a few arguments). */
export const MAX_MCP_BODY_BYTES = 64 * 1024;

export interface McpRouteDeps {
  verifier: McpKeyVerifier;
  gate: TenantGate;
  data: McpData;
  limits: McpLimits;
  audit: McpAuditSink;
  now?: () => Date;
}

/** The real data port, loaded on first use: the service graph behind it (db, settings, on_call) is not needed to authenticate or to refuse a request. */
const lazyData = new Proxy({} as McpData, {
  get: (_t, method: string) => async (...args: unknown[]) => {
    const { defaultMcpData } = await import('./mcp.data');
    return (defaultMcpData as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args);
  },
});

export const defaultMcpDeps: McpRouteDeps = { verifier: apiKeyMcpVerifier, gate: moduleEnabledGate, data: lazyData, limits: new DefaultMcpLimits(), audit: auditToolCall };

const rpcFailure = (status: number, code: number, message: string) => NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status });

/** A request that carries an Origin must come from the page that serves this host: a key in a browser is not a use case we allow. */
export function assertOriginAllowed(headers: { get(n: string): string | null }): void {
  const origin = headers.get('origin');
  if (!origin) return;
  let host: string | null = null;
  try { host = new URL(origin).host; } catch { /* unparsable */ }
  const own = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host || !own || host.toLowerCase() !== own.toLowerCase()) throw new AppError('Origin not allowed', 403, ErrorCode.FORBIDDEN);
}

export async function handleMcp(
  request: Request & { body: ReadableStream<Uint8Array> | null }, urlTenantId: string | undefined, deps: McpRouteDeps = defaultMcpDeps,
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
    }
    assertOriginAllowed(request.headers);
    const ct = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/json') throw new AppError('Content-Type must be application/json', 415, ErrorCode.VALIDATION_ERROR);
    const version = request.headers.get('mcp-protocol-version');
    if (version && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) throw new AppError('Unsupported MCP-Protocol-Version', 400, ErrorCode.VALIDATION_ERROR);
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR);

    const principal = await deps.verifier.verify(request, urlTenantId);
    assertSameTenant(urlTenantId, principal);
    if (!(await deps.gate(principal.tenantId))) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
    // A refused call is not a use of the key: the row is stamped once the key, its MCP scope, the workspace and the gate passed.
    void deps.verifier.recordUse?.(request, principal).catch(() => undefined);

    let bytes: Uint8Array;
    try { bytes = await readBounded(request, MAX_MCP_BODY_BYTES); } catch (e) {
      if (e instanceof BodyTooLargeError) throw new AppError('Payload too large', 413, ErrorCode.VALIDATION_ERROR);
      throw e;
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return rpcFailure(400, RPC.PARSE, 'Parse error'); }

    const parsed = parseRpc(body);
    if (parsed.kind === 'invalid') return NextResponse.json(parsed.response, { status: 400 });
    if (parsed.kind !== 'request') return new NextResponse(null, { status: 202 });

    const out = await handleRpc(parsed.msg, {
      principal, data: deps.data, now: deps.now,
      audit: (rec) => deps.audit(principal, rec),
      admit: (kind) => deps.limits.admit(principal, kind),
    });
    if ('httpError' in out) return normalizeError(out.httpError);
    return NextResponse.json(out.response, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}
