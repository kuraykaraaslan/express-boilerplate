import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import AiFirewallActivityService from './ai_firewall.activity.service';

// The AI firewall's activity page (Platform -> AI firewall; docs/phases/55-ai-firewall): root super-admin behind the KD-13 gate
// (GLOBAL scope). It reads every tenant's security rows and the installation's address bans, so the URL tenant is only where the
// dispatcher mounts the route and decides nothing.

/** GET /tenant/[tenantId]/api/ai-firewall/activity — models, cascade mode, security activity across tenants and active bans. */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'ai_firewall.activity.read', scope: 'GLOBAL' });
    const activity = await AiFirewallActivityService.activity();
    return NextResponse.json({ success: true, activity });
  } catch (e) {
    return normalizeError(e);
  }
}
