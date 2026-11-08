import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import ApiKeyService from '@kuraykaraaslan-labs/api_key/server/api_key.service';
import { UpdateApiKeyDTO } from '@kuraykaraaslan-labs/api_key/server/api_key.dto';
import { heldPermissions } from '@kuraykaraaslan-labs/api_key/server/api_key.grant.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { noteDecoyRecordTouch } from '@kuraykaraaslan-labs/api_key/server/api_key.decoy';

// Phase 55 02.5: the tenant's canary key id (api_key.decoy.ts) is no row and no page lists it; asking for it here is a critical signal about
// the caller (noteDecoyRecordTouch, synchronous and never throwing), and the answer is the missing key's 404 the service gives anyway.

/**
 * GET /tenant/[tenantId]/api/api-keys/[apiKeyId]
 * Fetch a single API key plus its rotation lineage (ADMIN+).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; apiKeyId: string }> },
) {
  try {
    const { tenantId, apiKeyId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.read', scope: 'TENANT' });
    noteDecoyRecordTouch(request, tenantId, apiKeyId, auth);

    const { key, successor, predecessors } = await ApiKeyService.getLineage(tenantId, apiKeyId);
    // Phase 48 (D13): the member who owns the key, by email (absent once they left the tenant).
    const owners = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service')
      .then((m) => m.memberLabels(tenantId, [key.createdByUserId, key.serviceKeyMarkedByUserId]))
      .catch(() => ({}));
    return NextResponse.json({ key, successor, predecessors, owners }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/api-keys/[apiKeyId]
 * Update API key name, description, or active status (ADMIN+)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; apiKeyId: string }> },
) {
  try {
    const { tenantId, apiKeyId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.update', scope: 'TENANT' });
    noteDecoyRecordTouch(request, tenantId, apiKeyId, auth);

    const body = await request.json();
    const parsed = UpdateApiKeyDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    // Phase 48 (D12): a permission added to the key must be the editor's own, now (the service checks only the added ones).
    const held = await heldPermissions(request, tenantId, auth, parsed.data.permissions ?? []);
    const key = await ApiKeyService.update(tenantId, apiKeyId, parsed.data, auth.user?.userId, { heldPermissions: held });
    return NextResponse.json({ key }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/api-keys/[apiKeyId]
 * Permanently revoke an API key (ADMIN+)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; apiKeyId: string }> },
) {
  try {
    const { tenantId, apiKeyId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.delete', scope: 'TENANT' });
    const { user } = auth;
    noteDecoyRecordTouch(request, tenantId, apiKeyId, auth);

    await ApiKeyService.delete(tenantId, apiKeyId, user?.userId);
    return NextResponse.json({ message: 'API key revoked successfully.' }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
