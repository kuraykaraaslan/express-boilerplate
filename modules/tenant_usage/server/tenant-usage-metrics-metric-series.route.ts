import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { TelemetryQueryError } from '@kuraykaraaslan-labs/telemetry/server/telemetry.query.service';
import { getMetricDeclaration } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.metrics';
import { usageSeries } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.telemetry';

const Query = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  bucket: z.enum(['auto', 'raw', '1m', '1h', '1d']).default('auto'),
});

/**
 * GET /tenant/[tenantId]/api/tenant-usage/metrics/[metric]/series (docs/phases/42-telemetry/06 step 4): the curve of one declared
 * metric over a window (default: the last 30 days) from the Core telemetry store. The period total and the quota beside it come from
 * `/api/tenant-usage/metrics` (the counters), never from here.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; metric: string }> }) {
  try {
    const { tenantId, metric } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_usage.metrics.read', scope: 'TENANT' });
    const decl = await getMetricDeclaration(metric);
    if (!decl) return NextResponse.json({ message: 'Unknown metric' }, { status: 404 });
    const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    const to = parsed.data.to?.getTime() ?? Date.now();
    const from = parsed.data.from?.getTime() ?? to - 30 * 86_400_000;
    try {
      const r = await usageSeries(tenantId, metric, { from, to, bucket: parsed.data.bucket });
      return NextResponse.json({ metric, label: decl.label, unit: decl.unit, period: decl.period, from, to, ...r });
    } catch (e) {
      if (e instanceof TelemetryQueryError) return NextResponse.json({ message: e.message, code: e.code }, { status: 400 });
      throw e;
    }
  } catch (e) {
    return normalizeError(e);
  }
}
