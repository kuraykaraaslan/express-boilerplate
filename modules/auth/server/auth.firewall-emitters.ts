import type { NextRequest } from 'next/server';
import type { ActorRef } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { tallySecuritySignal } from '@kuraykaraaslan-labs/common/server/common.firewall-tally';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { laneOfRequest } from '@kuraykaraaslan-labs/common/server/lane';
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import { rateLimitBucketOf } from '@kuraykaraaslan-labs/limiter/server/limiter.ip-bucket';
import { UserSessionMessages } from '@kuraykaraaslan-labs/user_session/server/user_session.messages';
import type { TokenAudience } from '@kuraykaraaslan-labs/user_session/server/user_session.token.service';

/**
 * auth's own signals for the AI firewall (docs/phases/55-ai-firewall/02 §2.6, registered in auth.firewall-signals.ts): the six human auth
 * routes that wrote no row (the `pending` list of `check:firewall-signal-coverage`, 01 §1.5). Each outcome that is cheap and meaningful is
 * TALLIED (common.firewall-tally.ts): counted in process, one signal per tenant, lane, actor and reason every few seconds with the count,
 * never one per request, and never awaited:
 *
 *  - `auth.callback_refused`  /api/auth/callback refused an access token that does not verify (login CSRF, session fixation attempts).
 *  - `auth.refresh_refused`   /api/auth/refresh and /api/auth/device/refresh refused a refresh token: `revoked`, `expired`,
 *                             `not_found`, `otp_required`, `invalid`, about the address. A `reused` token (a rotated token presented
 *                             again) is user_session's `user_session.refresh_reused` about the person, never tallied here (D55-74).
 *  - `auth.otp_sent`          /api/auth/otp/send sent a code by e-mail or SMS (SMS pumping is a cost; codes asked for over and over are a
 *                             second-factor attack's first step).
 *  - `auth.verify_email_sent` /api/auth/verify-email/send sent a verification mail again.
 *  - `auth.totp_setup_started`/api/auth/totp/setup stored a pending authenticator secret (a hijacked session adding its own factor starts here;
 *                             the enrolment itself is `security.mfa_enabled`).
 *
 * And the effect of the hard block of sign-ups (02.6 sign-up protection): `auth.signup_blocked`, a sign-up the block refused.
 *
 * Fail open (FWA-7): synchronous, never throw, never change an answer. Codes only: never a token, a path or a header value. The ROOT
 * tenant's are the platform's (`tenantId` null).
 */

export const CALLBACK_REFUSED_SIGNAL = 'auth.callback_refused';
export const REFRESH_REFUSED_SIGNAL = 'auth.refresh_refused';
export const OTP_SENT_SIGNAL = 'auth.otp_sent';
export const VERIFY_EMAIL_SENT_SIGNAL = 'auth.verify_email_sent';
export const TOTP_SETUP_STARTED_SIGNAL = 'auth.totp_setup_started';
export const SIGNUP_BLOCKED_SIGNAL = 'auth.signup_blocked';

const platformOr = (tenantId: string | null | undefined): string | null => {
  const t = tenantId ? tenantId.toLowerCase() : null;
  return !t || t === ROOT_TENANT_ID ? null : t;
};

/** The tenant a request is addressed to, from its path (`/tenant/<id>/api/...`), or null. */
export function tenantOfRequest(request: NextRequest): string | null {
  const path = request.nextUrl?.pathname ?? '';
  return /^\/tenant\/([^/]+)\//.exec(path)?.[1] ?? null;
}

/** The address a refusal is about: the rate-limit bucket (an IPv4 address, an IPv6 /64), else nobody we can name. */
function addressActor(request: NextRequest): ActorRef {
  const ip = clientIpOf(request.headers);
  return ip ? { kind: 'ip', id: rateLimitBucketOf(ip) } : { kind: 'anon', id: 'anonymous' };
}

const laneOf = (request: NextRequest) => {
  try { return laneOfRequest(request).lane; } catch { return 'unknown' as const; }
};

/** /api/auth/callback refused an access token that does not verify. Never throws. */
export function noteCallbackRefused(request: NextRequest, tenantId: string | null): boolean {
  try {
    return tallySecuritySignal({
      tenantId: platformOr(tenantId), lane: laneOf(request), kind: CALLBACK_REFUSED_SIGNAL, actor: addressActor(request),
      outcome: 'deny', severity: 'medium', attrs: { reason: 'invalid_token' }, source: 'auth',
    });
  } catch {
    return false;
  }
}

