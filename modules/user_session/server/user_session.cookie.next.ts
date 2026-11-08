import { env } from '@kuraykaraaslan-labs/env';
import type { NextRequest } from 'next/server';

const TENANT_PATH_PREFIX = env.TENANT_PATH_PREFIX || 't';

/**
 * Cookie options for the `accessToken`/`refreshToken` pair, now that a
 * session is scoped to exactly one tenant.
 *
 * In "domain" tenancy each tenant is its own host, so a host-only cookie
 * (`path: '/'`) already never crosses tenants — nothing to change there.
 *
 * In "path" tenancy every tenant lives at `/t/{tenantId}/...` on the SAME
 * host, so a site-wide cookie is sent on every tenant's path regardless of
 * which tenant it was minted for. The backend still rejects the mismatch
 * (`tenant_session.authenticate.next.ts`), but a wrong-tenant cookie
 * silently overwriting a right-tenant one in the same browser (two tenants
 * open in two tabs) is a real usability bug on top of the latent exposure —
 * scoping the cookie's `path` to that tenant's own prefix fixes both: it is
 * never sent to another tenant's path, and two tenants can hold live
 * sessions in the same browser at once.
 */
export function sessionCookiePath(tenantId: string): string {
  return env.TENANCY_MODE === 'path' ? `/${TENANT_PATH_PREFIX}/${tenantId}` : '/';
}

export function isSecureRequest(request: NextRequest | Request): boolean {
  const origin = request.headers.get('origin') || '';
  const protocol = request.headers.get('x-forwarded-proto') || request.headers.get('x-scheme') || 'http';
  return origin.startsWith('https://') || protocol === 'https';
}

/** 38-security 3.4: the per-device "trust this device" cookie. Its value is an opaque token; only its SHA-256 is stored (user_security). */
export const TRUSTED_DEVICE_COOKIE = 'trusted-device';
export const TRUSTED_DEVICE_DAYS = 30;

export function trustedDeviceCookieOptions(request: NextRequest | Request) {
  const maxAge = 60 * 60 * 24 * TRUSTED_DEVICE_DAYS;
  return isSecureRequest(request)
    ? { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge }
    : { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge };
}

export function sessionCookieOptions({
  request,
  tenantId,
  rememberMe = false,
}: {
  request: NextRequest | Request;
  tenantId: string;
  rememberMe?: boolean;
}) {
  const isSecure = isSecureRequest(request);
  const maxAge = rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;
  const path = sessionCookiePath(tenantId);

  // SameSite=Lax on every scheme (E-05): `None` sent the session on every cross-site request, so CSRF rested on the
  // csrf-token header alone (and a route that forgot assertCsrf was open). Lax still carries it on a top-level GET
  // navigation into the app.
  return isSecure
    ? { httpOnly: true, secure: true, sameSite: 'lax' as const, path, maxAge }
    : { httpOnly: true, sameSite: 'lax' as const, path, maxAge };
}
