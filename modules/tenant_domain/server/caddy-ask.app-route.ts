// Next.js route of this module, served at /internal/api/caddy-ask (declared in module.json `appRoutes`; the file Next reads is generated into app/(modules)/).
import { NextRequest, NextResponse } from 'next/server';
import SSLProvisioningService from '@kuraykaraaslan-labs/tenant_domain/server/ssl_provisioning.service';
import Logger from '@kuraykaraaslan-labs/logger';
import crypto from 'node:crypto';
import { env } from '@kuraykaraaslan-labs/env';

/**
 * GET /internal/api/caddy-ask?domain=example.com
 *
 * Reverse-proxy hook for Caddy's `on_demand_tls.ask` directive. Caddy
 * issues this request before attempting to provision a TLS certificate
 * for an arbitrary hostname; we return 200 only when the hostname is a
 * verified custom domain registered against an ACTIVE tenant. Anything
 * else gets a 4xx, which prevents Let's Encrypt rate-limit exhaustion
 * from random clients pointing DNS at us.
 *
 * Optional Bearer auth: set `CADDY_ASK_SECRET` in the environment to
 * require Caddy to forward `Authorization: Bearer <secret>` (recommended
 * in production so only the trusted proxy can hit this).
 *
 * Caddyfile excerpt:
 *
 *     {
 *       on_demand_tls {
 *         ask http://app:3000/internal/api/caddy-ask
 *       }
 *     }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // common.12: in production the secret is REQUIRED (an unset one is a 503, not an
  // open endpoint), and the comparison is constant-time.
  const requiredSecret = process.env.CADDY_ASK_SECRET;
  if (!requiredSecret && env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 503 });
  }
  if (requiredSecret) {
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Both sides hashed to 32 bytes first, so the compare is constant-time whatever the lengths.
    const a = crypto.createHash('sha256').update(token).digest();
    const b = crypto.createHash('sha256').update(requiredSecret).digest();
    const ok = token.length > 0 && crypto.timingSafeEqual(a, b);
    if (!ok) {
      return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    }
  }

  // Caddy passes the hostname as ?domain=... (`host` for Traefik). The client-set
  // X-Forwarded-Host is NOT a source: the ask is about the name Caddy saw.
  const url = new URL(request.url);
  const domain = (url.searchParams.get('domain') ?? url.searchParams.get('host') ?? '').slice(0, 253);

  const allowed = await SSLProvisioningService.isProvisioningAllowed(domain);
  if (!allowed) {
    // logger.02: the name is data; control characters are escaped so it cannot forge a log line.
    Logger.info(`[caddy-ask] refused: ${JSON.stringify(domain)}`);
    return NextResponse.json({ ok: false, domain }, { status: 404 });
  }

  return NextResponse.json({ ok: true, domain });
}
