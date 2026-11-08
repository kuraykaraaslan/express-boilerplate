/**
 * Request lane classifier (docs/phases/38-security/00-request-lanes.md, decisions L-1, L-2).
 *
 * `resolveLane` is a pure function of the request's headers, cookie presence and path: first match wins, and that order IS
 * decision L-1 (a request carrying both a session cookie and an `Authorization` header is classified by the header; the
 * cookie is not part of the classification at all). Decision L-2: anything that does not classify cleanly (a malformed
 * `Authorization`) is `public-anon` with `strict: true`, the most limited lane, never a machine lane.
 *
 * Classification only names the caller class. It verifies nothing: the handler still authenticates (JWT, API key hash,
 * signature over raw bytes, cron secret) and a forged claim at best buys the lane's own limited switches.
 */
import crypto from 'node:crypto';
import { LANES, LANE_POLICY, type Lane, type LanePolicy } from './lane.policy';
import { DECLARED_PROVIDER_WEBHOOK_PATHS } from './generated/lane.routes.generated';

/**
 * The header the classifier result is forwarded in, inside one process (the `x-nonce` pattern). The proxy writes it on every request
 * it forwards (`proxy/csp.ts` `forward()`) and drops an inbound copy on every other branch, and the Caddy hardening snippet strips it
 * at the edge; `laneOfRequest` reads it.
 */
export const LANE_HEADER = 'x-nb-lane';

/** Fleet agent credential headers: the client certificate Caddy verified (set only by the trusted edge, stripped everywhere else) and the signed agent envelope. */
export const FLEET_PEER_CERT_HEADER = 'x-fleet-client-cert-der';
export const FLEET_ENVELOPE_HEADER = 'x-fleet-envelope';

/** An `Authorization` that carries an API key (`Bearer sk_live_…` / `sk_test_…`): the machine-apikey lane, and the key lane of auth_abac's tenant guard. */
export const API_KEY_BEARER = /^Bearer\s+sk_(?:live|test)_\S+$/i;
/** An `Authorization` that carries an MCP OAuth access token (`Bearer mcp_at_…`, docs/phases/57-mcp-server): the machine-mcp lane, and the
 * MCP grant lane of auth_abac's tenant guard (only on the routes that opt in). */
export const MCP_GRANT_BEARER = /^Bearer\s+mcp_at_[A-Za-z0-9_-]{20,200}$/;
const GENERIC_BEARER = /^Bearer\s+\S+$/i;
export const CRON_PATH = /^\/(?:api\/cron|internal)(?:\/|$)/;

/**
 * Provider webhook / callback paths (signature verified in the handler, raw bytes). Anchored, tenant prefix already stripped.
 * A module declares its own on the route (`"lane": "provider-webhook"` on an `apiRoutes` entry, scripts/registry/lane-routes.mjs,
 * docs/phases/40-addon-seams/04); they arrive here as DECLARED_PROVIDER_WEBHOOK_PATHS. This list keeps only the paths no module
 * route declares; the CI ratchet (0.4) reports a route that looks like one and is neither.
 */
export const PROVIDER_WEBHOOK_PATHS: readonly RegExp[] = [
  // No module mounts this path today (payment's PaymentWebhookService has no route); kept so a route added without the
  // declaration still lands in the provider lane.
  /^\/api\/payment\/webhook(?:\/[^/]+)?$/,
];

/** Every provider callback path: the modules' declarations and the list above. */
export const ALL_PROVIDER_WEBHOOK_PATHS: readonly RegExp[] = [...PROVIDER_WEBHOOK_PATHS, ...DECLARED_PROVIDER_WEBHOOK_PATHS];

export type LaneInput = {
  /** Tenant-relative API/page path, e.g. `/api/auth/login` (no `/t/{tenantId}` prefix). */
  path: string;
  /** Request headers (any object with `get`, so NextRequest/Request/Headers all fit). */
  headers: { get(name: string): string | null };
  /** True when a session cookie (`accessToken` or `refreshToken`) is present. */
  hasSessionCookie: boolean;
  /** The configured `CRON_SECRET`; omitted/empty means no request can classify as `internal-cron`. */
  cronSecret?: string | null;
};

export type LaneResult = { lane: Lane; strict: boolean; policy: LanePolicy };

const LANE_SET: ReadonlySet<string> = new Set(LANES);

/** Whether a string names a lane of the table. */
export function isLane(value: unknown): value is Lane {
  return typeof value === 'string' && LANE_SET.has(value);
}

function result(lane: Lane, strict = false): LaneResult {
  return { lane, strict, policy: LANE_POLICY[lane] };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** The `aud` claim of a JWT, read WITHOUT verifying it (classification only; the verifier enforces the audience). */
function unverifiedAudience(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const aud = (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { aud?: unknown })?.aud;
    const first = Array.isArray(aud) ? aud[0] : aud;
    return typeof first === 'string' ? first : null;
  } catch {
    return null;
  }
}

