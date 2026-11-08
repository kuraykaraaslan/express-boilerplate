import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import ApiKeyService from '@kuraykaraaslan-labs/api_key/server/api_key.service';
import ApiKeyMessages from '@kuraykaraaslan-labs/api_key/server/api_key.messages';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/api-keys/revoke-all
 * Emergency incident-response endpoint — instantly deactivates every active
 * API key for the tenant and flushes their caches (ADMIN+).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.revoke_all', scope: 'TENANT' });

    const revokedCount = await ApiKeyService.revokeAll(tenantId, user.userId);
    return NextResponse.json({ message: ApiKeyMessages.REVOKE_ALL_SUCCESS, revokedCount }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
