import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AiFirewallIncidentService from './ai_firewall.incident.service';
import { ActorQueryDTO } from './ai_firewall.incident.dto';

// The actor view (docs/phases/55-ai-firewall/02 §2.4): one actor's incidents and its stored events of the last days, reached from an
// incident. It shows the actor's events (who did what, from which address and device), so a customer tenant asks TENANT scope with
// `ai_firewall.events.read`; the root tenant's actors are the platform's (D55-24): GLOBAL scope with `ai_firewall.platform.read`. An
// address or anonymous caller is viewed on the root tenant only (the service refuses it elsewhere). The query is strict (`kind`, `id`).

/** GET /tenant/[tenantId]/api/ai-firewall/actors?kind=<actor kind>&id=<actor id> */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    // A customer tenant's own rows at TENANT scope; the root tenant's are the platform's, behind GLOBAL scope (D55-24, D55-40).
    if (!isRootTenant(tenantId)) await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.events.read', scope: 'TENANT' });
    else await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.platform.read', scope: 'GLOBAL' });
    const query = ActorQueryDTO.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    return NextResponse.json({ success: true, actor: await AiFirewallIncidentService.actor(tenantId, query.kind, query.id) });
  } catch (e) {
    return normalizeError(e);
  }
}
