import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from './auth_abac.guard.next';
import AbacPolicyService from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.policy.service';
import { UpdatePolicyDTO } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { auditPolicyChange } from './auth_abac.policy-audit';
import { requireActionStepUpWhenEnrolled } from './auth_abac.step-up.next';

type Ctx = { params: Promise<{ tenantId: string; policyId: string }> };

/** GET /tenant/[tenantId]/api/auth_abac/policies/[policyId] — read one policy (admin). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, policyId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth_abac.policies.read', scope: 'TENANT' });
    return NextResponse.json({ policy: await AbacPolicyService.get(tenantId, policyId) }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PATCH /tenant/[tenantId]/api/auth_abac/policies/[policyId] — update a policy (admin). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, policyId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'auth_abac.policies.write', scope: 'TENANT' });

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = UpdatePolicyDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    // Phase 55 00.6: an access policy changes who may do what; edited under the administrator's step-up when they hold a factor.
    await requireActionStepUpWhenEnrolled(request, auth, { tenantId, purpose: 'auth_abac.policies.write', target: policyId });
    const policy = await AbacPolicyService.update(tenantId, policyId, parsed.data);
    await auditPolicyChange(tenantId, auth?.user?.userId, 'abac.policy.updated', policyId, { fields: Object.keys(parsed.data) });
    return NextResponse.json({ policy }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** DELETE /tenant/[tenantId]/api/auth_abac/policies/[policyId] — delete a policy (admin). */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, policyId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'auth_abac.policies.write', scope: 'TENANT' });
    await requireActionStepUpWhenEnrolled(request, auth, { tenantId, purpose: 'auth_abac.policies.write', target: policyId });
    await AbacPolicyService.remove(tenantId, policyId);
    await auditPolicyChange(tenantId, auth?.user?.userId, 'abac.policy.deleted', policyId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
