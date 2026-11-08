import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/storage/usage
 * Return the tenant's storage quota summary.
 *
 * Response:
 * - usedBytes: bytes currently stored this month
 * - quotaBytes: plan storage quota in bytes (-1 = unlimited)
 * - remainingBytes: bytes still available (-1 = unlimited)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'storage.files.upload', scope: 'TENANT' });

    const summary = await StorageService.getUsageSummary(tenantId);

    return NextResponse.json(summary);
  } catch (e) {
    return normalizeError(e);
  }
}
