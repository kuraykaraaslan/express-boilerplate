import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { revokeAccountSession } from './user.account-actions.service';
import { platformStepUp, readActionNote } from './user.account-actions.http';

/**
 * DELETE /api/users/[userId]/sessions/[sessionId] (phase 55 00.6, P-6): ends one session of the person (`user.users.sessions_revoke`,
 * GLOBAL, optional `{ reason }`), the acting administrator under a step-up. A session that is not the person's is a 404.
 */
type Ctx = { params: Promise<{ tenantId: string; userId: string; sessionId: string }> };

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { userId, sessionId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.sessions_revoke', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    await revokeAccountSession({
      userId, sessionId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.sessions_revoke', userId),
    });
    return NextResponse.json({ revoked: true }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
