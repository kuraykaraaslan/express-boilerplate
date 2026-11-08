import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AiFirewallIncidentService from './ai_firewall.incident.service';

// The incident list (docs/phases/55-ai-firewall/02 §2.4): the URL tenant's incidents, the newest activity first. A customer tenant's
// admin at TENANT scope with `ai_firewall.incidents.read`: its own people, sessions, keys and devices. On the root tenant the rows are
// the platform's (addresses across tenants, anonymous callers, root actors: D55-24, FWO-5 open), so the read asks GLOBAL scope with
// `ai_firewall.platform.read` (the KD-13 admin gate), as the platform's modes do (D55-10). The query never names a tenant.

/** GET /tenant/[tenantId]/api/ai-firewall/incidents */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    // A customer tenant's own rows at TENANT scope; the root tenant's are the platform's, behind GLOBAL scope (D55-24, D55-40).
    if (!isRootTenant(tenantId)) await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.incidents.read', scope: 'TENANT' });
    else await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.platform.read', scope: 'GLOBAL' });
    return NextResponse.json({ success: true, list: await AiFirewallIncidentService.list(tenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
