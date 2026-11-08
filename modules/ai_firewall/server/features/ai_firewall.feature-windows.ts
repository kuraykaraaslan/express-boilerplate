/**
 * The feature store's windows and Redis layout (docs/phases/55-ai-firewall/02 §2.1). Pure: key names, bucket math, expiry.
 *
 * Four rolling windows per actor: 1 min, 5 min, 1 h, 24 h. Each is kept as fixed buckets of its own length (bucket `b` of a window of
 * `L` seconds covers [b·L, (b+1)·L)), and a reading is the sliding estimate of the last `L` seconds:
 *
 *     value = current bucket + previous bucket × (1 − elapsed share of the current bucket)
 *
 * the approximation rate limiters use (two keys per window instead of one per second). A distinct count (HyperLogLog) cannot be
 * weighted, so it is the union of the two buckets: it covers between `L` and `2L` seconds.
 *
 * Every key has an expiry: a bucket key lives until its successor has ended (`(b + 2)·L` plus a minute), so a reading never finds a
 * bucket gone too early and nothing outlives two windows. A write for a bucket older than the previous one is dropped (a late signal
 * would otherwise recreate a key that already expired).
 *
 * Keys (scope `p` = the platform: addresses across every tenant; `t:<tenantId>` = an actor inside a tenant; the actor id is always the
 * keyed hash of `ai_firewall.feature-id.ts`, never the raw value):
 *
 *   fw:fc:<w>:<b>:<scope>:<kind>:<hash>          hash   counters of one window bucket (field names: FEATURE_FIELDS)
 *   fw:fd:<w>:<b>:<scope>:<kind>:<hash>:<dim>    HLL    distinct accounts / addresses / subjects / endpoints of one bucket
 *   fw:fk:<scope>:<kind>:<hash>                  set    route templates the actor ever touched (hashed), for "new endpoints"
 *   fw:fp:<day>:<scope>:<kind>:<hash>            hash   the actor's day profile (UTC day): hours, route-class volume, export bytes,
 *                                                       admin actions, countries, ASNs, devices, role; read by the daily baseline job
 *   fw:fpd:<day>:<scope>:<kind>:<hash>:<dim>     HLL    the day's distinct subjects and addresses
 *   fw:fa:<day>                                  set    the actors with a day profile (`<scope>|<kind>|<hash>`), the job's work list
 *   fw:fx:<scope>:<kind>:<hash>                  string an erased actor (D55-46): the baseline job folds nothing for it while it lives
 */

export const FEATURE_WINDOWS = [
  { id: '1m', seconds: 60 },
  { id: '5m', seconds: 300 },
  { id: '1h', seconds: 3_600 },
  { id: '24h', seconds: 86_400 },
] as const;
export type WindowId = (typeof FEATURE_WINDOWS)[number]['id'];
export const WINDOW_IDS: readonly WindowId[] = FEATURE_WINDOWS.map((w) => w.id);
export const windowSeconds = (id: WindowId): number => FEATURE_WINDOWS.find((w) => w.id === id)!.seconds;

/** Distinct dimensions (HyperLogLog): accounts seen from an address, addresses an account used, subjects touched, endpoints touched. */
export const DISTINCT_DIMS = ['acct', 'addr', 'subj', 'ep'] as const;
export type DistinctDim = (typeof DISTINCT_DIMS)[number];
/** The day profile's distinct dimensions (baselines: usual subjects and addresses per day). */
export const PROFILE_DIMS = ['subj', 'addr'] as const;
export type ProfileDim = (typeof PROFILE_DIMS)[number];

/** Slack after a bucket's successor ended before its key expires, seconds. */
export const BUCKET_SLACK_SECONDS = 60;
/**
 * How long the touched-endpoint set of an address (or an anonymous caller) is kept since its last addition: addresses churn, and a set
 * per address on the shared Redis must not outlive a day of churn (D55-48; "new" for an address means new in the last day).
 */
export const KNOWN_ENDPOINTS_TTL_ADDRESS_SECONDS = 86_400;
/** The same for a person, a session, a key or a device: long enough that a route used last month is not "new". */
export const KNOWN_ENDPOINTS_TTL_SECONDS = 35 * 86_400;
/** A day profile and the day's work list stay this long after their day ended (the job reads yesterday's at 00:20 UTC). */
export const PROFILE_KEEP_SECONDS = 2 * 86_400;
/**
 * How long an erased actor's mark lives: longer than any day profile can (today's lives until the end of today plus
 * PROFILE_KEEP_SECONDS), so a flush that raced the erasure never brings a baseline back.
 */
export const ERASED_MARK_SECONDS = PROFILE_KEEP_SECONDS + 2 * 86_400;
/** Most fields one day profile holds (hours, classes and the capped countries / ASNs / devices together). */
export const PROFILE_FIELDS_MAX = 128;

/** The scope of an actor kind's features: an address (or an anonymous caller) is the platform's, everything else its tenant's. */
export const PLATFORM_SCOPE = 'p';
export const tenantScope = (tenantId: string): string => `t:${tenantId.toLowerCase()}`;
export const isPlatformActorKind = (kind: string): boolean => kind === 'ip' || kind === 'anon';
export function scopeOf(kind: string, tenantId: string | null): string | null {
  if (isPlatformActorKind(kind)) return PLATFORM_SCOPE;
  return tenantId ? tenantScope(tenantId) : null;
}
/** The tenant a scope's rows are stored under: the platform's under the ROOT tenant (as the event store does). */
export function scopeTenant(scope: string, rootTenantId: string): string | null {
  if (scope === PLATFORM_SCOPE) return rootTenantId;
  return scope.startsWith('t:') && scope.length > 2 ? scope.slice(2) : null;
}

