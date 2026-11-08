import { env } from '@kuraykaraaslan-labs/env';
import { DEFAULT_TRUSTED_PROXY_HOPS, clientIpFromForwardedFor } from '@kuraykaraaslan-labs/ip_subnet';

// The header parsing lives in ip_subnet (shared with tenant_setting's list-write guard); re-exported for existing callers.
export { DEFAULT_TRUSTED_PROXY_HOPS, clientIpFromForwardedFor };

/**
 * The request's client IP as the tenant IP policy sees it: X-Forwarded-For through `TRUSTED_PROXY_HOPS` trusted proxies.
 * X-Real-IP, CF-Connecting-IP and the like are deliberately not read: the edge drops them (Caddyfile.node `hardening`),
 * and anywhere it does not, a client can set them. Only safe behind a proxy that overwrites or appends to the header:
 * an app exposed directly (the shipped docker-compose `app` service on :3000) lets the client choose this value.
 */
export function trustedClientIp(request: { headers: Pick<Headers, 'get'> }): string | null {
  const hops = env.TRUSTED_PROXY_HOPS ?? DEFAULT_TRUSTED_PROXY_HOPS;
  return clientIpFromForwardedFor(request.headers.get('x-forwarded-for'), hops);
}
