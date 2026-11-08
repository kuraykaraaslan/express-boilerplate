'use client';

import axios from 'axios';
import { splitTenantBase } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { AuthMessages } from '@kuraykaraaslan-labs/auth/server/auth.messages';
import UserSessionMessages from '@kuraykaraaslan-labs/user_session/server/user_session.messages';

const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_COOKIE_NAME = 'csrf-token';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

/**
 * common.15: the CSRF token is bound to the session, so a token minted before a login, a refresh or a tenant switch
 * belongs to another (or no) session. Those responses mark the token stale and the next write mints a new one.
 */
let csrfStale = false;
/**
 * The token this page's last mint answered: a refusal may replay with a cookie that changed since its request read it
 * only when it is this one. The csrf-token cookie is one per browser, while path tenancy keeps one session per tenant, so
 * a cookie another tab minted (or a sign-in there rotated) may be bound to another session (40.10 review).
 */
let lastMinted: string | null = null;
const SESSION_CHANGING_PATH = /\/api\/auth\/(login|device-login|refresh|logout|session\/exchange|session\/handoff|otp\/verify|magic-link\/consume|callback|change-password)(?:[/?]|$)|\/api\/auth\/[^/]+\/(login|verify|callback)(?:[/?]|$)/;
function markCsrfStaleAfter(url: string | undefined): void {
  if (url && SESSION_CHANGING_PATH.test(url)) { csrfStale = true; lastMinted = null; }
}
const isCsrfRefusal = (error: any): boolean =>
  error?.response?.status === 403 && /CSRF/i.test(String(error?.response?.data?.message ?? ''));

/**
 * The mint under way, if any. Writes that go out together (a board's first batch and live ticket) share it: each minting
 * its own left the cookie holding only the last token, so every other request's header no longer matched it (40.10.2).
 */
let minting: Promise<string | null> | null = null;

function mintCSRFToken(): Promise<string | null> {
  const mint: Promise<string | null> = axios.get(`/api/auth/csrf`, { withCredentials: true })
    .then((response) => {
      const token: string | null = response.data?.data?.token || getCookie(CSRF_COOKIE_NAME);
      if (minting === mint) lastMinted = token;
      return token;
    })
    .catch(() => {
      console.warn('[CSRF] Failed to fetch CSRF token');
      return null;
    })
    .finally(() => { if (minting === mint) minting = null; });
  minting = mint;
  return mint;
}

async function ensureCSRFToken(forceFresh = false): Promise<string | null> {
  // The session changed since: a mint under way may be for the session before it, so a new one starts.
  if (csrfStale) { csrfStale = false; return mintCSRFToken(); }
  if (minting) return minting;
  const token = forceFresh ? null : getCookie(CSRF_COOKIE_NAME);
  return token || mintCSRFToken();
}

const axiosInstance = axios.create({
  // Same-origin by default (NEXT_PUBLIC_API_URL unset → relative requests). In a
  // subdomain-per-tenant deployment the browser must call its own origin so the
  // proxy resolves the host to the right tenant; an absolute cross-subdomain
  // base URL breaks CORS and tenant isolation. Only set NEXT_PUBLIC_API_URL for
  // a dedicated, CORS-enabled API on a separate origin.
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
});

axiosInstance.interceptors.request.use(
  async (config) => {
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    const method = config.method?.toUpperCase() || 'GET';

    if (!safeMethods.includes(method)) {
      const csrfToken = await ensureCSRFToken();
      if (csrfToken) {
        config.headers[CSRF_HEADER_NAME] = csrfToken;
      }
    }

    return config;
  },
  (error) => Promise.reject(error),
);

let isRefreshing = false;
let failedQueue: { resolve: () => void; reject: (err: any) => void }[] = [];

