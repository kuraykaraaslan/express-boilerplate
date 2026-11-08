import { DEFAULT_TRUSTED_PROXY_HOPS, clientIpFromForwardedFor } from './ip_subnet.forwarded';

/** `TRUSTED_PROXY_HOPS` (validated 0..10 by the env schema at boot); read from the process env here so this helper pulls in no config loader and stays usable from any surface. */
function trustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * The client address of a request, the ONE way every consumer (rate limiter, audit rows, login attempts, device recognition)
 * reads it (docs/phases/38-security 1.1, 1.2): X-Forwarded-For through `TRUSTED_PROXY_HOPS` trusted proxies. The raw header,
 * its first entry and X-Real-IP are client-chosen and are never used. Undefined when there is no usable address.
 */
export function clientIpOf(headers: { get(name: string): string | null }): string | undefined {
  return clientIpFromForwardedFor(headers.get('x-forwarded-for'), trustedHops()) ?? undefined;
}
