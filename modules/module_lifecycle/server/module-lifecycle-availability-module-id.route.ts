// path: app/tenant/[tenantId]/api/module-lifecycle/availability/[moduleId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { setModuleAvailability } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.service';
import { AVAILABILITY_STATES, type AvailabilityState } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.types';

/**
 * PUT /tenant/[ROOT]/api/module-lifecycle/availability/[moduleId]  { state, reason? }
 * Set a module's platform availability. `retired` closes it on every customer
 * tenant that has it on (data kept) and returns what was closed per tenant.
 * Platform admin (GLOBAL scope, behind the KD-13 IP/MFA gate) only
 * (docs/phases/25-marketplace/03-module-governance/03).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ moduleId: string }> },
) {
  try {
    const { moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.platform.manage', scope: 'GLOBAL' });

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { state?: unknown; reason?: unknown };
    if (typeof body.state !== 'string' || !(AVAILABILITY_STATES as readonly string[]).includes(body.state)) {
      return NextResponse.json(
        { success: false, message: `Body must be { state: ${AVAILABILITY_STATES.join(' | ')}, reason?: string }` },
        { status: 400 },
      );
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
    const result = await setModuleAvailability(moduleId, body.state as AvailabilityState, reason, user?.userId);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return normalizeError(e);
  }
}