/**
 * When the last refresh completed. A refresh rotates BOTH cookies, so every
 * request already in flight at that moment is still carrying the old access
 * token and comes back 401 (TOKEN_EXPIRED / SESSION_NOT_FOUND) *after*
 * `isRefreshing` has flipped back to false — too late for the queue to catch
 * them. Each of those would then start its own refresh, rotating the pair
 * again and orphaning the next batch: one expiry turned into a self-sustaining
 * storm of 401s, and the odd racer landed on reuse-detection, which wipes every
 * session the user has. Inside this window we just replay the request with the
 * cookies the completed refresh already installed.
 */
let lastRefreshAt = 0;
const POST_REFRESH_GRACE_MS = 10_000;

const processQueue = (error: any = null) => {
  failedQueue.forEach((p) => {
    error ? p.reject(error) : p.resolve();
  });
  failedQueue = [];
};

/**
 * Where to refresh, and where to send the user when refreshing is hopeless.
 *
 * Both are derived from the tenant prefix the failing request (or the current
 * page) already carries: `/tenant/{id}` or `/t/{id}` keeps that exact prefix so
 * a cross-tenant view refreshes against the tenant it is actually showing, and
 * a clean domain-mode URL stays clean — the host already selects the tenant.
 *
 * The previous version regex-matched `/tenant/([^/]+)` and fell back to
 * `/system/…` when it missed. There is no `/system` route in `app/`, so in
 * domain mode — where URLs legitimately carry no tenant segment — every dead
 * session navigated the user to a 404 instead of the login page.
 */
function getAuthContext(originalRequestUrl?: string): { refreshUrl: string; loginUrl: string; changePasswordUrl: string } {
  const candidate = originalRequestUrl ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const { base } = splitTenantBase(candidate);
  return {
    refreshUrl: `${base}/api/auth/refresh`,
    loginUrl: `${base}/auth/login`,
    changePasswordUrl: `${base}/auth/change-password`,
  };
}

/**
 * Why the sign-in page was opened, beside `redirect` (run 3 #99, D544): `session_ended` when the session could not go on (it expired, was revoked, or a
 * refresh was refused). The sign-in page says so with its "Session expired" banner; a closed value, never text the page would show as it is.
 */
export const LOGIN_REASON_SESSION_ENDED = 'session_ended';

function buildLoginUrlWithRedirect(loginUrl: string, reason?: typeof LOGIN_REASON_SESSION_ENDED): string {
  if (typeof window === 'undefined') return loginUrl;
  const current = window.location.pathname + window.location.search;
  // Only allow safe relative redirects (single leading slash, not protocol-relative).
  const isSafe = current.startsWith('/') && !current.startsWith('//');
  if (!isSafe || current === loginUrl) return loginUrl;
  // the reason rides with the page to go back to: a person sent from a page is told why (never on the sign-in page itself)
  return `${loginUrl}?redirect=${encodeURIComponent(current)}${reason ? `&reason=${reason}` : ''}`;
}

function sendToLogin(loginUrl: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = buildLoginUrlWithRedirect(loginUrl, LOGIN_REASON_SESSION_ENDED);
}

/** Phase 55 00.6: fired on `window` when a request learns its session must step up (SESSION_STEP_UP_REQUIRED). */
export const SESSION_STEP_UP_EVENT = 'nb:session-step-up';

/**
 * A truly dead session can't be refreshed: a refresh would just fail again. These are terminal states (expired, revoked,
 * deleted by reuse-detection, malformed token, fingerprint changed).
 *
 * SESSION_NOT_FOUND is deliberately NOT here: it also fires when a concurrent refresh rotated the access token away,
 * leaving this request's token orphaned. The refresh token may still be valid, so it goes the refresh path, which
 * redirects only if the refresh itself fails.
 */
const DEAD_SESSION_MESSAGES: string[] = [
  UserSessionMessages.SESSION_EXPIRED,
  UserSessionMessages.SESSION_REVOKED,
  UserSessionMessages.INVALID_TOKEN,
  UserSessionMessages.REFRESH_TOKEN_REUSED,
  UserSessionMessages.DEVICE_FINGERPRINT_MISMATCH,
];

