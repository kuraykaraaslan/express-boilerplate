# Network

Dependency-free leaf module providing **network primitives** shared across the
platform. Today it centralises subnet-based access control; it is the intended
home for future network-layer concerns (geo/ASN lookup, SSRF egress policy,
proxy header parsing, rate-limit keying by network, …).

Everything is modelled as a **subnet (CIDR)**: a single host is just a `/32`
(IPv4) or `/128` (IPv6). A bare address is canonicalised to its host route.

## Exports

Import from the barrel: `import { ipMatchesAllowlist, SubnetListSchema } from '@/modules/network';`

### Matching (`network.ip.ts`)
- `ipMatchesAllowlist(ip, subnets)` — `true` when `ip` is permitted. An empty
  list permits everything; a non-empty one **denies by default** and an
  `unknown`/missing IP **fails closed**. IPv4 CIDR uses real mask arithmetic;
  IPv6 matches by exact (normalised) address.
- `ipInSubnet(ip, subnet)` — whether a single IP falls inside one subnet.
- `parseSubnet(rule)` — `{ subnet, base, bits, version }` or `null` if invalid. An IPv4-mapped IPv6 rule is read as
  the IPv4 rule it stands for (`::ffff:a00:0/104` → `10.0.0.0/8`; a mapped prefix shorter than `/96` is invalid),
  because clients are always collapsed to plain IPv4.
- `normalizeSubnet(rule)` — canonical CIDR form (bare IP → `/32` / `/128`) or `null`.
- `isValidSubnet(rule)` — boolean validity.
- `normalizeIp(ip)` — collapse an IPv4-mapped IPv6 address to plain IPv4, in dotted (`::ffff:1.2.3.4`) or hex
  (`::ffff:102:304`) notation.
- `parseSubnetString(value)` — split a comma/whitespace/newline-separated string into rules.

### Allow/deny lists (`ip_subnet.lists.ts`)
- `ipListVerdict(ip, blacklist, whitelist)` — `'allowed' | 'blocked' | 'not_allowed'` for a stored deny/allow list
  pair (deny first; a set allow list refuses a missing address).
- `invalidSubnetEntries(value)` — the entries of a stored list that are not an address or CIDR block (stricter than
  `isValidSubnet`: an IPv6 base must parse too).

### Proxy headers (`ip_subnet.forwarded.ts`)
- `clientIpFromForwardedFor(header, trustedHops)` — the client IP from X-Forwarded-For, trusting exactly that many
  appending proxies (the entry that many places from the right); `0` ignores the header. Only safe behind a proxy that
  writes the header. `DEFAULT_TRUSTED_PROXY_HOPS` is 1.

### Types (`network.types.ts`)
- `SubnetSchema` — Zod schema for a single subnet. Accepts a bare IP and
  canonicalises it to `/32` / `/128`; rejects anything that is not a valid
  address / CIDR block.
- `SubnetListSchema` — array of subnets (capped at 64).
- `Subnet`, `SubnetList`, `SubnetDescriptor` — inferred/structural types.

### Enums (`network.enums.ts`)
- `IpVersionEnum` — `'v4' | 'v6'`.

## Consumers
- **tenant_session** / **dashboard** — the tenant IP allow/deny lists (`ipListVerdict`, `clientIpFromForwardedFor`).
- **tenant_setting** — validates the lists on write and refuses a write that would lock its writer out.
- **api_key** — per-key and tenant-default subnet allowlists are validated with
  `SubnetListSchema` and enforced at verify time via `ipMatchesAllowlist`.

> Candidate for consolidation: `webhook/webhook.ssrf.ts` also carries IP/CIDR
> logic and could migrate here.
