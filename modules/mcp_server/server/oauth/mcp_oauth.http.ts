/**
 * HTTP helpers of the OAuth endpoints (docs/phases/57-mcp-server D57-8): JSON answers that are never cached (RFC 6749 §5.1), CORS for
 * the public endpoints (metadata, token, revoke: public clients with PKCE, never cookies, so `*` without credentials), and bounded
 * form bodies.
 */
import { NextResponse } from 'next/server';
import { OauthError } from './mcp_oauth.service';

export const MAX_FORM_BYTES = 8 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Max-Age': '600',
};

export const oauthJson = (body: unknown, status = 200, cors = true) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...(cors ? CORS : {}) } });

export const oauthError = (e: OauthError) => oauthJson({ error: e.code, error_description: e.description }, e.status);

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

/** An `application/x-www-form-urlencoded` body of at most 8 KiB, or an OauthError. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  const ct = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct !== 'application/x-www-form-urlencoded') throw new OauthError('invalid_request', 'The body must be application/x-www-form-urlencoded.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) throw new OauthError('invalid_request', 'The body is too large.');
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_FORM_BYTES) throw new OauthError('invalid_request', 'The body is too large.');
  return new URLSearchParams(text);
}
