import type { NextRequest } from 'next/server';
import { emitSecuritySignal, type ActorRef } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { tallySecuritySignal } from '@kuraykaraaslan-labs/common/server/common.firewall-tally';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { laneOfRequest } from '@kuraykaraaslan-labs/common/server/lane';
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error';
import { rateLimitBucketOf } from '@kuraykaraaslan-labs/limiter/server/limiter.ip-bucket';
import TenantInvitationMessages from './tenant_invitation.messages';

/**
 * tenant_invitation's signals for the AI firewall (docs/phases/55-ai-firewall/02 §2.6, the invitation path of the sign-up protection;
 * registered in tenant_invitation.firewall-signals.ts). The module writes no audit row of its own, so without these the firewall saw a
 * joining member only as the membership's webhook event:
 *
 *  - `tenant_invitation.accepted`: an invitation was accepted and its membership made (by the e-mailed token, by id as the verified
 *    account, or automatically when a verified account registered). About the person; the invitation is the subject. Emitted as it
 *    happens (one per invitation).
 *  - `tenant_invitation.token_refused`: the accept route was given a token no invitation of the tenant has (someone guessing or replaying
 *    invitation links). TALLIED (one signal per tenant, lane and actor every few seconds, with the count), never one per request.
 *
 * Fail open (FWA-7): synchronous, never throw, never change an answer. Codes only: never the token or the e-mail address.
 */

export const INVITATION_ACCEPTED_SIGNAL = 'tenant_invitation.accepted';
export const INVITATION_TOKEN_REFUSED_SIGNAL = 'tenant_invitation.token_refused';

export type InvitationAcceptedVia = 'token' | 'id' | 'auto';

const platformOr = (tenantId: string): string | null => (tenantId.toLowerCase() === ROOT_TENANT_ID ? null : tenantId.toLowerCase());

/** An invitation was accepted (its membership exists now). Never throws. */
export function noteInvitationAccepted(n: { tenantId: string; userId: string; invitationId: string; memberRole: string; via: InvitationAcceptedVia }): boolean {
  try {
    return emitSecuritySignal({
      tenantId: platformOr(n.tenantId),
      kind: INVITATION_ACCEPTED_SIGNAL,
      actor: { kind: 'user', id: n.userId },
      subject: { type: 'tenant_invitation', id: n.invitationId },
      outcome: 'info',
      // an invitation that hands out administrator rights is worth a second look when the joiner then behaves oddly
      severity: n.memberRole === 'USER' ? 'low' : 'medium',
      attrs: { via: n.via, role: String(n.memberRole).slice(0, 16) },
      source: 'tenant_invitation',
    });
  } catch {
    return false;
  }
}

/** Is this the accept route's answer to a token no invitation of the tenant has? */
export const isUnknownTokenRefusal = (error: unknown): boolean =>
  error instanceof AppError && error.statusCode === 404 && error.message === TenantInvitationMessages.INVITATION_INVALID_TOKEN;

/**
 * The accept route refused an unknown token (see the header). Nothing for any other error. `ipOf` answers the limiter's client address
 * (`Limiter.getIpFromRequest`, 'unknown' when there is none); it is asked inside the guard, so nothing it throws reaches the route. Never
 * throws.
 */
export function noteInvitationTokenRefused(request: NextRequest, tenantId: string, error: unknown, userId: string | null, ipOf: () => string | null): boolean {
  try {
    if (!isUnknownTokenRefusal(error)) return false;
    let ip: string | null = null;
    if (!userId) {
      try { ip = ipOf(); } catch { ip = null; }
    }
    const actor: ActorRef = userId ? { kind: 'user', id: userId } : ip && ip !== 'unknown' ? { kind: 'ip', id: rateLimitBucketOf(ip) } : { kind: 'anon', id: 'anonymous' };
    let lane: ReturnType<typeof laneOfRequest>['lane'] | 'unknown' = 'unknown';
    try { lane = laneOfRequest(request).lane; } catch { /* the lane is a detail */ }
    return tallySecuritySignal({
      tenantId: platformOr(tenantId),
      lane,
      kind: INVITATION_TOKEN_REFUSED_SIGNAL,
      actor,
      outcome: 'deny',
      severity: 'medium',
      attrs: { method: request.method === 'GET' ? 'GET' : 'POST' },
      source: 'tenant_invitation',
    });
  } catch {
    return false;
  }
}
