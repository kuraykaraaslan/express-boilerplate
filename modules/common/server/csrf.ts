import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import { AppError, ErrorCode } from './app-error';
import { reportRefusal } from './refusal-sink';

/**
 * Signed double-submit CSRF, verified centrally.
 *
 * The token is `${timestamp}-${randomHex}.${hmacHex}` where the HMAC is over the
 * `${timestamp}-${randomHex}` half with the server secret — so a token proves the
 * server minted it (attacker cannot forge one) AND is echoed in both a readable
 * cookie and a request header (attacker cannot read the cookie cross-site to
 * replay it in the header). Both properties are required to pass.
 *
 * `auth-csrf.route.ts` mints the token with `generateCsrfToken`; the tenant API
 * dispatcher calls `assertCsrf` for every state-changing request. This is the
 * single source of truth for the format so the two can never drift.
 *
 * common.15: the token is BOUND to the session. The HMAC also covers the session the request carries
 * (`csrfBinding`: the `userSessionId` claim of the access or refresh cookie), so a token minted for one session, or for
 * no session, is refused next to another session's cookies. Without it anybody could mint a valid token (the mint
 * route is public) and an attacker able to plant a cookie beside the victim's session (a sibling subdomain, cookie
 * tossing) passed the gate with his own token. The client re-mints after login, refresh and a tenant switch, and
 * retries once with a fresh token on a CSRF refusal (axios.client.ts, csrf.client.ts); the dispatcher also sets a token for
 * the new session on the answer that changed it (`followSessionWithCsrfCookie`, 40.10.2).
 */

export const CSRF_COOKIE_NAME = 'csrf-token';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_TOKEN_EXPIRY_SECONDS = 60 * 60; // 1 hour (matches the cookie maxAge)
// Accept a token up to this old on the server. The cookie itself expires at 1h so
// a legit client always sends a fresh one; the wider server window only absorbs
// clock skew and avoids spurious 403s, while still bounding replay of a leaked token.
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  // Both are required by the env schema (min(1)); CSRF_SECRET is the primary.
  return env.CSRF_SECRET || env.ACCESS_TOKEN_SECRET;
}

function hmacHex(data: string, binding = ''): string {
  // An unbound token (no session) signs the data alone, as before; a bound one signs `data|binding`.
  return crypto.createHmac('sha256', secret()).update(binding ? `${data}|${binding}` : data).digest('hex');
}

/** The `userSessionId` claim of a JWT, read WITHOUT verifying it (the session reader verifies; this only names the session). */
function sessionIdOf(jwt: string | undefined): string | null {
  if (!jwt) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { userSessionId?: unknown };
    return typeof claims?.userSessionId === 'string' && claims.userSessionId ? claims.userSessionId : null;
  } catch {
    return null;
  }
}

/**
 * common.15: the session a CSRF token is bound to, from the session cookies: `sid:<userSessionId>` of the access cookie,
 * else of the refresh cookie (both carry the same id, and it survives a refresh); a cookie that is not a readable token
 * binds to its own hash, so it never matches a token minted for no session; `''` when there is no session cookie at all.
 */
export function csrfBinding(cookies: { accessToken?: string | null; refreshToken?: string | null }): string {
  const access = cookies.accessToken || undefined;
  const refresh = cookies.refreshToken || undefined;
  const sid = sessionIdOf(access) ?? sessionIdOf(refresh);
  if (sid) return `sid:${sid}`;
  const raw = access ?? refresh;
  return raw ? `raw:${crypto.createHash('sha256').update(raw).digest('hex')}` : '';
}

/** The binding of a request's own session cookies (see `csrfBinding`). */
export function requestCsrfBinding(request: Pick<NextRequest, 'cookies'>): string {
  return csrfBinding({
    accessToken: request.cookies.get('accessToken')?.value,
    refreshToken: request.cookies.get('refreshToken')?.value,
  });
}

/** Mint a fresh signed CSRF token, bound to `binding` (`requestCsrfBinding` of the minting request; `''` = no session). */
export function generateCsrfToken(binding = ''): string {
  const data = `${Date.now()}-${crypto.randomBytes(32).toString('hex')}`;
  return `${data}.${hmacHex(data, binding)}`;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** True if `token` carries a valid, unexpired server signature for `binding` (the session it must belong to; `''` = none). */
export function verifyCsrfToken(token: string | null | undefined, binding = ''): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmacHex(data, binding);
  if (!timingSafeEqualStr(sig, expected)) return false;
  const ts = Number(data.slice(0, data.indexOf('-')));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= MAX_TOKEN_AGE_MS;
}

