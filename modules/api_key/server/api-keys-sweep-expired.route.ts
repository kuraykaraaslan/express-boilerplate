import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import ApiKeyService from '@kuraykaraaslan-labs/api_key/server/api_key.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/api-keys/sweep-expired
 * Deactivate any keys past their expiry that are still flagged active and emit
 * `api_key.expired` webhooks (ADMIN+). Intended to be hit by a scheduled job;
 * verification already rejects expired keys at request time, so this is about
 * state hygiene and notifying webhook consumers.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.sweep', scope: 'TENANT' });

    const sweptCount = await ApiKeyService.sweepExpired(tenantId);
    return NextResponse.json({ sweptCount }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
