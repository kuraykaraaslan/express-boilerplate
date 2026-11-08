/**
 * IP classification for SSRF defence — pure predicates, no DNS, no I/O.
 *
 * Extracted from webhook.ssrf.ts so BOTH the webhook guard and the shared
 * `safe-fetch` egress client (which pins the validated IP for the connection to
 * close the DNS-rebinding window) classify addresses through one implementation.
 * Lives in `common` (a dependency-free leaf) so `webhook → common` stays the
 * correct dependency direction.
 */

/** Parse an IPv4 string to a 32-bit unsigned int, or null if not IPv4. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inV4Range(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** True for private / loopback / link-local / CGNAT / multicast / reserved IPv4, and for anything that is not a dotted quad. */
function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // not a dotted quad (`127.1`, `0x7f.1`, junk): fail closed
  return (
    inV4Range(ipInt, '0.0.0.0', 8) ||        // "this" network
    inV4Range(ipInt, '10.0.0.0', 8) ||       // private
    inV4Range(ipInt, '100.64.0.0', 10) ||    // CGNAT
    inV4Range(ipInt, '127.0.0.0', 8) ||      // loopback
    inV4Range(ipInt, '169.254.0.0', 16) ||   // link-local (incl. 169.254.169.254 metadata)
    inV4Range(ipInt, '172.16.0.0', 12) ||    // private
    inV4Range(ipInt, '192.168.0.0', 16) ||   // private
    inV4Range(ipInt, '198.18.0.0', 15) ||    // benchmarking
    inV4Range(ipInt, '192.0.0.0', 24) ||     // IETF protocol assignments
    // TEST-NET-1/2/3 (192.0.2/24, 198.51.100/24, 203.0.113/24) are deliberately NOT blocked: they are never routed, so they reach
    // nothing, and they are the standard stand-in for a public address in fixtures and documentation (decided 2026-10-19).
    inV4Range(ipInt, '224.0.0.0', 4) ||      // multicast
    inV4Range(ipInt, '240.0.0.0', 4)         // reserved (incl. 255.255.255.255 broadcast)
  );
}

/**
 * Parse any IPv6 form (incl. `::` compression, embedded IPv4, zone id) to a
 * 128-bit BigInt, or null when not valid IPv6. Enables correct ULA/link-local
 * detection and IPv6 CIDR allowlist matching (not just fragile string compare).
 */
export function ipv6ToBigInt(ip: string): bigint | null {
  let s = ip.toLowerCase().trim();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4, ::1.2.3.4) → rewrite as two hex groups.
  const v4m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4m) {
    const v4 = ipv4ToInt(v4m[1]);
    if (v4 === null) return null;
    const hex = v4.toString(16).padStart(8, '0');
    s = s.slice(0, v4m.index) + hex.slice(0, 4) + ':' + hex.slice(4);
  }
  if (!s.includes(':')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  let groups: string[];
  if (tail === null) {
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8) return null;
  const SIXTEEN = BigInt(16);
  let val = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    val = (val << SIXTEEN) + BigInt(parseInt(g, 16));
  }
  return val;
}

function inV6Range(ipBig: bigint, base: string, maskBits: number): boolean {
  const baseBig = ipv6ToBigInt(base);
  if (baseBig === null || maskBits < 0 || maskBits > 128) return false;
  const ONE = BigInt(1);
  const full = (ONE << BigInt(128)) - ONE;
  const mask = maskBits === 0 ? BigInt(0) : full ^ ((ONE << BigInt(128 - maskBits)) - ONE);
  return (ipBig & mask) === (baseBig & mask);
}