/**
 * Endpoints that are same-origin, authenticated (the browser attaches the session
 * cookie) but STRUCTURALLY cannot carry a request header — i.e. `navigator.sendBeacon`
 * telemetry and the browser's own CSP violation reports (no header can be set on those). They are exempt from CSRF because there is no header channel to use;
 * they must be side-effect-light by design. Keep this list tiny and audited.
 */
export function isCsrfExemptPath(apiPath: string): boolean {
  return apiPath === '/api/seo/web-vitals' || apiPath === '/api/seo/csp-report';
}

/**
 * Enforce CSRF for a state-changing (non-safe method) tenant API request.
 *
 * Scope: only requests that carry ambient cookie authority need protection.
 *  - No `accessToken` or `refreshToken` cookie means no authenticated session to abuse (webhooks,
 *    SSO/SAML callbacks, public form posts, unauthenticated storefront, and
 *    bearer / API-key callers such as SCIM and device apps, which send no cookie) — exempt.
 *  - An `Authorization` header does NOT exempt a request that also carries the
 *    session cookie (S13): the session reader authenticates by the cookie first,
 *    so a cross-site request could add any junk header and ride the victim's cookie.
 *  - A structurally-headerless telemetry beacon — exempt (see isCsrfExemptPath).
 *
 * Everything else must present a valid signed double-submit token, or gets 403.
 */
/**
 * 38-security 4.3: the host the browser addressed, read the way the proxy reads it (`Host`; the LAST `x-forwarded-host` element only when
 * the deployment declares TRUST_X_FORWARDED_HOST=true), lower-cased, port kept.
 */
function requestHost(request: NextRequest): string {
  const forwarded = process.env.TRUST_X_FORWARDED_HOST === 'true'
    ? (request.headers.get('x-forwarded-host') || '').split(',').map((h) => h.trim()).filter(Boolean).pop()
    : undefined;
  return (forwarded || request.headers.get('host') || '').trim().toLowerCase();
}

/**
 * A browser states where a state-changing request came from in `Origin`. A cookie-session request whose `Origin` is PRESENT and is not the
 * host it was sent to is cross-site (or cross-subdomain: cookie tossing), whatever token it carries. An absent Origin passes (non-browser
 * clients, some same-origin GETs), and `null` (sandboxed frames, redirects across origins) is refused like any other foreign origin.
 */
export function isForeignOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return true;
  }
  const own = requestHost(request);
  return !own || host !== own;
}

/** Why a cookie-session request was refused (phase 55 00 §0.3: the audit row's `metadata.reason`). */
export type CsrfRefusalReason = 'foreign_origin' | 'token_missing' | 'token_mismatch' | 'token_invalid';

/**
 * Who the CSRF refusal is reported for. `tenantId`: a tenant the caller has resolved from something stored (a hook's record), the audit row's
 * tenant. `addressedTenantId`: the tenant segment of the URL, which at the CSRF gate nobody has checked yet (the dispatcher runs the gate before
 * routing, and on the platform host any UUID passes the proxy): it is recorded in the row's metadata, never its tenant or part of its bucket, so
 * a client that rotates the segment opens no new bucket per request and writes nothing into a tenant's log, real or not (phase 55 00 review).
 * Neither = ROOT.
 */
export interface CsrfAuditContext { tenantId?: string | null; addressedTenantId?: string | null }

/**
 * Phase 55 00 §0.3 (P-3): a refusal used to answer 403 and leave nothing behind. It is now reported (`security.csrf_refused`), counted per client
 * address bucket (an IPv6 /64, the limiter's unit) and minute (`refusal-sink.ts`; the sink reads the address through the trusted hops), with the
 * reason and the API path. Never the token.
 */
function refuse(request: NextRequest, apiPath: string, reason: CsrfRefusalReason, message: string, ctx?: CsrfAuditContext): never {
  const addressed = typeof ctx?.addressedTenantId === 'string' ? ctx.addressedTenantId.slice(0, 64) : null;
  void reportRefusal({
    action: 'security.csrf_refused',
    tenantId: ctx?.tenantId ?? null,
    headers: request.headers,
    resourceType: 'api_path',
    resourceId: apiPath.slice(0, 200),
    metadata: {
      reason, method: request.method,
      ...(reason === 'foreign_origin' ? { origin: (request.headers.get('origin') ?? '').slice(0, 200) } : {}),
      ...(addressed ? { addressedTenantId: addressed } : {}),
    },
    sample: apiPath,
  });
  throw new AppError(message, 403, ErrorCode.FORBIDDEN);
}

