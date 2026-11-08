import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from './auth_abac.guard.next';
import AbacPolicyService from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.policy.service';
import { CreatePolicyDTO, ListPoliciesQuery } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { auditPolicyChange } from './auth_abac.policy-audit';
import { requireActionStepUpWhenEnrolled } from './auth_abac.step-up.next';

/** GET /tenant/[tenantId]/api/auth_abac/policies — list policies (admin). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth_abac.policies.read', scope: 'TENANT' });

    const { searchParams } = new URL(request.url);
    // Empty params are left out so the defaults apply.
    const parsed = ListPoliciesQuery.safeParse(Object.fromEntries([...searchParams].filter(([, v]) => v !== '')));
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(await AbacPolicyService.list(tenantId, parsed.data), { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** POST /tenant/[tenantId]/api/auth_abac/policies — create a policy (admin). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'auth_abac.policies.write', scope: 'TENANT' });

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = CreatePolicyDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    // Phase 55 00.6: a new access policy is written under the administrator's step-up when they hold a factor.
    await requireActionStepUpWhenEnrolled(request, auth, { tenantId, purpose: 'auth_abac.policies.write' });
    const policy = await AbacPolicyService.create(tenantId, parsed.data);
    const created = policy as { policyId?: string; name?: string } | null | undefined;
    await auditPolicyChange(tenantId, auth?.user?.userId, 'abac.policy.created', created?.policyId ?? '', { name: created?.name ?? null });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
