// Next.js route of this module, served at /.well-known/acme-challenge/<token> (declared in module.json `appRoutes`; the file Next reads is generated into app/(modules)/).
import { NextRequest, NextResponse } from 'next/server';
import { readChallenge } from '@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.acme.challenge';

/**
 * GET /.well-known/acme-challenge/<token>
 *
 * The HTTP-01 answer (RFC 8555 §8.3) for an order the platform itself started. Public by design: the CA calls it from the open
 * internet, on every host we hold a certificate for. It answers only a token that is in Redis (written by the order, gone after
 * ten minutes or when the order ends) and exposes nothing else; a malformed token is a 404 without a lookup.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  const keyAuthorization = await readChallenge(token);
  if (!keyAuthorization) return new NextResponse('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new NextResponse(keyAuthorization, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
