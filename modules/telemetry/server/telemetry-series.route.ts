import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { TelemetrySeriesQueryDTO } from './telemetry.dto';
import { getTelemetryQueryService, TelemetryQueryError } from './telemetry.query.service';
import { readableKind } from './telemetry.read';

/**
 * GET /tenant/[tenantId]/api/telemetry/series?kind=&entityId=&keys=&from=&to=&bucket=&agg=&limit= — one series per key over a
 * window, from the source the window calls for (docs/phases/42-telemetry/02 §2.1–§2.2). A window over the bucket cap is 400.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'telemetry.read', scope: 'TENANT' });
    const parsed = TelemetrySeriesQueryDTO.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    const q = parsed.data;
    const kind = await readableKind({ tenantId, userId: user.userId, memberRole: tenantMember?.memberRole }, q.kind, q.entityId);
    if (!kind) return NextResponse.json({ message: 'Not found' }, { status: 404 });
    const service = getTelemetryQueryService();
    try {
      const series = await service.series(tenantId, q.kind, q.entityId, q.keys, { from: q.from, to: q.to, bucket: q.bucket, agg: q.agg, limit: q.limit });
      const resolution = q.bucket === 'auto' ? service.resolutionFor(q.from, q.to) : q.bucket;
      return NextResponse.json({ kind: q.kind, entityId: q.entityId, resolution, agg: q.agg, series }, { status: 200 });
    } catch (e) {
      if (e instanceof TelemetryQueryError) return NextResponse.json({ message: e.message, code: e.code }, { status: 400 });
      throw e;
    }
  } catch (e) {
    return normalizeError(e);
  }
}
