import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import ApiKeyService from '@kuraykaraaslan-labs/api_key/server/api_key.service';
import { CreateApiKeyDTO, ListApiKeysDTO } from '@kuraykaraaslan-labs/api_key/server/api_key.dto';
import { isPrivilegedScope } from '@kuraykaraaslan-labs/api_key/server/api_key.enums';
import { heldPermissions } from '@kuraykaraaslan-labs/api_key/server/api_key.grant.next';
import ApiKeyMessages from '@kuraykaraaslan-labs/api_key/server/api_key.messages';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { requireActionStepUpWhenEnrolled } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.step-up.next';

/**
 * GET /tenant/[tenantId]/api/api-keys
 * List API keys for a tenant (ADMIN+)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.read', scope: 'TENANT' });

    // Empty params are left out so the defaults apply.
    const parsed = ListApiKeysDTO.safeParse({
      ...Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== '')),
      tenantId,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    const [{ keys, total }, reviewCount] = await Promise.all([ApiKeyService.list(parsed.data), ApiKeyService.countForReview(tenantId)]);
    // Phase 48 (D13): every key is shown with the member who owns it (an email; a person who left the tenant is not named),
    // and a service key also with the OWNER who marked it (the member it acts as once its creator left, D48-2).
    const owners = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service')
      .then((m) => m.memberLabels(tenantId, keys.flatMap((k) => (k.isServiceKey && k.serviceKeyMarkedByUserId ? [k.createdByUserId, k.serviceKeyMarkedByUserId] : [k.createdByUserId]))))
      .catch(() => ({}));
    // Phase 48 (D14): the active keys an admin should narrow (the banner).
    return NextResponse.json({ keys, data: keys, total, owners, reviewCount }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/api-keys
 * Create a new API key (ADMIN+)
 * Returns rawKey only once — must be copied immediately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'api_key.keys.create', scope: 'TENANT' });
    const { user, tenantMember } = auth;
    // Review fix: a key minted during an impersonation would be stored as the member's and act as them for up to a year after
    // the impersonation ends.
    if (auth.isImpersonating) return NextResponse.json({ message: ApiKeyMessages.NOT_WHILE_IMPERSONATING }, { status: 422 });

    const body = await request.json();
    const parsed = CreateApiKeyDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    // F.api_key.01 (fixed 2026-10-20): nobody below OWNER mints a credential more powerful than themselves.
    if (parsed.data.scopes.some(isPrivilegedScope) && tenantMember?.memberRole !== 'OWNER') {
      return NextResponse.json({ message: 'Only the workspace owner can create an admin or SCIM write key' }, { status: 403 });
    }

    // Phase 48 (D12): the module permissions asked for must be the creator's own, now.
    const held = await heldPermissions(request, tenantId, auth, parsed.data.permissions);
    // Phase 55 00.6: a new credential is minted under the creator's step-up when they hold a factor (an API-key caller is a
    // machine lane and is not asked, L-4), after every refusal above and before the key exists.
    await requireActionStepUpWhenEnrolled(request, auth, { tenantId, purpose: 'api_key.keys.create' });
    const { key, rawKey } = await ApiKeyService.create(tenantId, user.userId, parsed.data, { heldPermissions: held });

    return NextResponse.json({ key, rawKey }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
