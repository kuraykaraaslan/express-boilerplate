import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AiFirewallCatalogueService from './ai_firewall.catalogue.service';

// The signal catalogue (docs/phases/55-ai-firewall/01 §1.8): the kinds every installed module registered in `ai_firewall:signal`, with
// lanes, actor kinds, severity, weight and the personal-data class of each attribute. The registry is process-wide (no tenant's data), but
// the page is a tenant admin's, so the guard is the tenant's (TENANT scope, `ai_firewall.events.read`: the permission that reads the
// events these kinds describe).

/** GET /tenant/[tenantId]/api/ai-firewall/signals */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.events.read', scope: 'TENANT' });
    return NextResponse.json({ success: true, catalogue: await AiFirewallCatalogueService.signals() });
  } catch (e) {
    return normalizeError(e);
  }
}
