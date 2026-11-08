/**
 * The Redis keys of the address bans, in a file with no imports so the strike store (limiter.ip-strikes.ts), the durable store
 * (limiter.ip-ban-store.ts) and the proxy's ban gate (limiter.ban-gate.ts) name the same keys without pulling each other in.
 */

/** One ban: the JSON `IpBan`, with the ban's own TTL. `target` is an IPv4 address, an IPv6 /64 bucket or a masked CIDR block. */
export const banKey = (target: string) => `ip-ban:${target}`;
export const BAN_KEY_PATTERN = 'ip-ban:*';

/** The ban index (a sorted set, score = `until` in ms) that `listBans` reads; see limiter.ip-strikes.ts. */
export const BAN_INDEX_KEY = 'ip-bans';

/**
 * One hash of the state the ban gate reads in a single HGETALL every few seconds:
 *  - `hydratedAt`: set by the rebuild from the database (limiter.ip-ban-store.ts). A Redis flush removes it with everything else, so its
 *    absence is how a gate (or the boot hook) learns that the hot copy must be rebuilt;
 *  - `cidr:<block>`: the `until` (ms) of each active CIDR ban, so a block is matched without a key per address in it. Ended entries are
 *    ignored by the readers and removed by the next write that sees them.
 * No TTL: it is small (one field per CIDR ban) and its fields carry their own end.
 */
export const BAN_STATE_KEY = 'ip-bans:state';
export const BAN_STATE_HYDRATED_FIELD = 'hydratedAt';
export const BAN_STATE_CIDR_PREFIX = 'cidr:';
