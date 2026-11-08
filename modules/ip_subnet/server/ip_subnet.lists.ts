import { ipInSubnet, ipMatchesAllowlist, parseSubnet, parseSubnetString } from './ip_subnet.ip';

/** What an allow/deny list pair says about one address. */
export type IpListVerdict = 'allowed' | 'blocked' | 'not_allowed';

/**
 * Judge `ip` against a deny list then an allow list, both as stored strings (addresses and CIDR blocks separated by
 * commas, spaces or newlines). `blocked`: inside the deny list. `not_allowed`: an allow list is set and the address is
 * outside it, or there is no address (fail closed). A deny list alone never refuses a missing address.
 */
export function ipListVerdict(
  ip: string | null | undefined,
  blacklist: string | null | undefined,
  whitelist: string | null | undefined,
): IpListVerdict {
  const deny = parseSubnetString(blacklist);
  const allow = parseSubnetString(whitelist);
  if (deny.length > 0 && ip && ipMatchesAllowlist(ip, deny)) return 'blocked';
  if (allow.length > 0 && !ipMatchesAllowlist(ip, allow)) return 'not_allowed';
  return 'allowed';
}

/**
 * The entries of a stored list that are not an address or CIDR block. Stricter than `isValidSubnet`, which takes any
 * base containing a colon as IPv6: here the base must also parse as an address, so a typo cannot slip in as a rule
 * that never matches (in an allow list, one rule nobody matches still refuses everyone).
 */
export function invalidSubnetEntries(value: string | null | undefined): string[] {
  return parseSubnetString(value).filter((rule) => {
    const desc = parseSubnet(rule);
    return !desc || !ipInSubnet(desc.base, desc.subnet);
  });
}
