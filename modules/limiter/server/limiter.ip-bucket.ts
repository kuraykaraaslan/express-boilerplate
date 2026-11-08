// The rate-limit bucket of a client address (E-06), shared by the limiter and the IP strike store.

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. Pure; used only to name a rate-limit bucket. */
export function ipv6Groups(ip: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(ip) || (ip.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = ip.includes('::') ? ip.split('::') as [string, string] : [ip, null];
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const h = parse(head);
  const t = tail === null ? [] : parse(tail);
  const missing = 8 - h.length - t.length;
  if (tail === null ? missing !== 0 : missing < 1) return null;
  const groups = [...h, ...Array(tail === null ? 0 : missing).fill('0'), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The rate-limit bucket of a client address (E-06): an IPv4 address as is, an IPv6 address as its /64 written one canonical way.
 * Every spelling of one address (zero padding, case, `::` placement) lands in one bucket, and a host cannot reset its bucket by
 * rotating addresses inside the /64 it was given.
 */
export function rateLimitBucketOf(ip: string): string {
  if (!ip.includes(':')) return ip;
  const g = ipv6Groups(ip);
  return g ? `${g.slice(0, 4).map((n) => n.toString(16)).join(':')}::/64` : ip;
}
