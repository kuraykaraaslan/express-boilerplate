/**
 * What a ban covers (docs/phases/55-ai-firewall 00 §0.2): an address or a CIDR block, written ONE way, so a ban, its lift, the proxy's
 * gate and the self-lockout guard compare the same string. Pure.
 *
 *  - An IPv4 address (or an IPv4 `/32`) is the address itself, the limiter's bucket.
 *  - An IPv6 address, or any IPv6 block of `/64` or narrower, is its /64 bucket (`2001:db8:1:2::/64`, limiter.ip-bucket.ts): a host is
 *    given a /64 and rotates inside it, so the limiter, the strikes and the bans never key on less.
 *  - A wider block is masked to its network (`10.20.30.40/16` -> `10.20.0.0/16`, `2001:db8:abcd:12::/48` -> `2001:db8:abcd:0::/48`).
 *    It may not be wider than `MIN_BAN_PREFIX` (IPv4 /16, IPv6 /32): a ban is a temporary measure against one actor; a wider range is
 *    a policy decision and belongs in the global blocklist (`globalIpBlacklist`), which has no end and is reviewed as a setting.
 */
import { ipInSubnet, normalizeIp, parseSubnet } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.ip';
import { ipv6Groups, rateLimitBucketOf } from './limiter.ip-bucket';

export const MIN_BAN_PREFIX = { v4: 16, v6: 32 } as const;
/** The longest target string (`ffff:ffff:ffff:ffff::/64` is 24; an IPv4 block 18): the column is 64. */
export const BAN_TARGET_MAX_LENGTH = 64;

export type BanTarget = { kind: 'address' | 'cidr'; target: string };
export type BanTargetResult = ({ ok: true } & BanTarget) | { ok: false; reason: 'invalid' | 'too_broad' };

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((acc, p) => acc * 256 + Number(p), 0);
}

const intToV4 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');

/** The canonical target of an address or CIDR block as an operator types it, or why it is not one. */
export function banTargetOf(input: string): BanTargetResult {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > BAN_TARGET_MAX_LENGTH || /\s/.test(raw)) return { ok: false, reason: 'invalid' };
  const desc = parseSubnet(raw);
  // The base must itself be an address (parseSubnet takes any base with a colon as IPv6), as invalidSubnetEntries requires.
  if (!desc || !ipInSubnet(desc.base, desc.subnet)) return { ok: false, reason: 'invalid' };

  if (desc.version === 'v4') {
    const base = v4ToInt(normalizeIp(desc.base));
    if (base === null) return { ok: false, reason: 'invalid' };
    if (desc.bits === 32) return { ok: true, kind: 'address', target: intToV4(base) };
    if (desc.bits < MIN_BAN_PREFIX.v4) return { ok: false, reason: 'too_broad' };
    const mask = desc.bits === 0 ? 0 : (0xffffffff << (32 - desc.bits)) >>> 0;
    return { ok: true, kind: 'cidr', target: `${intToV4((base & mask) >>> 0)}/${desc.bits}` };
  }

  const groups = ipv6Groups(desc.base);
  if (!groups) return { ok: false, reason: 'invalid' };
  if (desc.bits >= 64) return { ok: true, kind: 'address', target: rateLimitBucketOf(desc.base) };
  if (desc.bits < MIN_BAN_PREFIX.v6) return { ok: false, reason: 'too_broad' };
  // bits < 64: only the first four groups can be non-zero after the mask.
  const masked = groups.slice(0, 4).map((g, i) => {
    const keep = Math.max(0, Math.min(16, desc.bits - i * 16));
    return keep === 0 ? 0 : g & ((0xffff << (16 - keep)) & 0xffff);
  });
  return { ok: true, kind: 'cidr', target: `${masked.map((n) => n.toString(16)).join(':')}::/${desc.bits}` };
}

/** The kind of a stored target: a block wider than the bucket is a CIDR ban, everything else (an address, a /64 bucket) an address ban. */
export function banKindOf(target: string): 'address' | 'cidr' {
  if (!target.includes('/')) return 'address';
  return target.includes(':') && target.endsWith('/64') ? 'address' : 'cidr';
}

/** Whether a ban on `target` (canonical, from `banTargetOf`) covers the client address `ip`. An unknown address is covered by nothing. */
export function banCovers(target: string, ip: string | null | undefined): boolean {
  if (!ip || ip === 'unknown') return false;
  if (banKindOf(target) === 'address') return rateLimitBucketOf(normalizeIp(ip)) === target;
  return ipInSubnet(ip, target);
}