export function assertCsrf(request: NextRequest, apiPath: string, ctx?: CsrfAuditContext): void {
  // common.31: the refresh route authenticates with the refreshToken cookie alone (the access cookie has usually expired by
  // then), so a request carrying either session cookie has ambient authority to protect.
  if (!request.cookies.get('accessToken')?.value && !request.cookies.get('refreshToken')?.value) return;
  if (isCsrfExemptPath(apiPath)) return;

  // 38-security 4.3: independent of the token, so a leaked or minted-for-the-attacker token alone is not enough.
  if (isForeignOrigin(request)) {
    refuse(request, apiPath, 'foreign_origin', 'Cross-origin request refused.', ctx);
  }

  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!headerToken || !cookieToken) {
    refuse(request, apiPath, 'token_missing', 'Missing CSRF token.', ctx);
  }
  if (!timingSafeEqualStr(headerToken, cookieToken)) {
    refuse(request, apiPath, 'token_mismatch', 'CSRF token mismatch.', ctx);
  }
  // common.15: the token must have been minted for THIS session.
  if (!verifyCsrfToken(headerToken, requestCsrfBinding(request))) {
    refuse(request, apiPath, 'token_invalid', 'Invalid or expired CSRF token.', ctx);
  }
}

const SESSION_COOKIES = ['accessToken', 'refreshToken'] as const;

/** What a `Set-Cookie` line does to `name`: undefined = not touched, null = cleared, else the new value. */
function setCookieValue(lines: string[], name: string): string | null | undefined {
  let out: string | null | undefined;
  for (const line of lines) {
    const [pair, ...attrs] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq).trim() !== name) continue;
    let value = pair.slice(eq + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* kept as sent */ }
    const expired = attrs.some((a) => {
      const [k, v = ''] = a.split('=').map((s) => s.trim());
      if (k.toLowerCase() === 'max-age') return Number(v) <= 0;
      if (k.toLowerCase() === 'expires') return Date.parse(v) <= Date.now();
      return false;
    });
    out = value && !expired ? value : null;
  }
  return out;
}

/**
 * docs/phases/07-dashboard/40 40.10.2: the csrf-token cookie follows the session. A response that sets or clears a session
 * cookie so that the browser holds ANOTHER session than the request did (a sign-in, a handoff, an impersonation, a sign-out)
 * also sets a token minted for the session it leaves behind, the same cookie `auth-csrf.route.ts` sets. Without it the
 * page the sign-in navigates to (a full page load, which forgets the client's "mint again after a sign-in") sent the
 * token minted for the sign-in form, unbound, and its first writes were refused "Invalid or expired CSRF token".
 *
 * Nothing is relaxed: the token is bound like any other (`csrfBinding` of the new cookies) and only the answer to the
 * request that changed the session carries it, as a readable SameSite=Strict cookie a cross-site page cannot read. A
 * response that keeps the session (a refresh keeps its session id) leaves the cookie alone, so writes in flight keep
 * the token they read. A response whose headers cannot be changed is returned as it is (the client re-mints on a refusal).
 */
export function followSessionWithCsrfCookie(request: Pick<NextRequest, 'cookies'>, response: Response): Response {
  const lines = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (!lines.length) return response;
  const next: Partial<Record<(typeof SESSION_COOKIES)[number], string | null>> = {};
  let touched = false;
  for (const name of SESSION_COOKIES) {
    const value = setCookieValue(lines, name);
    if (value === undefined) next[name] = request.cookies.get(name)?.value ?? null;
    else { next[name] = value; touched = true; }
  }
  if (!touched || lines.some((l) => l.trim().startsWith(`${CSRF_COOKIE_NAME}=`))) return response;
  const binding = csrfBinding({ accessToken: next.accessToken, refreshToken: next.refreshToken });
  if (binding === requestCsrfBinding(request)) return response;
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  try {
    response.headers.append(
      'set-cookie',
      `${CSRF_COOKIE_NAME}=${generateCsrfToken(binding)}; Path=/; Max-Age=${CSRF_TOKEN_EXPIRY_SECONDS}; SameSite=Strict${secure}`,
    );
  } catch {
    /* immutable headers (Response.redirect): the client's retry mints one */
  }
  return response;
}
