import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { isPrivilegedScope } from '@kuraykaraaslan-labs/api_key/server/api_key.enums';
import ApiKeyService from '@kuraykaraaslan-labs/api_key/server/api_key.service';
import { RotateApiKeyDTO } from '@kuraykaraaslan-labs/api_key/server/api_key.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { noteDecoyRecordTouch } from '@kuraykaraaslan-labs/api_key/server/api_key.decoy';

/**
 * POST /tenant/[tenantId]/api/api-keys/[apiKeyId]/rotate
 * Mint a successor key and grace-expire the current one (ADMIN+).
 * Returns the new rawKey only once — must be copied immediately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; apiKeyId: string }> },
) {
  try {
    const { tenantId, apiKeyId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.rotate', scope: 'TENANT' });
    const { user, tenantMember } = auth;
    // Phase 55 02.5: the canary key id is a critical signal about the caller; the answer stays the missing key's 404.
    noteDecoyRecordTouch(request, tenantId, apiKeyId, auth);

    const body = await request.json().catch(() => ({}));
    const parsed = RotateApiKeyDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    // Rotating hands the caller a fresh secret with the SAME scopes, so an admin / SCIM write key is an OWNER act here too
    // (F.api_key.01, fixed 2026-10-20).
    const existing = await ApiKeyService.getById(tenantId, apiKeyId);
    if ((existing?.scopes ?? []).some((s: string) => isPrivilegedScope(s)) && tenantMember?.memberRole !== 'OWNER') {
      return NextResponse.json({ message: 'Only the workspace owner can rotate an admin or SCIM write key' }, { status: 403 });
    }
    const { key, rawKey } = await ApiKeyService.rotate(tenantId, apiKeyId, user.userId, parsed.data);
    return NextResponse.json({ key, rawKey }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
