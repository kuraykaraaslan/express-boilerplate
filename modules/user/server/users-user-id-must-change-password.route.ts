import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { forcePasswordChange, unforcePasswordChange } from './user.account-actions.service';
import { platformStepUp, readActionNote } from './user.account-actions.http';

/**
 * /api/users/[userId]/must-change-password (phase 55 00.6, P-6), `user.users.force_password_change`, GLOBAL, optional `{ reason }`.
 *
 *  - POST: the person must choose a new password, at the next sign-in and on every live session now (auth.05's change-password
 *    step). 409 NO_LOCAL_PASSWORD for an account without a local password.
 *  - DELETE: lifts it (the undo).
 * Both under the acting administrator's step-up; audited `auth.password_change_forced` / `auth.password_change_unforced`.
 */
type Ctx = { params: Promise<{ tenantId: string; userId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.force_password_change', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    const { sessionsFlagged } = await forcePasswordChange({
      userId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.force_password_change', userId),
    });
    return NextResponse.json({ mustChangePassword: true, sessionsFlagged }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.force_password_change', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    const { wasForced } = await unforcePasswordChange({
      userId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.force_password_change', userId),
    });
    return NextResponse.json({ mustChangePassword: false, wasForced }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
