import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { resetTwoFactor } from './user.support.service';
import { platformStepUp } from './user.account-actions.http';

/**
 * POST /api/users/[userId]/reset-2fa: named support path (38-security 6.7). Platform operators only (GLOBAL scope, ADMIN floor), audited.
 * Phase 55 00.6: the acting administrator steps up (purpose `user.users.reset_2fa`, target the person) after the refusals, before the reset.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> },
) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.reset_2fa', scope: 'GLOBAL' });
    await resetTwoFactor({ userId, actorId: auth.user.userId, confirm: platformStepUp(request, auth, 'user.users.reset_2fa', userId) });
    return NextResponse.json({ reset: true, emailReverificationRequired: true, passwordChangeRequired: true }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