export const REFRESH_REFUSAL_REASONS = ['reused', 'revoked', 'expired', 'not_found', 'otp_required', 'invalid'] as const;
export type RefreshRefusalReason = (typeof REFRESH_REFUSAL_REASONS)[number];

/** Why a refresh was refused, from user_session's error: null when it was no refusal of the token (a rate limit, a race, a fault). */
export function refreshRefusalReason(error: unknown): RefreshRefusalReason | null {
  if (!(error instanceof AppError) || error.statusCode !== 401) return null;
  switch (error.message) {
    case UserSessionMessages.REFRESH_TOKEN_REUSED: return 'reused';
    case UserSessionMessages.SESSION_REVOKED: return 'revoked';
    case UserSessionMessages.SESSION_EXPIRED:
    case UserSessionMessages.TOKEN_EXPIRED: return 'expired';
    case UserSessionMessages.SESSION_NOT_FOUND: return 'not_found';
    case UserSessionMessages.OTP_REQUIRED: return 'otp_required';
    default: return 'invalid';
  }
}

/**
 * A refused refresh (web cookie or device body), about the address (low). A REUSED token is not tallied here: user_session's refresh
 * reports it once, as `user_session.refresh_reused` about the person whose sessions it ended (D55-74), so the detectors never count one
 * reuse twice. Nothing for an error that refused no token.
 */
export function noteRefreshRefused(request: NextRequest, error: unknown, audience: TokenAudience): boolean {
  try {
    const reason = refreshRefusalReason(error);
    if (!reason || reason === 'reused') return false;
    return tallySecuritySignal({
      tenantId: platformOr(tenantOfRequest(request)), lane: laneOf(request), kind: REFRESH_REFUSED_SIGNAL, actor: addressActor(request),
      subject: null, outcome: 'deny', severity: 'low', attrs: { reason, audience }, source: 'auth',
    });
  } catch {
    return false;
  }
}

/** /api/auth/otp/send sent a code. Never throws. */
export function noteOtpSent(request: NextRequest, n: { tenantId: string; userId: string; method: string; action: string }): boolean {
  try {
    return tallySecuritySignal({
      tenantId: platformOr(n.tenantId), lane: laneOf(request), kind: OTP_SENT_SIGNAL, actor: { kind: 'user', id: n.userId },
      outcome: 'info', severity: 'low', attrs: { method: String(n.method).toLowerCase(), action: String(n.action).toLowerCase() }, source: 'auth',
    });
  } catch {
    return false;
  }
}

/** /api/auth/verify-email/send sent a verification mail. Never throws. */
export function noteVerifyEmailSent(request: NextRequest, n: { tenantId: string; userId: string }): boolean {
  try {
    return tallySecuritySignal({
      tenantId: platformOr(n.tenantId), lane: laneOf(request), kind: VERIFY_EMAIL_SENT_SIGNAL, actor: { kind: 'user', id: n.userId },
      outcome: 'info', severity: 'low', source: 'auth',
    });
  } catch {
    return false;
  }
}

/** /api/auth/totp/setup stored a pending authenticator secret. Never throws. */
export function noteTotpSetupStarted(request: NextRequest, n: { tenantId: string; userId: string; userSessionId?: string | null }): boolean {
  try {
    return tallySecuritySignal({
      tenantId: platformOr(n.tenantId), lane: laneOf(request), kind: TOTP_SETUP_STARTED_SIGNAL, actor: { kind: 'user', id: n.userId },
      subject: n.userSessionId ? { type: 'user_session', id: n.userSessionId } : null,
      outcome: 'info', severity: 'low', source: 'auth',
    });
  } catch {
    return false;
  }
}

/** /api/auth/register refused a sign-up under the firewall's hard block (the tenant opted in). Never throws. */
export function noteSignupBlocked(request: NextRequest, tenantId: string): boolean {
  try {
    return tallySecuritySignal({
      tenantId: platformOr(tenantId), lane: laneOf(request), kind: SIGNUP_BLOCKED_SIGNAL, actor: addressActor(request),
      outcome: 'deny', severity: 'medium', attrs: { reason: 'hard_block' }, source: 'auth',
    });
  } catch {
    return false;
  }
}
