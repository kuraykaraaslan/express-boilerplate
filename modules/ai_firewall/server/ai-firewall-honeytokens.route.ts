import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AiFirewallHoneytokenService from './ai_firewall.honeytoken.service';

// The canary list (docs/phases/55-ai-firewall/02 §2.5): the decoys installed modules registered, with the URL tenant's reference and bait
// for each (the decoy key, the canary record ids, the trap paths). The only place a decoy is shown, so it asks the permission that decides
// what the firewall does here (`ai_firewall.actions.manage`, TENANT scope, the catalogue page's), and the answer is never cached.

/** GET /tenant/[tenantId]/api/ai-firewall/honeytokens */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.actions.manage', scope: 'TENANT' });
    const catalogue = await AiFirewallHoneytokenService.decoys(tenantId);
    return NextResponse.json({ success: true, catalogue }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}
