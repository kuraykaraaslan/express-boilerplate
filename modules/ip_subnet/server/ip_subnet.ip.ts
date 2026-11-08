import type { IpVersion } from './ip_subnet.enums';

// Subnet matching. Everything is modelled as a CIDR subnet: a single host is
// just a /32 (IPv4) or /128 (IPv6). Both families are matched with real mask
// arithmetic (uint32 for v4, 128-bit BigInt for v6). Never throws on
// malformed input.

/** Structured, validated view of a subnet rule. */
export interface SubnetDescriptor {
  /** Canonical CIDR form, e.g. `192.168.1.182/32`. */
  subnet: string;
  /** Base address without the mask. */
  base: string;
  /** Prefix length. */
  bits: number;
  version: IpVersion;
}

/** Parse a dotted-quad IPv4 string into a uint32, or null if not IPv4. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    acc = (acc << 8) | n;
  }
  // `>>> 0` coerces back to an unsigned 32-bit integer.
  return acc >>> 0;
}

function matchesV4Cidr(ipInt: number, rangeInt: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Parse a full or compressed IPv6 address (`::` shorthand, optional trailing
 * IPv4-in-IPv6 tail like `::ffff:1.2.3.4`) into its 128-bit value, or null if
 * it is not a well-formed IPv6 address.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip.trim();
  if (!addr.includes(':')) return null;

  // An embedded trailing IPv4 address (`a:b:c:d:e:f:1.2.3.4`) is rewritten as
  // two hextets so the rest of the parser only ever sees hex groups.
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    const hi = (v4 >>> 16) & 0xffff;
    const lo = v4 & 0xffff;
    addr = `${addr.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const doubleColonCount = (addr.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;
  const hasDoubleColon = doubleColonCount === 1;

  let headParts: string[];
  let tailParts: string[];
  if (hasDoubleColon) {
    const idx = addr.indexOf('::');
    const head = addr.slice(0, idx);
    const tailStr = addr.slice(idx + 2);
    headParts = head.length ? head.split(':') : [];
    tailParts = tailStr.length ? tailStr.split(':') : [];
    if (headParts.length + tailParts.length >= 8) return null;
  } else {
    headParts = addr.split(':');
    tailParts = [];
    if (headParts.length !== 8) return null;
  }

  const missing = 8 - headParts.length - tailParts.length;
  const allParts = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  if (allParts.length !== 8) return null;

  let acc = BigInt(0);
  for (const part of allParts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    acc = (acc << BigInt(16)) | BigInt(Number.parseInt(part, 16));
  }
  return acc;
}

function matchesV6Cidr(ipBig: bigint, rangeBig: bigint, bits: number): boolean {
  if (bits === 0) return true;
  const fullMask = (BigInt(1) << BigInt(128)) - BigInt(1);
  const mask = bits === 128 ? fullMask : (fullMask << BigInt(128 - bits)) & fullMask;
  return (ipBig & mask) === (rangeBig & mask);
}

/**
 * Normalise an IPv4-mapped IPv6 address to plain IPv4, in either notation: dotted (`::ffff:1.2.3.4`) or hex
 * (`::ffff:102:304`, `0:0:0:0:0:ffff:102:304`). Anything else comes back trimmed and unchanged.
 */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(trimmed);
  if (m) return m[1];
  if (!trimmed.includes(':')) return trimmed;
  const big = ipv6ToBigInt(trimmed);
  if (big === null || big >> BigInt(32) !== BigInt(0xffff)) return trimmed;
  const v4 = Number(big & BigInt(0xffffffff));
  return [v4 >>> 24, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff].join('.');
}

/**
 * The unit one client controls, as a counter's key: an IPv4 address (or an IPv4-mapped IPv6 one) as itself, an IPv6 address as its /64
 * written one canonical way (`2001:db8:1:2::/64`, the shape of the limiter's buckets, limiter.ip-bucket.ts). A host is handed a /64, so
 * a key on the full address is reset by rotating inside it. Anything that is not an address comes back trimmed and unchanged.
 */
export function addressBucketOf(ip: string): string {
  const v = normalizeIp(ip);
  if (!v.includes(':')) return v;
  const big = ipv6ToBigInt(v);
  if (big === null) return v;
  const groups = [0, 1, 2, 3].map((i) => Number((big >> BigInt(112 - 16 * i)) & BigInt(0xffff)).toString(16));
  return `${groups.join(':')}::/64`;
}

