import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { unlockAccount } from './user.support.service';

/**
 * POST /api/users/[userId]/unlock: named support path (38-security 6.7). Platform operators only (GLOBAL scope, ADMIN floor), audited.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> },
) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.unlock', scope: 'GLOBAL' });
    const { wasLocked } = await unlockAccount({ userId, actorId: auth.user.userId });
    return NextResponse.json({ unlocked: true, wasLocked }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
