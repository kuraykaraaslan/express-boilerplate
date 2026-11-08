import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import ApiKeyService from '@kuraykaraaslan-labs/api_key/server/api_key.service';
import type { ApiKeyScope } from '@kuraykaraaslan-labs/api_key/server/api_key.enums';

/**
 * POST /tenant/[tenantId]/api/api-keys/verify
 * Verify an API key from the x-api-key header.
 * Used by external integrations to validate keys before processing requests.
 * This endpoint itself is public (no session auth) — the key IS the auth.
 */
/**
 * api_key.04 (fixed 2026-10-20): a refusal of the key itself (unknown, inactive, expired, wrong tenant, scope, IP) is one identical
 * 401 body, so a holder of a stale or partial key cannot tell which condition failed; a rate limit is a 429; an infrastructure
 * failure (database, settings) is a generic 503, never a 401 that tells an integration to drop a valid key, and never driver text.
 * The success body leaves out the key's allowlist, last-used address and creator.
 */
const INVALID = { valid: false, message: 'Invalid or expired API key.' };

function publicKey(key: Record<string, unknown>) {
  const { ipAllowlist: _a, lastUsedIp: _b, createdByUserId: _c, keyHash: _d, ...rest } = key;
  return rest;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { tenantId } = await params;
    const rawKey = request.headers.get('x-api-key');
    if (!rawKey) return NextResponse.json(INVALID, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const scope = (body as { scope?: unknown } | null)?.scope;
    if (scope !== undefined && scope !== null && typeof scope !== 'string') {
      return NextResponse.json({ valid: false, message: 'scope must be a string' }, { status: 400 });
    }

    let key;
    try {
      // Pinned to the URL tenant: a key of another tenant is refused before its rate limit or its row is touched.
      key = await ApiKeyService.verify(rawKey, (scope ?? undefined) as ApiKeyScope | undefined, { ip: Limiter.getIpFromRequest(request), tenantId });
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 401 || status === 403) return NextResponse.json(INVALID, { status: 401 });
      if (status === 429) return NextResponse.json({ valid: false, message: 'Too many requests.' }, { status: 429 });
      return NextResponse.json({ valid: false, message: 'Service unavailable' }, { status: 503 });
    }

    // The second line, against a verifier that does not pin.
    if (key.tenantId !== tenantId) return NextResponse.json(INVALID, { status: 401 });
    return NextResponse.json({ valid: true, key: publicKey(key as unknown as Record<string, unknown>) }, { status: 200 });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 429) return NextResponse.json({ valid: false, message: 'Too many requests.' }, { status: 429 });
    return NextResponse.json({ valid: false, message: 'Service unavailable' }, { status: 503 });
  }
}
