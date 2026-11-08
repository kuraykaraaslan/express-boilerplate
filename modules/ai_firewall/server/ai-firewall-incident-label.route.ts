import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AiFirewallIncidentService from './ai_firewall.incident.service';
import { IncidentIdParam, IncidentLabelDTO } from './ai_firewall.incident.dto';

// A person's verdict on one incident (docs/phases/55-ai-firewall/03 §3.2, D55-78): true positive with its class, false positive, or
// unsure, written as the incident's label (source admin) in ai_firewall_labels and audited. Who may change an incident may label it
// (D55-40): a customer tenant at TENANT scope with `ai_firewall.incidents.manage`; the root tenant's incidents are the platform's, at
// GLOBAL scope (the KD-13 admin gate) with the same permission. The incident id is checked as a uuid before the service, which reads it in
// the URL tenant only (another tenant's id is a 404). The body is strict and never names a tenant, a person, a confidence or a source.

type Ctx = { params: Promise<{ tenantId: string; incidentId: string }> };

/** PUT /tenant/[tenantId]/api/ai-firewall/incidents/[incidentId]/label { verdict: true_positive, labelClass } | { verdict: false_positive | unsure } */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = isRootTenant(tenantId)
      ? await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.incidents.manage', scope: 'GLOBAL' })
      : await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.incidents.manage', scope: 'TENANT' });
    const id = IncidentIdParam.parse(incidentId);
    const input = IncidentLabelDTO.parse(await request.json());
    const result = await AiFirewallIncidentService.label(tenantId, id, input, user?.userId ?? null);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return normalizeError(e);
  }
}
