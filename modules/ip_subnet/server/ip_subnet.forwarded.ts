import { ipInSubnet, normalizeIp } from './ip_subnet.ip';

/** Default number of trusted proxies in front of the app: one edge proxy (the node Caddyfile overwrites the header with the peer it saw). */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/** One X-Forwarded-For entry as a bare address: `[v6]:port` and `v4:port` lose the port, `::ffff:v4` becomes v4. Null when it is not an IP. */
function bareAddress(entry: string): string | null {
  let value = entry.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));
  value = normalizeIp(value);
  if (!value || value.includes('/')) return null;
  // parseSubnet alone takes any text with a colon as IPv6; an address that matches itself as a host rule really parses.
  return ipInSubnet(value, value) ? value : null;
}

/**
 * The client IP from an X-Forwarded-For value, trusting exactly `trustedHops` proxies.
 *
 * Each trusted proxy appends the address it received the request from, so the client is the entry `trustedHops` places
 * from the right; anything further left was written by the client and is never read. With fewer entries than hops the
 * leftmost entry was still written by a trusted proxy, so it is used. `trustedHops <= 0` means no proxy: the header is
 * ignored. Null when there is no usable address.
 *
 * Only as safe as the proxy in front: an app reachable without a proxy that overwrites or appends to the header lets a
 * client choose this value (Next fills the header from the socket only when the request has none).
 */
export function clientIpFromForwardedFor(header: string | null | undefined, trustedHops: number): string | null {
  if (!header || !(trustedHops > 0)) return null;
  const entries = header.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  const index = Math.max(0, entries.length - Math.floor(trustedHops));
  return bareAddress(entries[index]);
}