export function resolveLane(input: LaneInput): LaneResult {
  const { path, headers, hasSessionCookie } = input;
  const authorization = (headers.get('authorization') ?? '').trim();

  // 1. API key.
  if (API_KEY_BEARER.test(authorization)) return result('machine-apikey');

  // 1b. MCP OAuth access token (an opaque token of mcp_server's authorization server, not a JWT).
  if (MCP_GRANT_BEARER.test(authorization)) return result('machine-mcp');

  // 2. Fleet agent credential.
  if (headers.get(FLEET_PEER_CERT_HEADER) || headers.get(FLEET_ENVELOPE_HEADER)) return result('machine-agent');

  // 3. Cron secret on a cron / internal path. A wrong secret on those paths falls through to the strict public lane below.
  if (authorization && CRON_PATH.test(path)) {
    const secret = input.cronSecret;
    if (secret && GENERIC_BEARER.test(authorization) && timingSafeEqualStr(authorization, `Bearer ${secret}`)) {
      return result('internal-cron');
    }
    return result('public-anon', true);
  }

  // 4. Any other Authorization header: by the (unverified) JWT audience; anything else is not classifiable (L-2).
  if (authorization) {
    if (!GENERIC_BEARER.test(authorization)) return result('public-anon', true);
    const token = authorization.replace(/^Bearer\s+/i, '');
    const aud = unverifiedAudience(token);
    if (aud === 'device') return result('human-native');
    if (aud === 'web') return result('machine-apikey', true);
    return result('public-anon', true);
  }

  // 5. Provider webhooks.
  if (ALL_PROVIDER_WEBHOOK_PATHS.some((re) => re.test(path))) return result('provider-webhook');

  // 6. Session cookie.
  if (hasSessionCookie) return result('human-web');

  // 7. Nothing.
  return result('public-anon');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The tenant-relative path the classifier matches, from a request path in any of the shapes it arrives in or is rewritten to:
 * `/api/tenant/{id}/rest` (the explicit API form) is `/api/rest`; `/tenant/{id}/rest` (the rewrite target) and `/{prefix}/{id}/rest`
 * (path tenancy, `TENANT_PATH_PREFIX`, `t` by default) are `/rest`. Anything else is already tenant-relative (domain tenancy).
 */
export function laneRelativePath(pathname: string, tenantPathPrefix = 't'): string {
  const api = /^\/api\/tenant\/[^/]+(\/.*)?$/.exec(pathname);
  if (api) return `/api${api[1] ?? ''}`;
  const prefixes = [...new Set(['t', 'tenant', tenantPathPrefix].filter(Boolean))].map(escapeRe).join('|');
  return pathname.replace(new RegExp(`^\\/(?:${prefixes})\\/[^/]+`), '') || '/';
}

/** A request as the lane readers see it (a NextRequest fits). */
export type LaneRequest = {
  headers: { get(name: string): string | null };
  cookies?: { get(name: string): { value?: string } | undefined };
  nextUrl?: { pathname: string };
  url?: string;
};

/** Whether the request presents a session cookie (`accessToken` or `refreshToken`), the input of step 6 of `resolveLane`. */
export function hasSessionCookieOf(request: Pick<LaneRequest, 'cookies'>): boolean {
  return !!(request.cookies?.get('accessToken')?.value || request.cookies?.get('refreshToken')?.value);
}

function pathnameOf(request: LaneRequest): string {
  if (request.nextUrl?.pathname) return request.nextUrl.pathname;
  try {
    return request.url ? new URL(request.url).pathname : '/';
  } catch {
    return '/';
  }
}

/**
 * The lane of a request inside the app (phase 55 00.8, P-8): the `x-nb-lane` stamp the proxy wrote, so the request is classified ONCE,
 * where the original path, the tenant prefix and the cookies are seen together. The stamp is trusted because the proxy overwrites an
 * inbound copy on every branch that reaches a handler (`forward()`) and drops it on the static short circuit; the one path its matcher
 * leaves out (the plugin broker) reads no lane. A request without a valid stamp (a caller that did not pass the proxy: a test, an
 * in-process call) is classified here from its own path, headers and cookies, exactly as the proxy would. A stamp carries no `strict`
 * flag (nothing reads it after classification), so a stamped result is never strict.
 *
 * `cronSecret` only decides the cron / internal paths of the fallback; a caller that never serves those may omit it.
 */
export function laneOfRequest(request: LaneRequest, cronSecret?: string | null, tenantPathPrefix?: string): LaneResult {
  const stamp = request.headers.get(LANE_HEADER)?.trim();
  if (isLane(stamp)) return result(stamp);
  return resolveLane({
    path: laneRelativePath(pathnameOf(request), tenantPathPrefix),
    headers: request.headers,
    hasSessionCookie: hasSessionCookieOf(request),
    cronSecret,
  });
}

/**
 * The lanes a sign-in endpoint (password login, sign-up, password reset, OTP send) takes at face value: the two a request reaches
 * WITHOUT presenting a credential header. Every other lane is claimed by a header the sign-in endpoint never verifies (an API key, a
 * fleet envelope, a device bearer: the endpoint authenticates the person itself) or is a machine path that has no business there.
 */
const SIGN_IN_LANES: ReadonlySet<Lane> = new Set<Lane>(['human-web', 'public-anon']);

/**
 * The lane whose human controls a sign-in endpoint applies: the request's own lane when it is one of `SIGN_IN_LANES`, else the strict
 * public lane (L-2: a claim the endpoint cannot verify takes the strictest semantics). L-4 keeps CAPTCHA and IP bans off machine and
 * device lanes; without this, one forged `Authorization: Bearer sk_live_x` on a login would buy exactly that exemption.
 */
export function signInLane(lane: Lane | null | undefined): Lane {
  return lane && SIGN_IN_LANES.has(lane) ? lane : 'public-anon';
}

/** `LANE_POLICY` of `signInLane(lane)`: the columns (captcha, banParticipation) a sign-in endpoint reads. */
export function signInLanePolicy(lane: Lane | null | undefined): LanePolicy {
  return LANE_POLICY[signInLane(lane)];
}

/**
 * The paths whose handlers verify a fleet agent's credential: the node-signed envelope (`/api/fleet/agent/*`, fleet, fleet_release,
 * fleet_directory) and the peer certificate the edge verified (`/api/fleet/peer/*`, fleet_agent). Tenant prefix already stripped.
 */
export const FLEET_AGENT_CREDENTIAL_PATH = /^\/api\/fleet\/(?:agent|peer)(?:\/|$)/;

/**
 * The API surfaces that never accept an API key: sign-in, account and the person's own endpoints (`/api/auth/*`) and the anonymous
 * public APIs (`/api/public/*`). auth_abac's key lane runs on the TENANT path only; its GUEST and ACCOUNT paths swallow or refuse a
 * key (auth_abac.guard.api-key.next.ts), so a key header there is a claim nobody verifies.
 */
export const KEYLESS_API_PATH = /^\/api\/(?:auth|public)(?:\/|$)/;

const API_PATH = /^\/api(?:\/|$)/;
/** The only API surface that verifies an MCP grant token (`machine-mcp`): the MCP servers of mcp_server (docs/phases/57-mcp-server). */
export const MCP_GRANT_PATH = /^\/api\/mcp(?:\/|$)/;

/**
 * The lane whose human controls apply to a request on a path once the credential header that claimed a machine lane is weighed
 * against what the path verifies (phase 55 00 review): `machine-agent` holds only on `FLEET_AGENT_CREDENTIAL_PATH`, `machine-apikey`
 * only on an API path outside `KEYLESS_API_PATH`; elsewhere the claim buys nothing and the request is the public lane (L-2: an
 * unverifiable claim takes the strictest semantics). Every other lane is decided by something the proxy verified (a cookie, the cron
 * secret) or by the path itself (a provider callback) and is returned unchanged. Without this, one forged `Authorization: Bearer
 * sk_live_x` or `X-Fleet-Envelope` on any public route (password reset, magic-link consume, a form submission) bought the exemption
 * from IP bans that L-4 gives machine actors.
 */
export function claimedLaneOn(lane: Lane, path: string): Lane {
  if (lane === 'machine-agent') return FLEET_AGENT_CREDENTIAL_PATH.test(path) ? lane : 'public-anon';
  if (lane === 'machine-apikey') return API_PATH.test(path) && !KEYLESS_API_PATH.test(path) ? lane : 'public-anon';
  if (lane === 'machine-mcp') return MCP_GRANT_PATH.test(path) ? lane : 'public-anon';
  return lane;
}

/** `LANE_POLICY` of `claimedLaneOn(lane, path)`. */
export function claimedLanePolicy(lane: Lane, path: string): LanePolicy {
  return LANE_POLICY[claimedLaneOn(lane, path)];
}

/**
 * The lane of a session by its token audience (user_session TokenAudience): `device` (the native app's bearer) is `human-native`;
 * `web` (the cookie session), and any other value (L-2: the strictest human semantics), is `human-web`. The login-risk step-up reads
 * the `stepUp` and `geoAnomaly` columns of this lane instead of comparing the audience itself.
 */
export function sessionAudienceLane(audience: string | null | undefined): Lane {
  return audience === 'device' ? 'human-native' : 'human-web';
}
