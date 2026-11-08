import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from './auth_abac.guard.next';
import AbacPolicyService from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.policy.service';
import AbacPdpService from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.pdp.service';
import AbacSettingsService from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.settings.service';
import { explain } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.eval';
import { SimulateDTO } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.dto';
import type { AuthzRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.types';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/auth_abac/simulate — dry-run a decision (admin).
 * Evaluates against the tenant's live policy-set WITHOUT persisting or logging,
 * and returns the per-policy trace. When no policy applies, the same RBAC
 * fallback the PDP would use is surfaced so the final verdict is honest.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth_abac.simulate', scope: 'TENANT' });

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = SimulateDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }

    const req: AuthzRequest = {
      subject: parsed.data.subject,
      action: parsed.data.action,
      resource: parsed.data.resource,
      environment: parsed.data.environment,
    };

    const policies = await AbacPolicyService.loadSet(tenantId);
    const settings = await AbacSettingsService.getRuntimeSettings(tenantId);
    const { decision, trace } = explain(policies, req, { regexTimeoutMs: settings.regexTimeoutMs });

    // Mirror the PDP: not_applicable → RBAC fallback for the final verdict.
    const finalDecision =
      decision.reason === 'not_applicable'
        ? await AbacPdpService.resolveRbacFallback(tenantId, req, parsed.data.fallbackRole)
        : decision;

    return NextResponse.json({ decision: finalDecision, policyDecision: decision, trace }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