/** 401 answers a refresh can cure: the access token expired, is missing, or was rotated away by another refresh. */
const REFRESHABLE_MESSAGES: string[] = [
  AuthMessages.TOKEN_EXPIRED,
  AuthMessages.USER_NOT_AUTHENTICATED,
  UserSessionMessages.SESSION_NOT_FOUND,
];

/**
 * A failed refresh that says nothing about the session, tried again after these pauses before the page is told.
 * 409 is the loser of two refreshes racing on one refresh token (auth.07: retryable by design, the retry re-mints from
 * the winner's row); 5xx and a lost connection are transient (a phone waking from sleep commonly loses its first
 * requests on a connection that died while it slept). Without the retry each of them stranded the page: every request
 * waiting on the refresh failed, nothing retried, and the shell lost its user menu and bells as if signed out.
 * 429 is not retried here: the window is a minute, far longer than a request should hang.
 */
const REFRESH_RETRY_DELAYS_MS = [500, 1500];

function refreshFailureIsTransient(error: unknown): boolean {
  const failure = error as { code?: string; response?: { status?: number } } | null | undefined;
  if (failure?.code === 'ERR_CANCELED') return false;
  const status = failure?.response?.status;
  if (status === undefined) return true;
  return status === 409 || status >= 500;
}

const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

