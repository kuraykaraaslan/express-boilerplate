import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AiFirewallIncidentService from './ai_firewall.incident.service';
import { IncidentChangeDTO, IncidentIdParam } from './ai_firewall.incident.dto';

// One incident (docs/phases/55-ai-firewall/02 §2.4): its timeline (score history, explanation, the actor's events around it) and a
// person's acknowledge / resolve / reopen. A customer tenant: TENANT scope, `ai_firewall.incidents.read` to read, `.manage` to change.
// The root tenant's incidents are the platform's (D55-24): GLOBAL scope (the KD-13 admin gate), `ai_firewall.platform.read` to read and
// `ai_firewall.incidents.manage` to change. The incident id is checked as a uuid before the service, which reads it in the URL tenant
// only (another tenant's id is a 404). The body is strict and never names a tenant.

type Ctx = { params: Promise<{ tenantId: string; incidentId: string }> };

/** GET /tenant/[tenantId]/api/ai-firewall/incidents/[incidentId] */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    // A customer tenant's own rows at TENANT scope; the root tenant's are the platform's, behind GLOBAL scope (D55-24, D55-40).
    if (!isRootTenant(tenantId)) await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.incidents.read', scope: 'TENANT' });
    else await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.platform.read', scope: 'GLOBAL' });
    const id = IncidentIdParam.parse(incidentId);
    return NextResponse.json({ success: true, detail: await AiFirewallIncidentService.detail(tenantId, id) });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PATCH /tenant/[tenantId]/api/ai-firewall/incidents/[incidentId] { action: acknowledge | resolve | reopen, closeReason? } */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = isRootTenant(tenantId)
      ? await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.incidents.manage', scope: 'GLOBAL' })
      : await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.incidents.manage', scope: 'TENANT' });
    const id = IncidentIdParam.parse(incidentId);
    const change = IncidentChangeDTO.parse(await request.json());
    const result = await AiFirewallIncidentService.change(tenantId, id, change, user?.userId ?? null);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return normalizeError(e);
  }
}
