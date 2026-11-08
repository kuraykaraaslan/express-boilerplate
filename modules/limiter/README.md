# Limiter Module

Redis rate limiting packaged as a unified workspace module. It provides token
buckets (GCRA, one atomic Lua script per check) per scope and client address
(`check`), per signed-in person with a dynamic ceiling per address
(`checkSignedIn`, docs/phases/07-dashboard/40-data-traffic.md D40-10), a
misbehaviour signal that shrinks an address's ceiling, plus a sliding-window
helper whose per-call limit value is supplied by the caller, reused for
tenant-plan and per-webhook quotas. Its Next.js request/response glue (IP
parsing, the identity from the access token, 429 responses) is kept in the same
package's `server/*.next.ts` adapters.

---

## Files

| File | Description |
|---|---|
| `limiter.service.ts` | Token buckets: `check` (one bucket per scope and subject), `checkSignedIn` (a person's bucket and the address ceiling), the `rate:` keys, the script runner. |
| `limiter.gcra.ts` | Pure: the GCRA maths, the address ceiling, the active-user slots, and the three Lua scripts that mirror them. |
| `limiter.misbehaviour.ts` | The misbehaviour signal per address (`recordMiss`): past the threshold its ceiling is divided. |
| `limiter.session-revoked.ts` | Contribution to `user_session:session_revoked`: marks a revoked session (`rate:revoked:{sessionId}`, 24 h) so its still-valid token stops counting as its person. |
| `limiter.service.next.ts` | Next adapter: the client address, the signed-in person from the token's signature, `checkRateLimit`, the 429, the dispatcher's answer watcher. |
| `limiter.ip-strikes.ts` / `limiter.global-blocklist.ts` / `limiter.ip-bucket.ts` | Cross-account strikes and bans, the platform blocklist, the bucket of an address (IPv6 by /64). |
| `limiter.ban-gate.ts` | The proxy's ban gate (phase 55 00 §0.2): every request of a ban lane from a banned or blocklisted address is refused (`proxy/ip-ban.ts`); machine and device lanes pass on the API paths that verify their credential (L-4, `claimedLaneOn`). One GET per address and 5 s in process, fail open; starts the rebuild after a Redis flush. |
| `limiter.ban-target.ts` / `limiter.ban-keys.ts` | What a ban covers (an address, an IPv6 /64, a CIDR block of at most IPv4 /16 or IPv6 /32), written one way; the Redis keys. |
| `limiter.ip-ban-store.ts` / `entities/security_ip_ban.entity.ts` | The durable copy (`security_ip_bans`, migration 001, RLS-exempt ROOT data): manual and firewall bans and automatic ones longer than an hour; `rebuildIfFlushed`. |
| `limiter.edge-sync.ts` | The app side of the edge ban sync (phase 55 00 §0.7): every minute (scheduler boot task) the standing bans of an hour or more go to Redis `edge:app-bans` for the host's `infra/compose/edge/fleet-edge-sync` (CrowdSec local decisions of type `nb-app-ban`), and the local CrowdSec decisions it hands back (`edge:decisions:inbox`) become `edge.decision` ROOT audit rows through the refusal sink. Advice only: an edge decision bans nobody here. |
| `limiter.ban-promotion.ts` | The fifth automatic ban within the offense memory is the longest automatic ban (seven days) at once, persisted and liftable like any ban (audited `security.ip_ban_promoted`); never for an address a ROOT member signed in from within 30 days. The global blocklist is the operator's alone. |
| `limiter-ip-bans.route.ts` / `limiter.ip-bans.dto.ts` | `POST` / `DELETE /api/limiter/ip-bans`: manual ban and lift, root super-admin (GLOBAL, `limiter.ip_bans.manage`), 409 when the ban would cover the caller. The screen is Platform -> AI firewall. |
| `limiter.redis-bound.ts` | The bound of every limiter Redis round trip (limiter.03), without the service's imports. |
| `limiter.tenant-plan.service.ts` | Redis sorted-set sliding-window limiter; tenant-plan and per-webhook helpers. |
| `index.ts` | Public barrel — re-exports `check`, `LIMITS`, `RATE_LIMIT_WINDOW`, `LimiterScope`, `checkTenantPlanRateLimit`. |

One table, `security_ip_bans` (installation-wide, no tenant column); no per-tenant settings or data — limits are compile-time constants, the ROOT tightening settings or passed in by the caller.

---

## Services / Responsibilities

### `limiter.service.ts` — token buckets

GCRA ("generic cell rate algorithm"): a bucket holds `burst` tokens and gains one every 60 s / rate; its whole state is one number,
the theoretical arrival time, stored under a `rate:` key with an expiry of at most one full refill. One Lua script per check
(`limiter.gcra.ts`, EVALSHA with an EVAL fallback on NOSCRIPT) reads and writes atomically, so concurrent checks never admit more than
the burst. Unlike the fixed 60 s window it replaced, there is no minute boundary: a refused client gets a token back one emission
interval later. The scripts read the time on the Redis server (`TIME`), so every app node spends a bucket on one clock, and keep it in
whole microseconds, so a large caller budget keeps its rate (whole milliseconds held 40 000 a minute to 30 000). Every round trip is
bounded (`LIMITER_REDIS_TIMEOUT_MS`); a reply that is not the script's verdict is a Redis failure.

| Export | Description |
|---|---|
| `check(subject, scope = 'api', opts?)` | One bucket `rate:{scope}:{subject}`: `LIMITS[scope]` a minute and as many at once (`opts.limit` / `opts.burst` replace them for a caller's own budget). Returns `{ success, remaining, limit, retryAfter, resetAt }`: `retryAfter` is the wait for the next token, `resetAt` when the bucket is full. Fails open for `api` / `i18n`, closed for `auth` / `csp` (or `opts.failMode`). |
| `peek(subject, scope = 'api', { limit?, burst?, failMode? })` | The same bucket read WITHOUT spending a token (`PEEK_SCRIPT`, the read-only twin of the bucket script, on the Redis clock): `success` while a request would be admitted now. For a budget only successes spend: `peek` before the work, `check` after a success (events' per-event public registration budget, 41-ui-fixes/14 2.1). Same fail modes as `check`. Imported from `limiter/server/limiter.service`. |
| `checkSignedIn({ userId, sessionId }, address)` | A signed-in `api` request: the person's bucket `rate:user:{userId}` (`USER_API_LIMIT`, 240 a minute, 120 at once, wherever they come from) and the address ceiling `rate:ceiling:{address}`, both or neither, in one script. Refusals say `refusedBy: 'user' | 'address'`. A session marked revoked (`rate:revoked:{sessionId}`) spends the address's anonymous bucket instead. Fails open. |
| `LIMITS` | `{ auth: 20, api: 120, i18n: 600, csp: 120 }` — requests per minute per address, per scope. `i18n` is the public UI texts of `translation` (one language download is a burst of one request per module): its own counter, so it never spends the `api` budget, and exempt from the tenant plan's `api_rate_limit` (`checkRateLimit` skips the plan check for it). `csp` is the browser's CSP violation reports (D40-14), plan-exempt too. |
| `USER_API_LIMIT` | `{ perMinute: 240, burst: 120 }` (D40-10(b)). |
| `ADDRESS_CEILING` | `{ base: 120, perUser: 120, max: 3000, burstSeconds: 60 }` (D40-10(c)): 120 + 120 per user active from the address in the last 10 minutes (HyperLogLogs `rate:users:{address}:{slot}`, the current and the previous 10-minute slot), at most 3 000 a minute; a minute's worth at once, so one person's burst uses at most half of it. |
| `RATE_LIMIT_WINDOW` | `60` (seconds) — the period the rates are per, and the wait a fail-closed refusal reports. |
| `LimiterScope` | `'auth' | 'api' | 'i18n' | 'csp'` (the keys of `LIMITS`). |

### `limiter.misbehaviour.ts` — the misbehaviour signal (D40-10(d))

`recordMiss(address)` counts one miss of an address (`rate:misses:{address}`, a 5-minute window): a 401 / 403 / 404 answer of the
tenant API dispatcher (`common/server/route-answers.ts`, watched by `Limiter.noteAnswer` once `instrumentation.ts` calls
`Limiter.watchAnswers()`; the dispatcher never waits for it), or a 429 of the address's own `api` limits (its anonymous bucket, its
ceiling; counted in `checkRateLimit`). A 429 of the tenant plan's allowance or of a person's own bucket is not the address's and is not
counted. Only lanes that take part in IP bans count (human-web, human-native, public-anon: never an API key, a fleet agent, a cron job or
a provider webhook, L-4), never a request a browser marks `Sec-Fetch-Site: cross-site` or `same-site` (another site's page), never the
CSP report route. Past `MISS_THRESHOLD` (300, one a second on average) the address's ceiling is divided (`rate:shrink:{address}`): by 2
for 15 minutes, by 4 for an hour when it happens again within the hour (`rate:shrunk:{address}`). Its anonymous bucket (120, D40-10(e)),
a person's own bucket, `auth` and other addresses are untouched. Best effort: a Redis failure never changes an answer.
The AI firewall's decided throttle (`limiter.throttle`, phase 55 01.6, `throttleAddress` / `clearAddressThrottle`) divides the same
ceiling from its own key (`rate:fwshrink:{address}`); the signed-in script divides by the larger of the two, so a decision, its undo
or its expiry never replaces, shortens or lifts the script's division. The run that set it is recorded beside it
(`rate:fwshrink-by:{address}`, its proposal id, in the same MULTI with the same span), and the undo lifts the division only while that
key names its run and the divisor is the one it set, checked and deleted in one script (`CLEAR_FIREWALL_DIVISOR_SCRIPT`, D55-20).

**Signals for the AI firewall (phase 55 02.6, `limiter.firewall-emitters.ts`).** Every refusal of `checkRateLimit` (an address's bucket or
ceiling, a person's own bucket, a sign-in endpoint's budget, the tenant plan, a request without an address, an address ban of the sign-in
endpoints, the global blocklist) is TALLIED as `limiter.rate_limited` (`common/server/common.firewall-tally.ts`): counted in process and sent
as ONE signal per tenant, lane, actor and refusing control every 10 s, with the count; never a signal or an awaited call per refused request.
The actor is the person only when their own bucket refused, else the address's rate-limit bucket. A division of an address's ceiling by the
misbehaviour script is one `limiter.address_divided` signal (divisor, misses, seconds; platform-wide). Both are synchronous, never throw and
never change an answer (FWA-7); registered in `limiter.firewall-signals.ts` (D55-58).

**The AI firewall's request cascade (phase 55 04.8, D55-117).** After every control above has let a request through (`api` and `auth`
scopes only), `checkRateLimit` asks the one synchronous gate the firewall registers (`common/server/request-gate.ts`), once per request, with
the tenant, the lane whose controls apply (`signInLane` on a sign-in endpoint, `claimedLaneOn` elsewhere) and the person the access token
names (`signedInSessionOf`, signature only). `enforceGateAnswer` applies the answer: `block` is a 403 whose only detail is the support
reference, `step_up` the session step-up refusal (`sessionStepUpRequired`), `delay` waits (at most 2 s), `allow` nothing. A request the
limiter refuses never reaches the gate (the rules' floor, FWA-2); without a registered gate (no model shipped) nothing happens.

### `limiter.tenant-plan.service.ts` — sliding-window limiter

A sliding-window limiter over an arbitrary Redis sorted-set key, using a `zremrangebyscore` / `zadd` / `zcard` / `expire` pipeline over a 1-minute (`WINDOW_MS = 60_000`) window. A `limitPerMinute` of `-1` means unlimited (short-circuits to success with infinite remaining). The shared algorithm is wrapped by two id-namespaced helpers.

| Export | Key | Description |
|---|---|---|
| `checkSlidingWindowRateLimit(key, limitPerMinute)` | caller-supplied | Base helper returning `RateLimitResult` (`{ success, remaining, limit }`). |
| `checkTenantPlanRateLimit(tenantId, limitPerMinute)` | `tenant:{tenantId}:ratelimit` | Per-tenant quota bucket — each tenant gets an isolated sorted set. |
| `checkWebhookRateLimit(webhookId, limitPerMinute)` | `webhook:{webhookId}:ratelimit` | Per-endpoint webhook delivery rate limit (deliveries/minute). |

Only `checkTenantPlanRateLimit` is re-exported from `index.ts`; `checkSlidingWindowRateLimit` and `checkWebhookRateLimit` are imported directly by their consumers (e.g. the webhook module).

> **Note:** `limitPerMinute` is always supplied by the caller. There is no in-module producer resolving it from a tenant's subscription plan or feature key — see *Tenant Variability* below.

---

## Next.js adapters (`server/*.next.ts`)

HTTP-aware adapters are explicit server exports in the same package:

| Export | File | Description |
|---|---|---|
| `Limiter` (default class) | `limiter.service.next.ts` | `getIpFromRequest` (`x-forwarded-for` through `TRUSTED_PROXY_HOPS`, else `'unknown'`), `check`, `checkRateLimit`/`useRateLimit` (throws `AppError(429)`), `noteAnswer` / `watchAnswers` (the misbehaviour signal). In the `api` scope a request whose access token verifies (signature, expiry, audience, device fingerprint; no database) spends its person's bucket and the address ceiling (`checkSignedIn`); any other request, API keys and display links included, its address's bucket. |
| `signedInSessionOf(request)` / `signedInUserOf(request)` | `limiter.service.next.ts` | The person (`{ userId, sessionId }`, or its user id) of a valid access token where the guard reads it (the `accessToken` cookie with its refresh cookie, audience `web`; else `Authorization: Bearer`, audience `device`) that was minted for the tenant in the request's path, or `null`. A token of another tenant (a global admin's included) is anonymous. |
| `apiRateLimiter(request)` | `limiter.rate-limiters.ts` | Convenience wrapper for the `'api'` scope. |
| `authRateLimiter(request)` | `limiter.rate-limiters.ts` | Convenience wrapper for the `'auth'` scope. |
| `tenantPlanRateLimiter(request, tenantId, limitPerMinute)` | `limiter.rate-limiters.ts` | Calls `checkTenantPlanRateLimit` and returns a `429` with `X-RateLimit-*` / `X-RateLimit-Scope: tenant-plan` headers, or `null`. |

`429` responses carry `Retry-After` (seconds until the bucket admits again), `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`
(the deciding bucket's per-minute rate, 0, seconds until it is full) and `X-RateLimit-Limit` / `X-RateLimit-Remaining`. The tenant
plan's 429 from `checkRateLimit` carries the same fields (its allowance, what is left, and 60: its sliding window).

---

## Usage

```typescript
// Framework-agnostic IP limit (e.g. in a service):
import { check } from '@/modules/limiter';

const { success, remaining, limit } = await check(ip, 'auth');
if (!success) throw new Error('Too many requests');

// Tenant-plan quota — caller supplies the per-minute limit (-1 = unlimited):
import { checkTenantPlanRateLimit } from '@/modules/limiter';

const result = await checkTenantPlanRateLimit(tenantId, limitPerMinute);
```

```typescript
// In a Next.js route handler / middleware:
import { apiRateLimiter, tenantPlanRateLimiter } from '@kuraykaraaslan-labs/limiter/server/limiter.rate-limiters';

const limited = await apiRateLimiter(request);
if (limited) return limited; // 429 NextResponse, else null
```

---

## Installation settings (ROOT only)

`/admin/platform/rate-limits/settings` (route placement `root`; `limiter.settings.read` + `tenant_setting.config.read`, writes
`limiter.settings.update`). The keys (`limiter.setting.keys.ts`) are read from the ROOT tenant by `limiter.settings-policy.ts`,
cached in process for 30 s, and can only make the built-in protection stricter: `limiterAuthPerMinute` (5..20, the `auth` bucket),
`limiterLoginPerMinute` (3..10, the login budget), `limiterApiPerMinute` (30..120, the anonymous `api` bucket),
`limiterStrikeThreshold` (3..10) and `limiterBanBaseMinutes` (60..10080, the first automatic ban). Unset, junk or a value past the
built-in one keeps today's behaviour; a failed read keeps the last values read. A tenant's plan allowance stays plan data.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

A framework-agnostic Redis rate-limiter providing global hardcoded IP/scope limits plus a sliding-window helper whose per-call limit value is supplied by the caller; it namespaces tenant-plan and webhook limits by id but reads no per-tenant settings or data itself.

### Per-tenant behavior

- `limiter.tenant-plan.service.ts:checkTenantPlanRateLimit` — Counter keying is per real tenant — each tenant gets an isolated Redis sorted-set bucket `tenant:{tenantId}:ratelimit`, so quota consumption is tracked independently per tenant. The numeric limitPerMinute itself is passed in by the caller (not resolved inside the module), and -1 means unlimited.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Global hardcoded request-rate ceilings (auth: 20, api: 120 a minute per address; 240 a minute per person, 3 000 per address at most) applied uniformly to every IP/tenant | `limiter.service.ts — LIMITS / USER_API_LIMIT / ADDRESS_CEILING constants used by check() and checkSignedIn()` | These are compile-time globals shared across all tenants; a multi-tenant SaaS typically lets a tenant's plan raise/lower its API throughput. There is no per-tenant override path today, so a higher-tier tenant cannot get a larger api budget. (Note: IP-scoped auth/api limits are partly abuse-protection infra, so a global floor is defensible, but the api ceiling in particular is a plausible plan-differentiated value.) | `apiRateLimitPerMinute` |
| limitPerMinute for checkTenantPlanRateLimit is taken from the caller and currently has no producer wiring it to the tenant's subscription plan | `server/limiter.tenant-plan.service.ts:checkTenantPlanRateLimit / server/limiter.rate-limiters.ts:tenantPlanRateLimiter` | The module is explicitly described as 'tenant-plan-based quota enforcement' and optionally depends on tenant_subscription, but the limit value is an inbound parameter with no in-repo caller resolving it from a per-tenant plan/feature-key. The intended source is a per-tenant plan limit (e.g. a tenant_subscription feature-key or a tenant setting), which should drive limitPerMinute rather than a caller-chosen constant. | `tenantPlanRateLimitPerMinute` |

---

## Dependencies

- **Requires:** `redis`, `env`
- **Optional:** `tenant_subscription` (intended source of per-tenant plan limits; not yet wired)