axiosInstance.interceptors.response.use(
  (response) => {
    markCsrfStaleAfter(response.config?.url);
    const message = response.data?.message;

    if (
      message === AuthMessages.TOKEN_EXPIRED ||
      message === AuthMessages.USER_NOT_AUTHENTICATED ||
      message === UserSessionMessages.SESSION_EXPIRED
    ) {
      return Promise.reject({
        config: response.config,
        response: { status: 401, data: response.data },
      });
    }

    return response;
  },

  async (error) => {
    const originalRequest = error.config;

    if (originalRequest?.url?.includes('/auth/refresh')) {
      return Promise.reject(error);
    }

    // common.15: a CSRF refusal usually means the token belongs to an earlier session (a sign-in in another tab, a page that
    // kept a token from before the login): mint one for the current session and replay once.
    // The writes refused together (the first ones of a page after a sign-in, 40.10.2) replay with ONE new token: a mint under
    // way is joined, and a cookie that changed since this request read it is used as it is when this page minted it (another
    // refusal here re-minted already); a cookie set elsewhere may belong to another tab's session, so a new one is minted.
    if (originalRequest && !originalRequest._csrfRetry && isCsrfRefusal(error)) {
      const sent = originalRequest.headers?.[CSRF_HEADER_NAME];
      const cookie = getCookie(CSRF_COOKIE_NAME);
      const reuse = !minting && !csrfStale && !!cookie && cookie !== sent && cookie === lastMinted;
      const fresh = reuse ? cookie : await ensureCSRFToken(true);
      if (fresh) {
        originalRequest._csrfRetry = true;
        originalRequest.headers = { ...(originalRequest.headers ?? {}), [CSRF_HEADER_NAME]: fresh };
        return axiosInstance(originalRequest);
      }
    }

    const message = error.response?.data?.message || error.message;
    const status = error.response?.status;

    // auth.05: the session must change its password before anything else works. Every route but the change-password step
    // answers 403 PASSWORD_CHANGE_REQUIRED; send the person to that page (once: not when already there).
    if (status === 403 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (typeof window !== 'undefined') {
        const { changePasswordUrl } = getAuthContext(originalRequest?.url);
        if (window.location.pathname !== changePasswordUrl) window.location.href = buildLoginUrlWithRedirect(changePasswordUrl);
      }
      return Promise.reject(error);
    }

    // Phase 55 00.6: an administrator or the firewall asked this session to prove a second factor again. Every route answers
    // 401 SESSION_STEP_UP_REQUIRED until it does; neither a refresh nor the login page cures it. The page is told (an event the
    // shell's step-up banner listens to) and the request is rejected as it came, so a caller with its own step-up dialog
    // (auth/ui step-up.client `withStepUp`) can answer it too.
    if (status === 401 && message === UserSessionMessages.SESSION_STEP_UP_REQUIRED) {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_STEP_UP_EVENT));
      return Promise.reject(error);
    }

    // A dead session goes straight to login, skipping the refresh round-trip, and that includes a request that was
    // already replayed after a refresh: the refresh does not check the device fingerprint or the idle timeout, so a
    // replay can be the first request to learn the session is dead. Without this branch those 401s fell through
    // unhandled and callers that swallow the rejection (e.g. the admin shell's session fetch) silently rendered a
    // logged-out UI with no redirect.
    if (status === 401 && DEAD_SESSION_MESSAGES.includes(message)) {
      sendToLogin(getAuthContext(originalRequest?.url).loginUrl);
      return Promise.reject(error);
    }

    const shouldRefresh = REFRESHABLE_MESSAGES.includes(message);

    if (originalRequest?._retry) {
      // The request was already replayed with the cookies of a completed refresh and is still refused as signed out:
      // the refreshed session does not work from this page (its cookies did not take, or were rotated away again).
      // Another refresh would only loop, and rejecting quietly is what left pages sitting on an error toast under a
      // shell that had lost its user menu. The session cannot be used here; sign in again.
      if (shouldRefresh) {
        sendToLogin(getAuthContext(originalRequest?.url).loginUrl);
      }
      return Promise.reject(error);
    }

    if (!shouldRefresh) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          // Mark the replay so a second 401 can't send it back around for
          // another refresh — the `_retry` guard above only covered the one
          // request that triggered the refresh, leaving queued ones free to
          // loop.
          resolve: () => resolve(axiosInstance({ ...originalRequest, _retry: true })),
          reject,
        });
      });
    }

    // A refresh finished moments ago: this request simply predates the new
    // cookies. Replay it as-is instead of rotating the token pair again.
    if (Date.now() - lastRefreshAt < POST_REFRESH_GRACE_MS) {
      return axiosInstance({ ...originalRequest, _retry: true });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    const { refreshUrl, loginUrl } = getAuthContext(originalRequest?.url);

    try {
      // common.31: the refresh is CSRF-checked like any cookie-authenticated write. A stale token (older than its 24 h
      // window) is refused 403, so one retry with a freshly minted token decides whether the session is really gone.
      const postRefresh = async (fresh: boolean) => axios.post(refreshUrl, {}, {
        withCredentials: true,
        headers: { [CSRF_HEADER_NAME]: (await ensureCSRFToken(fresh)) ?? '' },
      });
      const refreshOnce = async () => {
        try {
          await postRefresh(false);
        } catch (first: any) {
          if (first?.response?.status !== 403) throw first;
          await postRefresh(true);
        }
      };
      for (let attempt = 0; ; attempt += 1) {
        try {
          await refreshOnce();
          break;
        } catch (failure) {
          if (attempt >= REFRESH_RETRY_DELAYS_MS.length || !refreshFailureIsTransient(failure)) throw failure;
          await pause(REFRESH_RETRY_DELAYS_MS[attempt]!);
        }
      }
      // common.15: re-mint for the refreshed session before the next write.
      csrfStale = true;
      lastRefreshAt = Date.now();
      processQueue();
      return axiosInstance(originalRequest);
    } catch (refreshError: any) {
      processQueue(refreshError);

      // Only a refusal — not a failure — means the session is gone. The refresh
      // endpoint answers 401/403 for a dead or revoked session; 429 (rate
      // limited) and 5xx / network errors say nothing about the session, and
      // treating them as fatal is how a rate-limit spike or a one-second
      // backend hiccup used to log everyone out mid-work. Those were retried
      // above (but 429); when they persist they reject, and the page shows its
      // error with a way to try again.
      const refreshStatus = refreshError?.response?.status;
      const sessionIsGone = refreshStatus === 401 || refreshStatus === 403;

      if (sessionIsGone) sendToLogin(loginUrl);

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default axiosInstance;
