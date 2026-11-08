// path: app/tenant/[tenantId]/api/auth/me/device-info/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserAgentService from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.service';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * GET /tenant/[tenantId]/api/auth/me/device-info
 * Tenant-scoped /api/auth/me endpoint.
 * Parses the inbound user-agent + IP into a UA and geo block.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await Limiter.checkRateLimit(request);
    await authorizeRequest({
      request,
      requiredPermission: 'account.devices.read',
      scope: 'ACCOUNT',
    });

    const userAgent = request.headers.get('user-agent');
    const ip =
      clientIpOf(request.headers) ?? null;

    const { deviceInfo, geoLocation, location } = await UserAgentService.getDeviceAndLocation(userAgent, ip);

    return NextResponse.json({ deviceInfo, geoLocation, location }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
