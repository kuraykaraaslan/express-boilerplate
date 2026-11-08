import type { NextRequest } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import UserSessionNextHelpers from '@kuraykaraaslan-labs/user_session/server/user_session.next.helpers';
import { mintSessionHandoff } from '@kuraykaraaslan-labs/user_session/server/user_session.handoff.service';
import { tenantOrigin } from '@kuraykaraaslan-labs/common/server/tenant-url';
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { isRootSurfaceHost, sameHost } from '@kuraykaraaslan-labs/common/server/tenant-host';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { derivedSessionClaims } from '@kuraykaraaslan-labs/user_session/server/user_session.fleet-id';

/**
 * Whether the host the request came in on already serves `tenantId`, so a session set here reaches it and no hop is needed:
 * the tenant's own host (ports apart: a cookie knows none), or, for the ROOT tenant, any of its surfaces as the proxy routes them
 * (`proxy/tenancy.ts`: localhost in development, the wildcard's apex, `<root subdomain>.<apex>`). Before this check the picker on
 * `localhost:3000` handed the platform tenant off to `system.localhost:3000`, a host the proxy did not route (E2E-1.1).
 */
export function hostServesTenant(requestHost: string | null, tenantId: string, targetHost: string | null): boolean {
  if (!requestHost) return false;
  if (targetHost && sameHost(targetHost, requestHost)) return true;
  if (tenantId !== ROOT_TENANT_ID) return false;
  return isRootSurfaceHost(requestHost, {
    wildcard: env.TENANT_WILDCARD_DOMAIN ?? env.NEXT_PUBLIC_TENANT_WILDCARD_DOMAIN ?? null,
    rootSubdomain: env.TENANT_DEFAULT_SUBDOMAIN ?? null,
    production: env.NODE_ENV === 'production',
    allowLocalhostRoot: env.ALLOW_LOCALHOST_ROOT === 'true',
  });
}

/**
 * Entering a tenant from another one (the tenant picker's switch, a freshly opened organization in the onboarding).
 *
 * When the tenant has its own serving host (domain tenancy) and the request is not on it, a session cookie set here
 * would never reach it (cookies are host-only): the answer is then a one-time handoff URL on that host
 * (user_session.handoff.service; GET /api/auth/session/handoff there redeems it and creates the session). Otherwise
 * (path tenancy, no own host, already on it, or on another host that serves the same tenant: `hostServesTenant`) this
 * returns null and the caller creates the session here and sets its cookies. The caller has already decided that
 * `userId` may enter `tenantId`; the handoff route decides again.
 */
export async function handoffUrlFor(
  request: NextRequest,
  userId: string,
  tenantId: string,
  next = '/admin',
  claims: ReturnType<typeof derivedSessionClaims> = {},
): Promise<string | null> {
  const origin = await tenantOrigin(tenantId);
  const targetHost = origin ? new URL(origin).host : null;
  if (!targetHost || hostServesTenant(request.headers.get('host'), tenantId, targetHost)) return null;
  const code = await mintSessionHandoff({
    userId,
    tenantId,
    fingerprint: UserSessionNextHelpers.generateDeviceFingerprint(request),
    next,
    ...claims,
  });
  return `${origin}${tenantPath(tenantId, '/api/auth/session/handoff')}?code=${encodeURIComponent(code)}`;
}
