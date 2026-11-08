// Next.js route of this module, served at /internal/api/tls-cert (declared in module.json `appRoutes`; the file Next reads is generated into app/(modules)/).
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { servableCertificate } from '@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.certificates.service';
import { isValidDomainName, normalizeDomainName } from '@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.dto';

/**
 * GET /internal/api/tls-cert?server_name=shop.acme.io&secret=...
 *
 * The TLS terminator's certificate source (phase 51): Caddy's `tls { get_certificate http <this url> }` calls it on every handshake and
 * serves the PEM chain and private key it gets in the body. 200 = certificate chain then key; 204 = nothing for this name (Caddy then
 * refuses the handshake: there is no second issuer). Only a servable name of an ACTIVE tenant is answered, from an in-process cache.
 *
 * The body is a private key, so the route is shut three ways:
 *  - the secret (`CADDY_ASK_SECRET`, required in production: unset is a 503) is compared in constant time. Caddy cannot send a header here,
 *    so it rides in the query of the URL Caddy is configured with, and a `Authorization: Bearer` header is accepted as well;
 *  - a request that came through the public proxy is refused: Caddy calls the app directly on the loopback interface, and a client of the
 *    public site always arrives with its own address in `X-Forwarded-For` (Caddy's reverse_proxy overwrites a client-sent value), which is not
 *    a loopback address. Next itself fills `x-forwarded-for/host/proto/port` on EVERY request (from the socket: `::1` for a local caller), so
 *    the headers' presence says nothing; a non-loopback `X-Forwarded-For` entry, or a `Forwarded`, `Via` or `X-Real-IP` header, does;
 *  - the answer is `no-store` and never logged.
 */
function secretOk(request: NextRequest, required: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : (new URL(request.url).searchParams.get('secret') ?? '');
  // Both sides hashed to 32 bytes first, so the compare is constant-time whatever the lengths.
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(required).digest();
  return supplied.length > 0 && crypto.timingSafeEqual(a, b);
}

const LOOPBACK = /^(?:::1|127(?:\.\d{1,3}){3}|::ffff:127(?:\.\d{1,3}){3})$/i;

/** True when the request carries the mark of the public proxy: any non-loopback `X-Forwarded-For` entry, or a `Forwarded` / `Via` / `X-Real-IP` header. */
function cameThroughProxy(request: NextRequest): boolean {
  if (['forwarded', 'via', 'x-real-ip'].some((h) => request.headers.has(h))) return true;
  const xff = request.headers.get('x-forwarded-for');
  return xff !== null && xff.split(',').map((a) => a.trim()).filter(Boolean).some((a) => !LOOPBACK.test(a));
}

const noStore = { 'cache-control': 'no-store' };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requiredSecret = process.env.CADDY_ASK_SECRET;
  if (!requiredSecret) {
    // Unlike the ask route this one never opens up in development: it hands out private keys.
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: env.NODE_ENV === 'production' ? 503 : 404, headers: noStore });
  }
  if (cameThroughProxy(request)) {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403, headers: noStore });
  }
  if (!secretOk(request, requiredSecret)) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401, headers: noStore });
  }

  const raw = (new URL(request.url).searchParams.get('server_name') ?? '').slice(0, 253);
  const serverName = normalizeDomainName(raw);
  if (!serverName || !isValidDomainName(serverName)) return new NextResponse(null, { status: 204, headers: noStore });

  const held = await servableCertificate(serverName);
  if (!held) {
    // logger.02: the name is data; control characters are escaped so it cannot forge a log line.
    Logger.info(`[tls-cert] none for ${JSON.stringify(serverName)}`);
    return new NextResponse(null, { status: 204, headers: noStore });
  }
  return new NextResponse(`${held.certPem.trimEnd()}\n${held.keyPem.trimEnd()}\n`, { status: 200, headers: { 'content-type': 'application/x-pem-file', ...noStore } });
}
