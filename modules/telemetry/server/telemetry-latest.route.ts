import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { TelemetryLatestQueryDTO } from './telemetry.dto';
import { getTelemetryQueryService } from './telemetry.query.service';
import { readableKind } from './telemetry.read';

/**
 * GET /tenant/[tenantId]/api/telemetry/latest?kind=&entityId=&keys= — the latest value of each key of one entity
 * (docs/phases/42-telemetry/02 §2.2). `telemetry.read` opens the route; the kind's `canRead` decides the entity: a refused or
 * unknown one is 404, never a different answer from "does not exist".
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'telemetry.read', scope: 'TENANT' });
    const parsed = TelemetryLatestQueryDTO.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    const q = parsed.data;
    const kind = await readableKind({ tenantId, userId: user.userId, memberRole: tenantMember?.memberRole }, q.kind, q.entityId);
    if (!kind) return NextResponse.json({ message: 'Not found' }, { status: 404 });
    const latest = await getTelemetryQueryService().latest(tenantId, q.kind, q.entityId, q.keys);
    return NextResponse.json({ kind: q.kind, entityId: q.entityId, latest }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
