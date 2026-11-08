// path: app/tenant/[tenantId]/api/auth/me/trusted-devices/[deviceId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { assertOwnerAtKeyboard } from './me-trusted-devices.guard';

/**
 * DELETE /tenant/[tenantId]/api/auth/me/trusted-devices/[deviceId] (phase 55 00.6, P-6): revokes one of the signed-in person's
 * trusted devices (`account.trusted_devices.manage`). 404 when the person has no such device (another person's included, since
 * the lookup is the caller's own record). An impersonation or break-glass session is refused (403).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; deviceId: string }> },
) {
  try {
    const { deviceId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'account.trusted_devices.manage', scope: 'ACCOUNT' });
    assertOwnerAtKeyboard(userSession);
    const { count } = await UserSecurityService.revokeTrustedDevicesBy(user.userId, { by: 'self', actorId: user.userId }, deviceId);
    return NextResponse.json({ revoked: true, count });
  } catch (e) {
    return normalizeError(e);
  }
}
