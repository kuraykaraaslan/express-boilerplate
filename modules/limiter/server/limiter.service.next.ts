import { NextRequest } from 'next/server';
import { check, LIMITS, RATE_LIMIT_WINDOW, type LimiterScope, type RateLimitCheck } from '@kuraykaraaslan-labs/limiter';
import { checkSignedIn, type SignedIn } from './limiter.service';
import { checkTenantPlanRateLimit, resolveTenantApiLimit } from './limiter.tenant-plan.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { env } from '@kuraykaraaslan-labs/env';
import IpStrikeService from './limiter.ip-strikes';
import { isGloballyBlocked } from './limiter.global-blocklist';
import { DEFAULT_LIMITER_POLICY, capped, getLimiterPolicy, type LimiterPolicy } from './limiter.settings-policy';
import { MISS_STATUSES, recordMiss } from './limiter.misbehaviour';
import { claimedLaneOn, claimedLanePolicy, laneOfRequest, laneRelativePath, signInLane, signInLanePolicy } from '@kuraykaraaslan-labs/common/server/lane';
import { CSP_REPORT_API_PATH } from '@kuraykaraaslan-labs/common/server/csp';
import { setAnswerWatcher } from '@kuraykaraaslan-labs/common/server/route-answers';
import { rateLimitBucketOf } from './limiter.ip-bucket';
import { noteTrapTouch, trapOf } from './limiter.trap-routes';
import { noteRateLimited, type RefusingControl } from './limiter.firewall-emitters';
import { DEFAULT_TRUSTED_PROXY_HOPS, clientIpFromForwardedFor } from '@kuraykaraaslan-labs/ip_subnet';
import UserSessionTokenService from '@kuraykaraaslan-labs/user_session/server/user_session.token.service';
import UserSessionNextHelpers from '@kuraykaraaslan-labs/user_session/server/user_session.next.helpers';
import { tenantQueryContext } from '@kuraykaraaslan-labs/db/server/db.utils';
import { gateRefused, gateRequest, hasRequestGate, type GateAnswer } from '@kuraykaraaslan-labs/common/server/request-gate';
import { sessionStepUpRequired } from '@kuraykaraaslan-labs/user_session/server/user_session.step-up-flag';

export { rateLimitBucketOf };

/**
 * The tenant a request is addressed to, from its own path.
 *
 * Every tenant-scoped route handler lives at `/tenant/{tenantId}/api/…` — the
 * proxy rewrites into that shape — so the id is already in the URL the handler
 * received. `redis_idempotency` has been reading it the same way.
 *
 * This is what made the plan limit adoptable at all: DEP-12 recorded the work
 * as "every route must pass its tenantId, hundreds of call sites", and none of
 * them had to.
 */
function tenantFromRequest(request: NextRequest): string | null {
  // D9: a tenant uuid spelled in upper case is the same tenant (its plan, its allowance).
  // A request to the tenant's own host (`acme.example.com/api/...`) keeps that path in its handler: the tenant is the one the dispatcher
  // runs the handler for, taken from the route the proxy rewrote the request to (2026-10-26: on the demo every signed-in request was
  // counted as anonymous, by address, because only the path was read).
  const fromPath = request.nextUrl.pathname.match(/^\/tenant\/([^/]+)/)?.[1];
  return (fromPath ?? tenantQueryContext.getStore()?.tenantId)?.toLowerCase() ?? null;
}

