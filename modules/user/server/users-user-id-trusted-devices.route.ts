import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { listAccountTrustedDevices, revokeAccountTrustedDevices } from './user.account-actions.service';
import { platformStepUp, readActionNote } from './user.account-actions.http';

/**
 * /api/users/[userId]/trusted-devices (phase 55 00.6, P-6), GLOBAL.
 *
 *  - GET (`user.users.trusted_devices_read`): the devices that still skip the person's sign-in code (no token hash; `deviceId` names one).
 *  - DELETE (`user.users.trusted_devices_revoke`, optional `{ reason }`): revokes all of them, the acting administrator under a
 *    step-up. No session ends. Audited `security.trusted_device_revoked_by_admin`.
 */
type Ctx = { params: Promise<{ tenantId: string; userId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'user.users.trusted_devices_read', scope: 'GLOBAL' });
    return NextResponse.json({ devices: await listAccountTrustedDevices({ userId }) }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.trusted_devices_revoke', scope: 'GLOBAL' });
    const note = await readActionNote(request);
    if (!note.ok) return note.response;
    const { count } = await revokeAccountTrustedDevices({
      userId, actorId: auth.user.userId, reason: note.reason,
      confirm: platformStepUp(request, auth, 'user.users.trusted_devices_revoke', userId),
    });
    return NextResponse.json({ revoked: true, count }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