export const bucketOf = (atSeconds: number, seconds: number): number => Math.floor(atSeconds / seconds);
/** When a bucket's key expires (unix seconds). */
export const bucketExpireAt = (bucket: number, seconds: number): number => (bucket + 2) * seconds + BUCKET_SLACK_SECONDS;
/** Whether a bucket may still be written at `nowSeconds` (the current or the previous one). */
export const bucketIsLive = (bucket: number, seconds: number, nowSeconds: number): boolean => bucket >= bucketOf(nowSeconds, seconds) - 1;

export const actorPart = (scope: string, kind: string, hash: string): string => `${scope}:${kind}:${hash}`;
export const counterKey = (w: WindowId, bucket: number, actor: string): string => `fw:fc:${w}:${bucket}:${actor}`;
export const distinctKey = (w: WindowId, bucket: number, actor: string, dim: DistinctDim): string => `fw:fd:${w}:${bucket}:${actor}:${dim}`;
export const knownEndpointsKey = (actor: string): string => `fw:fk:${actor}`;
export const profileKey = (day: string, actor: string): string => `fw:fp:${day}:${actor}`;
export const profileDistinctKey = (day: string, actor: string, dim: ProfileDim): string => `fw:fpd:${day}:${actor}:${dim}`;
export const activeActorsKey = (day: string): string => `fw:fa:${day}`;
/** An erased actor's mark (privacy erasure, D55-46): the baseline job skips the actor while it lives (ERASED_MARK_SECONDS). */
export const erasedMarkKey = (actor: string): string => `fw:fx:${actor}`;
export const activeMember = (scope: string, kind: string, hash: string): string => `${scope}|${kind}|${hash}`;
export function parseActiveMember(member: string): { scope: string; kind: string; hash: string } | null {
  const parts = member.split('|');
  return parts.length === 3 && parts.every(Boolean) ? { scope: parts[0]!, kind: parts[1]!, hash: parts[2]! } : null;
}

/** The UTC day of a time, `YYYYMMDD`. */
export function dayOf(atMs: number): string {
  const d = new Date(atMs);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** When a day's profile keys expire (unix seconds): the end of the day plus PROFILE_KEEP_SECONDS. */
export function profileExpireAt(atMs: number): number {
  const d = new Date(atMs);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000;
  return end + PROFILE_KEEP_SECONDS;
}

/** The sliding estimate of a window from its two buckets' values. */
export function slidingValue(current: number, previous: number, nowSeconds: number, seconds: number): number {
  const elapsed = (nowSeconds - bucketOf(nowSeconds, seconds) * seconds) / seconds;
  return current + previous * (1 - elapsed);
}

/**
 * The counter fields (hash field names) of a window bucket. A feature reads only these; the folds write only these. Classes and families
 * are closed sets, so a bucket holds a bounded number of fields whatever the traffic; signal kinds are the registered ones (`k:other`
 * for the rest).
 *
 *   rq           requests (API answers and pages; assets are `ast`)
 *   rc:<class>   requests per route class (ROUTE_CLASSES)
 *   st:<class>   requests per status class (STATUS_CLASSES; `fwd` = a page the proxy forwarded, final status unknown)
 *   mw, mo       write methods; unusual methods (TRACE, CONNECT, anything not in the usual seven)
 *   pd, pe       sum of path depths; sum of path entropies ×100 (bits per character)
 *   pc, pb, bb   sum of query parameter counts; of query bytes; of request body bytes (content-length)
 *   rb           sum of answer bytes (content-length)
 *   ix:<ind>     attack indicator tokens in the path and query (INDICATORS), counts only
 *   ua:<fam>     requests per user agent family (UA_FAMILIES)
 *   ha, hna      header anomalies (sum); requests with at least one
 *   seq          sequential numeric-id steps (an id one above or below the actor's previous one on the same route)
 *   pg, pgn, pgd sum of list page depths; paged requests; requests at page 10 or deeper
 *   adm, xb      admin writes; bytes answered on export routes
 *   ast          static asset loads
 *   ar:ok/fail   sign-in route outcomes
 *   tr           requests whose gap to the previous one repeats the previous gap within 10 % (timing regularity)
 *   nep          endpoints the actor touched for the first time
 *   sup:<tag>    a step-up proved by the caller's session (keyed tag of the session id; a person's windows only, one field per proving
 *                session, each behind a real second factor; read by the request cascade only, never a feature, D55-125)
 *   s            signals; k:<kind>, o:<outcome>, ko:<kind>:<outcome>, sv:<high|critical> by kind, outcome and severity
 */
export const ROUTE_CLASSES = ['auth', 'admin', 'export', 'list', 'read', 'write', 'public', 'page', 'other'] as const;
export type RouteClass = (typeof ROUTE_CLASSES)[number];
export const STATUS_CLASSES = ['2xx', '3xx', '401', '403', '404', '429', '4xx', '5xx', 'fwd'] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];
export const INDICATORS = ['sql', 'script', 'traversal', 'template', 'command'] as const;
export type Indicator = (typeof INDICATORS)[number];
export const UA_FAMILIES = ['browser', 'mobile', 'bot', 'cli', 'library', 'empty', 'other'] as const;
export type UaFamily = (typeof UA_FAMILIES)[number];
