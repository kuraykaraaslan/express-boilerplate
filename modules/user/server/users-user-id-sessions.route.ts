import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { listAccountSessions, revokeAccountSessions } from './user.account-actions.service';
import { platformStepUp, readActionNote } from './user.account-actions.http';

/**
 * /api/users/[userId]/sessions (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.6, P-6). Platform operators only (GLOBAL
 * scope, ADMIN floor).
 *
 *  - GET (`user.users.sessions_read`): the person's live sessions in every workspace, newest first (the account page's list).
 *  - DELETE (`user.users.sessions_revoke`, optional `{ reason }`): ends every one of them. The acting administrator steps up
 *    (purpose = the permission, target = the person); the person's ranks as for a suspension. Audited `user_session.revoked_by_admin`.
 */
type Ctx = { params: Promise<{ tenantId: string; userId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'user.users.sessions_read', scope: 'GLOBAL' });
    return NextResponse.json({ sessions: await listAccountSessions({ userId }) }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.sessions_revoke', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    const { count } = await revokeAccountSessions({
      userId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.sessions_revoke', userId),
    });
    return NextResponse.json({ revoked: true, count }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
