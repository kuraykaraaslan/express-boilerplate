import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import UserSessionNextService from '@kuraykaraaslan-labs/user_session/server/user_session.service.next';

/**
 * The cookie/header auth services were written for route handlers and only ever
 * read `request.cookies.get(name)` / `request.headers.get(name)`. Inside an RSC
 * layout there is no NextRequest, so we adapt next/headers' cookies()/headers()
 * into the minimal shape those services touch. Reconstructing a real NextRequest
 * is unnecessary (and brittle across runtimes).
 */
export async function requestFromHeaders(): Promise<NextRequest> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return {
    cookies: {
      get: (name: string) => cookieStore.get(name),
    },
    headers: {
      get: (name: string) => headerStore.get(name),
    },
  } as unknown as NextRequest;
}

export type TenantPageAuth = { ok: true } | { ok: false };

/**
 * Server-side *authentication* gate for tenant pages (the admin shell) — the
 * defense-in-depth backstop to the primary gate in proxy.ts (middleware), which
 * already 307s unauthenticated admin requests before any HTML/RSC streams.
 *
 * Answers one question: does the visitor have a usable session? A session is
 * usable when its access token still backs a live session, OR the session is
 * expired-but-refreshable (the client-side axios interceptor refreshes it). A
 * dead session (expired/revoked/idle-timed-out and not refreshable) is rejected
 * so the caller redirects to login — note this validates the real session, not
 * just the JWT, so an unexpired access-token JWT over a SESSION_EXPIRED session
 * no longer slips through.
 *
 * Per-tenant *authorization* (membership/role) is intentionally NOT enforced
 * here — it stays where the rest of the app enforces it: each admin page's API
 * calls.
 */
export async function authenticateTenantPage(): Promise<TenantPageAuth> {
  const request = await requestFromHeaders();
  return (await UserSessionNextService.hasUsableSession(request)) ? { ok: true } : { ok: false };
}

export type TenantPageMembership = 'member' | 'outsider' | 'unknown';

/**
 * Where a signed-in visitor stands in `tenantId`, for NAVIGATION only (authorization stays with the API calls, as
 * above): `outsider` when the session definitely cannot act here (no membership, or a session minted for another
 * tenant), so the shell can send them to the tenant picker instead of rendering an admin they cannot use. Members,
 * global admins and impersonations are `member`. Anything else that fails (a pending one-time code, a hiccup) is
 * `unknown`, and the caller keeps its old behaviour; this never locks anybody out on an error.
 */
export async function tenantPageMembership(tenantId: string): Promise<TenantPageMembership> {
  const request = await requestFromHeaders();
  try {
    const { authenticateTenantByRequest } = await import('./tenant_session.authenticate.next');
    await authenticateTenantByRequest({ request, tenantId, requiredTenantRole: 'USER', otpVerifyBypass: true });
    return 'member';
  } catch (err) {
    const { AppError, ErrorCode } = await import('@kuraykaraaslan-labs/common/server/app-error');
    const { default: TenantAuthMessages } = await import('./tenant_session.messages');
    if (err instanceof AppError && err.code === ErrorCode.NOT_TENANT_MEMBER) return 'outsider';
    if (err instanceof Error && err.message === TenantAuthMessages.SESSION_TENANT_MISMATCH) return 'outsider';
    return 'unknown';
  }
}
