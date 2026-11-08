import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { ensureTelemetryKindsLoaded, registeredTelemetryKinds } from './telemetry.kinds';
import { describeKind } from './telemetry.read';

/**
 * GET /tenant/[tenantId]/api/telemetry/kinds — the registered entity kinds and what each declares (docs/phases/42-telemetry/02 §2.2).
 * The catalogue only: which entities of a kind the caller may read is the kind's `canRead`, asked per entity by the other routes.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'telemetry.read', scope: 'TENANT' });
    await ensureTelemetryKindsLoaded();
    const kinds = registeredTelemetryKinds().map(describeKind).sort((a, b) => a.kind.localeCompare(b.kind));
    return NextResponse.json({ kinds }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
