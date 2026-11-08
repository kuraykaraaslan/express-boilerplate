import { env } from '@kuraykaraaslan-labs/env';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import { resolveLane } from '@kuraykaraaslan-labs/common/server/lane';
import type { SecondFactorAttempt, SecondFactorFlow } from './auth.second-factor-guard';

/** What `secondFactorAttemptOf` reads of a request: a `NextRequest`, or anything of the same shape. */
export interface SecondFactorRequest {
  headers: { get(name: string): string | null };
  cookies?: { get(name: string): { value: string } | undefined };
  nextUrl?: { pathname: string };
  url?: string;
}

/**
 * Phase 55 00.5: the attempt context a route hands the second-factor guard (auth.second-factor-guard.ts). The address is read the one
 * way every consumer reads it (`clientIpOf`, the trusted hops); the lane is classified exactly as the limiter classifies it
 * (`resolveLane` on the tenant-relative path, the headers and the cookie presence), and only a lane whose `banParticipation` is `true`
 * (human-web, human-native, public-anon) lets a wrong code strike the address (38 L-4). Never throws: a request it cannot read gives an
 * attempt without an address, which still counts per user.
 */
export function secondFactorAttemptOf(
  request: SecondFactorRequest,
  input: { tenantId?: string | null; flow: SecondFactorFlow; userSessionId?: string | null },
): SecondFactorAttempt {
  const attempt: SecondFactorAttempt = { tenantId: input.tenantId ?? null, flow: input.flow };
  // An in-session flow counts on its session, never on the account (auth.second-factor-guard.ts).
  if (input.userSessionId) attempt.userSessionId = input.userSessionId;
  try {
    attempt.ipAddress = clientIpOf(request.headers) ?? null;
    const pathname = request.nextUrl?.pathname ?? (request.url ? new URL(request.url).pathname : '/');
    const path = pathname.replace(/^\/tenant\/[^/]+/, '') || '/';
    const { policy } = resolveLane({
      path,
      headers: request.headers,
      hasSessionCookie: !!(request.cookies?.get('accessToken')?.value || request.cookies?.get('refreshToken')?.value),
      cronSecret: env.CRON_SECRET,
    });
    attempt.humanLane = policy.banParticipation === true;
  } catch {
    attempt.humanLane = false;
  }
  return attempt;
}
