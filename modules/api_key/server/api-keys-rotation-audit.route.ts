import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import ApiKeyReportService from '@kuraykaraaslan-labs/api_key/server/api_key.report.service';
import { ReportRangeDTO } from '@kuraykaraaslan-labs/api_key/server/api_key.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/api-keys/rotation-audit?from=&to=
 * Key rotations, grace windows and successor tracking (ADMIN+).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.reports.read', scope: 'TENANT' });
    const sp = new URL(request.url).searchParams;
    const parsed = ReportRangeDTO.parse({
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
    });
    const report = await ApiKeyReportService.getRotationAudit(tenantId, {
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    });
    return NextResponse.json(report);
  } catch (e) {
    return normalizeError(e);
  }
}
