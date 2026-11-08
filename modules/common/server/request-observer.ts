/**
 * Sees every request the platform serves, for the AI firewall's feature store (docs/phases/55-ai-firewall/02 §2.1): the proxy hands
 * over the requests it answers itself or forwards to a page (and counts static asset loads), the tenant API dispatcher
 * (`app/tenant/[tenantId]/api/[...slug]/route.ts`) every API answer with its route template and status.
 *
 * `common` is a leaf and cannot import `ai_firewall`, so the firewall registers its observer at boot (a runtime `common:boot_task`), the
 * way the limiter registers the dispatcher's answer watcher (`route-answers.ts`). Held on `globalThis`, because the instrumentation hook,
 * the proxy bundle and the route bundles can each load this file.
 *
 * The observer is SYNCHRONOUS and must stay cheap (tens of microseconds): it folds the request into counters in its own process and
 * returns; whatever it writes to Redis goes later, in batches, from a timer. `observeRequest` never throws and never waits, so the answer
 * is sent exactly as it would be without a firewall (FWA-7). With no observer (a test, a tool, a process that never booted the app)
 * nothing happens.
 *
 * The guard's principal (`noteRequestPrincipal`, written by auth_abac's `authorizeRequest` once a caller is authenticated) is kept beside
 * the request in a WeakMap, so the dispatcher's observation can name who made the request without re-reading a session. Nothing outlives
 * the request.
 */

/** A request as the observer reads it (a NextRequest fits). */
export interface ObservedRequest {
  method: string;
  headers: { get(name: string): string | null };
  nextUrl?: { pathname: string; search: string };
  url?: string;
}

export interface RequestObservation {
  /** `proxy`: a page, an asset or an answer of the proxy itself; `api`: an answer of the tenant API dispatcher. */
  phase: 'proxy' | 'api';
  request: ObservedRequest;
  /** The tenant the request was for (the dispatcher's canonical id); null where the proxy has not resolved it. */
  tenantId: string | null;
  /** The tenant-relative path (`/api/members/12` at the dispatcher, the pathname at the proxy). */
  path: string;
  /** The registry route TEMPLATE the dispatcher matched (`/api/members/[memberId]`); null for no match and at the proxy. */
  route: string | null;
  /** The answer's status; null when the proxy forwarded the request and the final status is not known there. */
  status: number | null;
  /** The answer's `content-length`, when it carries one. */
  responseBytes: number | null;
  /** A static asset the proxy let through (counted, nothing else read). */
  asset?: boolean;
}

export type RequestObserver = (observation: RequestObservation) => void;

const OBSERVER_KEY = Symbol.for('kuraykaraaslan-labs.common.requestObserver');
const PRINCIPALS_KEY = Symbol.for('kuraykaraaslan-labs.common.requestPrincipals');
const holder = globalThis as unknown as Record<symbol, unknown>;

export function setRequestObserver(observer: RequestObserver | null): void {
  holder[OBSERVER_KEY] = observer;
}

/** Whether an observer is registered (the proxy skips building an observation when none is). */
export function hasRequestObserver(): boolean {
  return typeof holder[OBSERVER_KEY] === 'function';
}

/** Hands a request to the observer. Synchronous; never throws: observing must not change or delay the answer. */
export function observeRequest(observation: RequestObservation): void {
  try {
    const observer = holder[OBSERVER_KEY];
    if (typeof observer === 'function') (observer as RequestObserver)(observation);
  } catch {
    // a failing observer never changes the answer
  }
}

/** Who the guard authenticated for a request: ids only, never a token. */
export interface RequestPrincipal {
  userId: string | null;
  sessionId: string | null;
  apiKeyId: string | null;
  /** The member's role in the tenant (`OWNER`, `ADMIN`, `USER`, …), null outside a membership. */
  role: string | null;
  tenantId: string | null;
  /**
   * The request was made during an impersonation: `userId` is then the operator, never the person impersonated (D55-47), and the
   * feature store keeps the request out of every day profile.
   */
  impersonating?: boolean;
}

const principals = (): WeakMap<object, RequestPrincipal> =>
  (holder[PRINCIPALS_KEY] ??= new WeakMap<object, RequestPrincipal>()) as WeakMap<object, RequestPrincipal>;

/** The guard: this request's caller. The last call wins (a handler that authorizes twice names the same caller). Never throws. */
export function noteRequestPrincipal(request: unknown, principal: RequestPrincipal): void {
  try {
    if (request && typeof request === 'object') principals().set(request, principal);
  } catch {
    // bookkeeping never changes the answer
  }
}

/** The caller the guard noted for this request, or null (an anonymous request, a refused one, a route without the guard). */
export function requestPrincipalOf(request: unknown): RequestPrincipal | null {
  try {
    return request && typeof request === 'object' ? principals().get(request) ?? null : null;
  } catch {
    return null;
  }
}