/** True for loopback / unspecified / ULA / link-local / multicast IPv6 (and mapped/NAT64/6to4 v4). */
function isBlockedIpv6(ip: string): boolean {
  const big = ipv6ToBigInt(ip);
  if (big === null) return true; // unparsable: fail closed
  if (big === BigInt(0) || big === BigInt(1)) return true;         // ::, ::1
  // IPv4-mapped (::ffff:0:0/96), SIIT (::ffff:0:0:0/96) and NAT64 (64:ff9b::/96) — judge embedded v4.
  if (inV6Range(big, '::ffff:0:0', 96) || inV6Range(big, '::ffff:0:0:0', 96) || inV6Range(big, '64:ff9b::', 96)) {
    const v4 = Number(big & BigInt(0xffffffff)) >>> 0;
    const v4Str = [(v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join('.');
    return isBlockedIpv4(v4Str);
  }
  // 6to4 (2002::/16) carries an IPv4 address in bits 16-48: judge that one too.
  if (inV6Range(big, '2002::', 16)) {
    const v4 = Number((big >> BigInt(80)) & BigInt(0xffffffff)) >>> 0;
    if (isBlockedIpv4([(v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join('.'))) return true;
  }
  return (
    inV6Range(big, 'fc00::', 7) ||    // unique-local
    inV6Range(big, 'fe80::', 10) ||   // link-local
    inV6Range(big, 'fec0::', 10) ||   // site-local (deprecated)
    inV6Range(big, '2001::', 32) ||   // Teredo: tunnels to an embedded (obfuscated) IPv4 address
    inV6Range(big, 'ff00::', 8) ||    // multicast
    inV6Range(big, '100::', 64) ||    // discard-only
    inV6Range(big, '::', 96)          // IPv4-compatible (deprecated) / very low space
  );
}

/** True for any private / reserved / loopback / link-local address (v4 or v6). */
export function isBlockedIp(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/**
 * Match an IP against an allowlist entry — exact IP or CIDR, IPv4 AND IPv6. A malformed entry matches nothing (common.30): the
 * prefix length must be 1-3 plain digits in range (an empty or blank one used to read as /0, i.e. everything), there must be one
 * `/` at most (`10.0.0.0/8/8` used to drop the tail), and the base must be an address of its family.
 */
export function matchesAllowEntry(ip: string, entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length !== 2) return false;
    const [base, bitsRaw] = parts as [string, string];
    if (!/^\d{1,3}$/.test(bitsRaw)) return false;
    const bits = Number(bitsRaw);
    if (base.includes(':') || ip.includes(':')) {
      if (!base.includes(':') || bits > 128 || ipv6ToBigInt(base) === null) return false;
      const ipBig = ipv6ToBigInt(ip);
      return ipBig !== null && inV6Range(ipBig, base, bits);
    }
    const ipInt = ipv4ToInt(ip);
    if (ipInt !== null && ipv4ToInt(base) !== null && bits <= 32) return inV4Range(ipInt, base, bits);
    return false;
  }
  // Exact match — normalise IPv6 via BigInt so `::1` == `0:0:0:0:0:0:0:1`.
  if (trimmed.includes(':') || ip.includes(':')) {
    const a = ipv6ToBigInt(ip);
    const b = ipv6ToBigInt(trimmed);
    return a !== null && b !== null && a === b;
  }
  return ip === trimmed;
}

/**
 * The egress decision for a resolved address. Without an allowlist the address must not be a blocked/reserved range. With one:
 *  - `only` (the default, and what a TENANT-supplied list gets, e.g. a webhook's `ipAllowlist`): the list NARROWS the public space;
 *    a listed address must ALSO be public (F.common.02 / common.03: a list naming `169.254.169.254`, or `0.0.0.0/0`, used to open
 *    the metadata service and loopback to a tenant admin);
 *  - `operator`: an OPERATOR-configured list (environment, never a tenant) replaces the default rule, so an on-premises
 *    deployment can let its own flows reach its private ranges;
 *  - `public_or_listed`: public addresses plus the listed ones (an operator's probe runner inside a private network).
 * This is the single predicate the webhook guard and safe-fetch's pinning lookup both consult.
 */
export function isAddressAllowed(address: string, ipAllowlist?: string[] | null, mode: AllowlistMode = 'only'): boolean {
  const allow = (ipAllowlist ?? []).filter(Boolean);
  if (allow.length > 0) {
    const listed = allow.some((entry) => matchesAllowEntry(address, entry));
    if (mode === 'public_or_listed') return listed || !isBlockedIp(address);
    if (mode === 'operator') return listed;
    return listed && !isBlockedIp(address);
  }
  return !isBlockedIp(address);
}

/**
 * How an allowlist combines with the default rule: `only` = the listed public addresses (a tenant's list can only narrow);
 * `operator` = exactly the listed ranges, private ones included (operator configuration only); `public_or_listed` = public
 * addresses and the listed ones.
 */
export type AllowlistMode = 'only' | 'operator' | 'public_or_listed';
