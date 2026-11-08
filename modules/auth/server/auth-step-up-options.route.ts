// path: app/tenant/[tenantId]/api/auth/step-up/options/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { BeginStepUpSchema } from './auth.step-up';
import { startStepUp } from './auth.step-up.service';

/**
 * Starts a step-up (P9-19): a single-use challenge for one purpose (the permission of the route that will ask for it, and
 * optionally its target), bound to this session and tenant, valid five minutes. Answers the methods the caller can use —
 * `webauthn` first, with the authenticator options, then `totp` — or 403 when the caller has none.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'auth');
    const session = await authorizeRequest({ request, tenantId, requiredPermission: 'auth.session.step_up', requiredTenantRole: 'USER', scope: 'TENANT' });
    const parsed = BeginStepUpSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('Invalid step-up request', 400, ErrorCode.VALIDATION_ERROR);
    return NextResponse.json(await startStepUp(session, { tenantId, ...parsed.data }));
  } catch (e) {
    return normalizeError(e);
  }
}
