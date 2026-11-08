import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { clearAccountSessionStepUp, forceAccountSessionStepUp } from './user.account-actions.service';
import { platformStepUp, readActionNote } from './user.account-actions.http';

/**
 * /api/users/[userId]/sessions/[sessionId]/step-up (phase 55 00.6, P-6), `user.users.sessions_step_up`, GLOBAL, optional `{ reason }`.
 *
 *  - POST: the session stays signed in, but every request it makes is refused 401 with `details.stepUp` until the person proves a
 *    second factor on it (user_session.step-up-flag.ts). 409 for an impersonation, break-glass or still-pending session, and for a
 *    person with no factor that can step up (end the session instead). Asking again is harmless (`alreadyRequired`).
 *  - DELETE: lifts it (the undo).
 * Both under the acting administrator's step-up; audited `user_session.step_up_forced` / `user_session.step_up_cleared`.
 */
type Ctx = { params: Promise<{ tenantId: string; userId: string; sessionId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { userId, sessionId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.sessions_step_up', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    const r = await forceAccountSessionStepUp({
      userId, sessionId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.sessions_step_up', userId),
    });
    return NextResponse.json({ stepUpRequired: true, at: r.at, alreadyRequired: r.alreadyRequired }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { userId, sessionId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.sessions_step_up', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    const { wasRequired } = await clearAccountSessionStepUp({
      userId, sessionId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.sessions_step_up', userId),
    });
    return NextResponse.json({ stepUpRequired: false, wasRequired }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
