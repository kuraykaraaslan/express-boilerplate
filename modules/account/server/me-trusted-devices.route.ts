// path: app/tenant/[tenantId]/api/auth/me/trusted-devices/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { assertOwnerAtKeyboard } from './me-trusted-devices.guard';

/**
 * /tenant/[tenantId]/api/auth/me/trusted-devices (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.6, P-6): the signed-in
 * person's own trusted devices (the browsers where "trust this device" skips the sign-in code).
 *
 *  - GET (`account.trusted_devices.read`): the devices, newest first; never the token hash (`deviceId` names one).
 *  - DELETE (`account.trusted_devices.manage`): revokes all of them. Their next sign-in there asks for the code again; no session
 *    ends. No step-up: revoking only takes trust away (like "sign out all other sessions"). An impersonation or break-glass session
 *    is refused (403): the person at the keyboard is not the account owner.
 * The user id always comes from the session, never from the request.
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'account.trusted_devices.read', scope: 'ACCOUNT' });
    return NextResponse.json({ devices: await UserSecurityService.listTrustedDevices(user.userId) });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'account.trusted_devices.manage', scope: 'ACCOUNT' });
    assertOwnerAtKeyboard(userSession);
    const { count } = await UserSecurityService.revokeTrustedDevicesBy(user.userId, { by: 'self', actorId: user.userId });
    return NextResponse.json({ revoked: true, count });
  } catch (e) {
    return normalizeError(e);
  }
}