/** A CIDR prefix length written as plain decimal digits, else NaN. `Number()` alone would read '' as 0 and take hex, exponent and signed forms. */
function parsePrefix(raw: string): number {
  return /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
}

/**
 * Parse a subnet rule into a {@link SubnetDescriptor}, or null when it is not a
 * recognisable address / CIDR block. A bare address is treated as a host route:
 * `/32` for IPv4, `/128` for IPv6.
 */
export function parseSubnet(value: string): SubnetDescriptor | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let base = trimmed;
  let bitsRaw: string | undefined;
  if (trimmed.includes('/')) {
    const slash = trimmed.indexOf('/');
    base = trimmed.slice(0, slash);
    bitsRaw = trimmed.slice(slash + 1);
  }

  const v4Base = normalizeIp(base);
  if (ipv4ToInt(v4Base) !== null) {
    // An IPv4-mapped IPv6 rule (`::ffff:a00:0/104`) is the IPv4 rule it stands for (`10.0.0.0/8`): clients are always
    // collapsed to plain IPv4 (normalizeIp), so as an IPv6 rule it could never match. Its prefix counts from bit 96.
    const mapped = base.includes(':');
    let bits = bitsRaw === undefined ? 32 : parsePrefix(bitsRaw);
    if (mapped && bitsRaw !== undefined) bits -= 96;
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    return { subnet: `${v4Base}/${bits}`, base: v4Base, bits, version: 'v4' };
  }

  if (base.includes(':')) {
    const bits = bitsRaw === undefined ? 128 : parsePrefix(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) return null;
    return { subnet: `${base}/${bits}`, base, bits, version: 'v6' };
  }

  return null;
}

/** Canonical CIDR form of a rule (bare IP → /32 or /128), or null if invalid. */
export function normalizeSubnet(value: string): string | null {
  return parseSubnet(value)?.subnet ?? null;
}

/** Whether `value` is a valid subnet / address. */
export function isValidSubnet(value: string): boolean {
  return parseSubnet(value) !== null;
}

/** An IPv6 client address without its zone id (`fe80::1%eth0` -> `fe80::1`): the zone names a local interface, not a different address. */
function stripZone(ip: string): string {
  const trimmed = ip.trim();
  const pct = trimmed.indexOf('%');
  if (pct < 0 || pct !== trimmed.lastIndexOf('%') || pct === trimmed.length - 1) return ip;
  const addr = trimmed.slice(0, pct);
  return addr.includes(':') && !/[\s/]/.test(trimmed.slice(pct + 1)) ? addr : ip;
}

/** Whether a single IP falls inside a single subnet. A zone id on the client address is ignored; a rule may not carry one. */
export function ipInSubnet(ip: string | null | undefined, subnet: string): boolean {
  if (!ip || ip === 'unknown') return false;
  const desc = parseSubnet(subnet);
  if (!desc) return false;

  const candidate = normalizeIp(stripZone(ip));
  if (desc.version === 'v4') {
    const ipInt = ipv4ToInt(candidate);
    const baseInt = ipv4ToInt(desc.base);
    if (ipInt === null || baseInt === null) return false;
    return matchesV4Cidr(ipInt, baseInt, desc.bits);
  }
  const ipBig = ipv6ToBigInt(candidate);
  const baseBig = ipv6ToBigInt(desc.base);
  if (ipBig === null || baseBig === null) return false;
  return matchesV6Cidr(ipBig, baseBig, desc.bits);
}

/**
 * Returns true when `ip` is permitted by `subnets`. An empty/undefined list
 * permits everything (no restriction). A non-empty list denies by default — the
 * IP must fall inside at least one subnet. An `unknown`/missing IP never matches
 * a non-empty list (fail closed).
 */
export function ipMatchesAllowlist(ip: string | null | undefined, subnets: string[] | null | undefined): boolean {
  const rules = (subnets ?? []).map((r) => r.trim()).filter(Boolean);
  if (rules.length === 0) return true;
  if (!ip || ip === 'unknown') return false;
  return rules.some((subnet) => ipInSubnet(ip, subnet));
}

/** Parse a comma/whitespace/newline-separated subnet list into rules. */
export function parseSubnetString(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