/** D4: whether a request presents any caller credential (verified later by the route's guard, not here). */
function carriesCredential(request: NextRequest): boolean {
  return !!(request.cookies?.get('accessToken')?.value || request.cookies?.get('refreshToken')?.value
    || request.headers.get('authorization') || request.headers.get('x-api-key'));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * D40-10(b): the person a request is signed in as, from its access token's SIGNATURE alone: no database and no session lookup (the
 * route's guard does those after this). The token is read where the guard reads it (user_session.service.next.ts): the `accessToken`
 * cookie, audience `web`, bound to the device fingerprint and only next to a refresh cookie; else `Authorization: Bearer`, audience
 * `device`. Absent, forged, expired, minted for the other audience or carried from another device: null, and the request is
 * anonymous, counted by its address. So is a token minted for another tenant than the one the request is addressed to (every session
 * belongs to one tenant; the guard refuses it there, S1), or for no tenant in the path: a sign-up anywhere must not buy a person's
 * budget on every tenant. A global admin working in a tenant they are not a member of is therefore counted by address, as everyone
 * was before 40.1. A session revoked before its token expires is told apart by `checkSignedIn` (limiter.session-revoked.ts).
 * API keys and display links carry no access token, so they stay on their address too.
 */
export function signedInSessionOf(request: NextRequest): SignedIn | null {
  const cookieToken = request.cookies?.get('accessToken')?.value;
  if (cookieToken && !request.cookies?.get('refreshToken')?.value) return null;
  const token = cookieToken ?? /^Bearer\s+(.+)$/i.exec((request.headers.get('authorization') ?? '').trim())?.[1]?.trim();
  if (!token) return null;
  const tenantId = tenantFromRequest(request);
  if (!tenantId) return null;
  try {
    const payload = cookieToken
      ? UserSessionTokenService.verifyAccessToken(token, UserSessionNextHelpers.generateDeviceFingerprint(request), 'web')
      : UserSessionTokenService.verifyAccessToken(token, undefined, 'device');
    const { userId, userSessionId } = payload;
    if (typeof userId !== 'string' || !UUID.test(userId) || typeof userSessionId !== 'string' || !UUID.test(userSessionId)) return null;
    if (typeof payload.tenantId !== 'string' || payload.tenantId.toLowerCase() !== tenantId) return null;
    return { userId: userId.toLowerCase(), sessionId: userSessionId.toLowerCase() };
  } catch {
    return null;
  }
}

/** The user id of `signedInSessionOf`, or null. */
export function signedInUserOf(request: NextRequest): string | null {
  return signedInSessionOf(request)?.userId ?? null;
}

/**
 * Whether this request's lane (docs/phases/38-security 00) participates in IP bans. The lane is the proxy's `x-nb-lane` stamp
 * (`laneOfRequest`, phase 55 00.8); only a request that did not pass the proxy is classified here. On a sign-in endpoint (`endpoint`
 * given: login, register, forgot, otp-send) the lane is `signInLane`'s: a machine or device lane claimed by an unverified header is
 * the strict public lane there, so a forged API-key bearer does not step around the address's ban. Everywhere else a lane claimed by
 * a credential header holds only on a path that verifies that credential (`claimedLanePolicy`, phase 55 00 review): an API key or a
 * fleet envelope on the password reset, a magic-link consume or a public form is the public lane, so it is refused while the address
 * is banned and its misses are the address's.
 */
function requestPath(request: NextRequest): string {
  if (request.nextUrl?.pathname) return request.nextUrl.pathname;
  try { return new URL(request.url).pathname; } catch { return '/'; }
}

function laneTakesIpBans(request: NextRequest, endpoint?: AuthEndpoint): boolean {
  const { lane } = laneOfRequest(request, env.CRON_SECRET);
  const policy = endpoint ? signInLanePolicy(lane) : claimedLanePolicy(lane, laneRelativePath(requestPath(request)));
  return policy.banParticipation === true;
}

/** What a browser says about who sent a request (Fetch Metadata); `cross-site` and `same-site` mean another site's page did. */
const FOREIGN_FETCH_SITES: ReadonlySet<string> = new Set(['cross-site', 'same-site']);

/**
 * D40-10(d): whether a request's misses are its address's (limiter.misbehaviour.ts): only lanes that take part in IP bans (L-4: never a
 * machine, a device, a provider or a cron job), and never a request a browser marks as sent by another site's page. A client that
 * forges that header only keeps the limits it had before 40.1.
 */
function missesCount(request: NextRequest): boolean {
  return laneTakesIpBans(request) && !FOREIGN_FETCH_SITES.has((request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase());
}

/**
 * The refusal of a bucket: 429 with when to come back (`Retry-After`: until the bucket admits again) and the bucket's state in the
 * `RateLimit-*` fields (its per-minute rate, nothing left, seconds until it is full; D40-11), plus the `X-RateLimit-*` pair clients
 * already read. Names no key, no address and no other client.
 */
function tooManyRequests(r: RateLimitCheck): AppError {
  return new AppError('Too many requests. Please try again later.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
    retryable: true,
    headers: {
      'Retry-After': String(Math.max(1, r.retryAfter)),
      'RateLimit-Limit': String(r.limit),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(Math.max(1, r.resetAt - Math.floor(Date.now() / 1000))),
      'X-RateLimit-Limit': String(r.limit),
      'X-RateLimit-Remaining': '0',
    },
  });
}

/**
 * 38-security 2.5: tighter per-minute ceilings for the endpoints that cost more than a login POST (mail and SMS senders) or are the
 * brute-force surface, spent IN ADDITION to the shared `auth` bucket. Constants, with an env override per endpoint
 * (`AUTH_LIMIT_<NAME>`, a positive integer; anything else is ignored).
 */
export const AUTH_ENDPOINT_LIMITS = { login: 10, register: 5, forgot: 5, 'otp-send': 5 } as const;
export type AuthEndpoint = keyof typeof AUTH_ENDPOINT_LIMITS;

export function authEndpointLimit(endpoint: AuthEndpoint): number {
  const raw = Number(process.env[`AUTH_LIMIT_${endpoint.toUpperCase().replace('-', '_')}`]);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : AUTH_ENDPOINT_LIMITS[endpoint];
}

/**
 * The endpoint's budget under the installation's tightening (limiter.settings-policy.ts): the login budget is the lower of
 * `authEndpointLimit('login')` and the ROOT setting `limiterLoginPerMinute`; the other endpoints are unchanged.
 */
export function effectiveEndpointLimit(endpoint: AuthEndpoint, policy: LimiterPolicy = DEFAULT_LIMITER_POLICY): number {
  const base = authEndpointLimit(endpoint);
  return endpoint === 'login' ? capped(base, policy.loginPerMinute) : base;
}

/**
 * The options of a per-address `auth` or anonymous `api` check under the installation's tightening: undefined (the scope's own
 * `LIMITS` rate, as before) unless the ROOT setting lowers it.
 */
function scopeLimit(scope: 'auth' | 'api', policy: LimiterPolicy): { limit: number } | undefined {
  const limit = capped(LIMITS[scope], scope === 'auth' ? policy.authPerMinute : policy.apiPerMinute);
  return limit < LIMITS[scope] ? { limit } : undefined;
}

/** limiter.04: the shared budget of every request without a client address, per scope and minute. */
export const UNKNOWN_CLIENT_LIMITS: Record<LimiterScope, number> = { auth: 5, api: 30, i18n: 30, csp: 30 };

/**
 * Scopes the tenant plan's `api_rate_limit` does not apply to: the IP limit alone
 * governs them. `i18n` serves public UI texts before anyone signs in; counting them
 * against what the tenant bought would let the login screen's translations spend the
 * allowance its real API calls need. `csp` is the browser's own violation reports (D40-14).
 */
const PLAN_EXEMPT_SCOPES: ReadonlySet<LimiterScope> = new Set<LimiterScope>(['i18n', 'csp']);

/**
 * Phase 55 04.8: what the firewall's request cascade decided, applied to this request. `block`: 403 with the support reference only (no
 * reason, no score: what tripped is not the caller's to learn); `step_up`: the session step-up refusal auth already speaks, so the browser
 * shows its step-up banner and dialog (user_session.step-up-flag.ts); `delay`: the answer waits a moment (an anonymous caller's
 * progressive delay, bounded by GATE_DELAY_MAX_MS in the seam); `allow`: nothing.
 */
export async function enforceGateAnswer(answer: GateAnswer, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  switch (answer.action) {
    case 'block':
      throw new AppError('This request was refused. If you think this is a mistake, contact support with the reference.', 403, ErrorCode.FORBIDDEN, {
        details: { reference: answer.reference },
      });
    case 'step_up':
      throw sessionStepUpRequired();
    case 'delay':
      if (answer.delayMs > 0) await sleep(answer.delayMs);
      return;
    default:
      return;
  }
}

export default class Limiter {
  /**
   * The client address (E-06): X-Forwarded-For read through `TRUSTED_PROXY_HOPS` trusted proxies, like the tenant IP
   * lists (tenant_session.client-ip.ts). The first hop and X-Real-IP were client-chosen, so rotating them reset every
   * per-client bucket. `'unknown'` when there is no usable address.
   */
  static getIpFromRequest(request: NextRequest): string {
    const hops = env.TRUSTED_PROXY_HOPS ?? DEFAULT_TRUSTED_PROXY_HOPS;
    return clientIpFromForwardedFor(request.headers.get('x-forwarded-for'), hops) ?? 'unknown';
  }

  static async check(ip: string, scope: LimiterScope = 'api') {
    return check(ip, scope);
  }

  /**
   * Enforce the rate limit for a request. On success, returns silently; when the
   * limit is exceeded, THROWS `AppError(429, RATE_LIMIT_EXCEEDED)` carrying the
   * `Retry-After` / `RateLimit-*` / `X-RateLimit-*` headers so the route's outer boundary
   * (`normalizeError`) renders them. Call it as `await Limiter.checkRateLimit(request)`
   * — no return-value handling needed.
   */
  static async checkRateLimit(request: NextRequest, scope: LimiterScope = 'api', endpoint?: AuthEndpoint): Promise<void> {
    const ip = this.getIpFromRequest(request);
    // limiter.04 (decided 2026-10-20, safer option): a request without a usable client address has no identity a client could
    // not rotate, so every such request shares ONE strict bucket (a fraction of the normal budget) that fails closed on a
    // Redis error. It is never exempt; behind the trusted proxy every request carries an address and never lands here.
    const unknown = ip === 'unknown';

    // 38-security 2.1: an address banned for crossing the cross-account strike threshold is refused before any limiter or bcrypt
    // work, on the auth scope and only for lanes that take part in IP bans (L-4: never machine or device lanes).
    if (scope === 'auth' && !unknown && laneTakesIpBans(request, endpoint)) {
      if (await isGloballyBlocked(ip)) {
        this.noteRefusal(request, scope, 'blocklist', ip);
        throw new AppError('Access from this address is not allowed.', 403, ErrorCode.FORBIDDEN);
      }
      const wait = await IpStrikeService.retryAfter(ip);
      if (wait > 0) {
        this.noteRefusal(request, scope, 'ban', ip);
        throw new AppError('Too many failed attempts from this address. Please try again later.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
          retryable: true,
          headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': String(wait) },
        });
      }
    }
    // The ROOT tightening (cached in process; the built-in values when unset or unreadable). Not read when nothing is counted.
    const policy = unknown || env.RATE_LIMIT_DISABLED ? DEFAULT_LIMITER_POLICY : await getLimiterPolicy();
    const result = unknown
      ? await check('unknown', scope, { limit: UNKNOWN_CLIENT_LIMITS[scope], failMode: 'closed' })
      : await this.checkAddress(request, rateLimitBucketOf(ip), scope, policy);
    if (!result.success) {
      // D40-10(d): a refusal by the address's own `api` limits (its anonymous bucket, its ceiling) is one of its misses; one by a
      // person's own bucket is not (that bucket can be spent from anywhere with the person's token). Nobody waits for the count.
      if (scope === 'api' && !unknown && result.refusedBy !== 'user' && missesCount(request)) void recordMiss(rateLimitBucketOf(ip));
      this.noteRefusal(request, scope, unknown ? 'unknown_client' : result.refusedBy === 'user' ? 'user' : 'address', ip);
      throw tooManyRequests(result);
    }

    if (endpoint && scope === 'auth' && !unknown) {
      const own = await check(`${endpoint}:${rateLimitBucketOf(ip)}`, 'auth', { limit: effectiveEndpointLimit(endpoint, policy) });
      if (!own.success) {
        this.noteRefusal(request, scope, 'endpoint', ip, endpoint);
        throw tooManyRequests(own);
      }
    }

    if (PLAN_EXEMPT_SCOPES.has(scope)) return;
    await this.checkTenantPlanLimit(request);
    await this.applyRequestGate(request, scope, endpoint);
  }

  /**
   * Phase 55 04.8: the AI firewall's request cascade (common/server/request-gate.ts), asked only about a request every control above let
   * through, so it can add a refusal and never lift one (FWA-2). Synchronous on its side (no Redis call, D55-21); without a registered
   * gate, or for the `i18n` and `csp` scopes, nothing happens. The lane is the one whose human controls apply here (a sign-in endpoint's
   * `signInLane`, elsewhere the claim weighed against the path), so a forged machine header buys no exemption.
   */
  private static async applyRequestGate(request: NextRequest, scope: LimiterScope, endpoint?: AuthEndpoint): Promise<void> {
    if ((scope !== 'api' && scope !== 'auth') || !hasRequestGate()) return;
    const { lane } = laneOfRequest(request, env.CRON_SECRET);
    const answer = gateRequest({
      request,
      scope,
      tenantId: tenantFromRequest(request),
      lane: endpoint ? signInLane(lane) : claimedLaneOn(lane, laneRelativePath(requestPath(request))),
      signedIn: signedInSessionOf(request),
    });
    await enforceGateAnswer(answer);
  }

  /**
   * The bucket a request from a known address spends (D40-10). In the `api` scope a signed-in request spends its user's bucket and
   * its address's ceiling, which a misbehaving address has divided (D40-10(d)); an anonymous one the address's own bucket, 120 a
   * minute whatever the address did (D40-10(e)). The other scopes are per address, as they were: `auth` (with the strikes and bans
   * above), `i18n`, `csp`. The installation may lower the `auth` and the anonymous `api` rate (`policy`, ROOT settings); a person's
   * own bucket and the address ceiling keep their built-in values.
   */
  private static async checkAddress(request: NextRequest, address: string, scope: LimiterScope, policy: LimiterPolicy): Promise<RateLimitCheck> {
    if (scope === 'auth') return check(address, 'auth', scopeLimit('auth', policy));
    if (scope !== 'api') return check(address, scope);
    const person = env.RATE_LIMIT_DISABLED ? null : signedInSessionOf(request);
    return person ? checkSignedIn(person, address) : check(address, 'api', scopeLimit('api', policy));
  }

  /**
   * D40-10(d): one answer of the tenant API dispatcher, counted against its client address when it is a miss (401, 403, 404;
   * limiter.misbehaviour.ts) of a request whose misses are its address's (`missesCount`). Never the CSP report route (D40-14: a browser
   * posts a report per blocked inline tag, whatever the route answers), never a request without an address. A 429 is counted where the
   * address's own limits refuse (`checkRateLimit`), not here: the plan's allowance and a person's bucket are not the address's. Nor a
   * 401 / 403 the AI firewall's request gate produced (a block, a step-up; phase 55 D55-129): a model's verdict is not the address's
   * misbehaviour, and counting it would divide the ceiling of everyone behind the address, the challenged person first.
   */
  static async noteAnswer(request: NextRequest, apiPath: string, status: number): Promise<void> {
    // Phase 55 02.5: a trap route (limiter.trap-routes.ts) is a missing route, answered with the dispatcher's own 404; that answer on a
    // trap path is a critical signal, whatever the lane (a machine that probes an old admin endpoint is no rightful integration either).
    // A 403 on one too (D55-72): the dispatcher's CSRF gate answers a signed-in browser's write without a CSRF token before it looks the
    // route up, so the insider's POST or DELETE to a trap path never reaches the 404. Nothing else answers a path no module declares.
    if (status === 404 || status === 403) this.noteTrap(request, apiPath);
    if (!MISS_STATUSES.has(status) || apiPath === CSP_REPORT_API_PATH || gateRefused(request) || !missesCount(request)) return;
    const ip = this.getIpFromRequest(request);
    if (ip === 'unknown') return;
    await recordMiss(rateLimitBucketOf(ip));
  }

  /**
   * Phase 55 02.6: a refusal of this limiter, tallied for the AI firewall (`limiter.rate_limited`, limiter.firewall-emitters.ts): counted in
   * process and sent as one signal per tenant, lane, actor and control every few seconds, never one per refused request. Synchronous; never
   * throws, never changes the answer. The actor is the person only when their own bucket refused (their token, read by signature again
   * on that refusal alone), else the address's bucket.
   */
  private static noteRefusal(request: NextRequest, scope: LimiterScope, by: RefusingControl, ip: string, endpoint?: AuthEndpoint): void {
    try {
      const known = ip !== 'unknown';
      noteRateLimited({
        tenantId: tenantFromRequest(request),
        lane: laneOfRequest(request, env.CRON_SECRET).lane,
        scope,
        by,
        endpoint: endpoint ?? null,
        address: known ? rateLimitBucketOf(ip) : null,
        userId: by === 'user' ? signedInUserOf(request) : null,
      });
    } catch {
      // a firewall note never changes the answer
    }
  }

  /** A 404 (or the CSRF gate's 403) on a trap path: one bounded critical signal (synchronous; never throws, never changes the answer). */
  private static noteTrap(request: NextRequest, apiPath: string): void {
    try {
      const trap = trapOf(apiPath);
      if (!trap) return;
      const ip = this.getIpFromRequest(request);
      noteTrapTouch({
        trap,
        tenantId: tenantFromRequest(request),
        userId: signedInUserOf(request),
        ip: ip === 'unknown' ? null : ip,
        lane: laneOfRequest(request, env.CRON_SECRET).lane,
        method: request.method ?? null,
      });
    } catch {
      // a trap check never changes the answer
    }
  }

  /** Hands `noteAnswer` to the tenant API dispatcher (common/server/route-answers.ts). Called once, at boot (instrumentation.ts). */
  static watchAnswers(): void {
    setAnswerWatcher((request, apiPath, status) => Limiter.noteAnswer(request, apiPath, status));
  }

  /**
   * The TENANT's plan allowance, applied alongside the per-IP limit above.
   *
   * Two limits answering two questions, and neither replaces the other: the IP
   * limit stops one abusive client, the plan limit is what the tenant bought.
   * A tenant on a 1000/min plan should not be able to spend it from a thousand
   * addresses, and a single noisy script should not be able to consume a whole
   * organisation's allowance.
   *
   * Silent when no tenant is in the path (a platform-internal route), when no
   * plan declares the feature, or when the gate cannot be read — see
   * `resolveTenantApiLimit`, which fails open for all of them.
   */
  private static async checkTenantPlanLimit(request: NextRequest): Promise<void> {
    const tenantId = tenantFromRequest(request);
    if (!tenantId) return;
    // D4: the plan allowance is what the tenant's own callers spend. A request that carries no credential at all (no session
    // cookie, no Authorization, no API key) is anonymous traffic; it meets the per-address limit above but never spends the
    // tenant's allowance, so an anonymous flood from many addresses cannot lock the tenant's signed-in users out.
    if (!carriesCredential(request)) return;

    const limitPerMinute = await resolveTenantApiLimit(tenantId);
    if (limitPerMinute === null) return;

    const result = await checkTenantPlanRateLimit(tenantId, limitPerMinute);
    if (result.success) return;
    this.noteRefusal(request, 'api', 'plan', this.getIpFromRequest(request));

    // A DIFFERENT message from the IP limit on purpose: "you are going too fast"
    // and "your plan's allowance is spent" lead to different actions, and an
    // operator who cannot tell them apart will retry into the same wall.
    throw new AppError(
      'Your plan\'s API rate limit has been reached. Please try again shortly or upgrade your plan.',
      429,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      {
        retryable: true,
        headers: {
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'Retry-After': String(result.retryAfter || RATE_LIMIT_WINDOW),
          // D40-11: the RateLimit fields of every rate 429, as the buckets' (tooManyRequests). Reset is the window: each admitted
          // request leaves the plan's sliding window within a minute, so by then the whole allowance is back.
          'RateLimit-Limit': String(result.limit),
          'RateLimit-Remaining': String(result.remaining),
          'RateLimit-Reset': String(RATE_LIMIT_WINDOW),
        },
      },
    );
  }

  /** @deprecated Alias for {@link checkRateLimit}; throws on limit exceeded. */
  static async useRateLimit(request: NextRequest, scope: LimiterScope = 'api'): Promise<void> {
    return this.checkRateLimit(request, scope);
  }
}
