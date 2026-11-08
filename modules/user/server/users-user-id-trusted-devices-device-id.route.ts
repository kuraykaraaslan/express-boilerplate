import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { revokeAccountTrustedDevices } from './user.account-actions.service';
import { platformStepUp, readActionNote } from './user.account-actions.http';

/**
 * DELETE /api/users/[userId]/trusted-devices/[deviceId] (phase 55 00.6, P-6): revokes one trusted device of the person
 * (`user.users.trusted_devices_revoke`, GLOBAL, optional `{ reason }`), the acting administrator under a step-up. 404 when the
 * person has no such device.
 */
type Ctx = { params: Promise<{ tenantId: string; userId: string; deviceId: string }> };

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { userId, deviceId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.trusted_devices_revoke', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    const { count } = await revokeAccountTrustedDevices({
      userId, deviceId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.trusted_devices_revoke', userId),
    });
    return NextResponse.json({ revoked: true, count }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
