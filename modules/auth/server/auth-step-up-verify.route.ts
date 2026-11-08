// path: app/tenant/[tenantId]/api/auth/step-up/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { CompleteStepUpSchema } from './auth.step-up';
import { finishStepUp } from './auth.step-up.service';
import { secondFactorAttemptOf } from './auth.second-factor.next';

/**
 * Completes a step-up (P9-19): one attempt per challenge, a user-verified WebAuthn assertion or an unused TOTP code. Answers the
 * grant token the protected request sends in `x-step-up-token`; it authorises one request of this session, for the challenge's
 * purpose, within five minutes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'auth');
    const session = await authorizeRequest({ request, tenantId, requiredPermission: 'auth.session.step_up', requiredTenantRole: 'USER', scope: 'TENANT' });
    const parsed = CompleteStepUpSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('Invalid step-up response', 400, ErrorCode.VALIDATION_ERROR);
    // Phase 55 00.5: a wrong authenticator code counts on this session (five end it), strikes this address on a human lane and is audited.
    const attempt = secondFactorAttemptOf(request, { tenantId, flow: 'step_up', userSessionId: session.userSession?.userSessionId });
    return NextResponse.json(await finishStepUp(session, tenantId, parsed.data, attempt));
  } catch (e) {
    return normalizeError(e);
  }
}
