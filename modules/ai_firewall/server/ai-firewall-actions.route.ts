import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AiFirewallCatalogueService from './ai_firewall.catalogue.service';
import { ActionModeUpdateDTO } from './ai_firewall.catalogue.dto';

// The action catalogue and the mode per action (docs/phases/55-ai-firewall/01 §1.8): what the firewall may do through the owning modules
// and, for the URL tenant, whether each action is observed, suggested or run on its own. TENANT scope with `ai_firewall.actions.manage`
// (ADMIN floor) for the read and the write: the modes are that permission's (the kill switch too, on the settings page). On the root
// tenant the modes are the platform's, so the write there asks GLOBAL scope (D55-10). The body never names a tenant (strict DTO); the URL
// tenant is the one the guard bound.

/** GET /tenant/[tenantId]/api/ai-firewall/actions — the registered actions with the tenant's policy and mode for each. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.actions.manage', scope: 'TENANT' });
    return NextResponse.json({ success: true, catalogue: await AiFirewallCatalogueService.actions(tenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/ai-firewall/actions { actionId, mode: observe | suggest | auto | null, confirmAuto? } — one action's mode
 * (null = back to the tenant's default). Auto needs `confirmAuto: true` (the page asks in a ConfirmDialog first); 404 for an id nobody
 * registered, 409 for an action the tenant cannot choose or one a person must always approve.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    // D55-10: on the root tenant every mode is the platform's (installation-wide bans, any account's lock): the root super-admin behind the
    // KD-13 admin gate (IP allowlist + MFA), as the manual ban, lock and unlock routes ask. A customer tenant's admin at TENANT scope.
    const { user } = isRootTenant(tenantId)
      ? await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.actions.manage', scope: 'GLOBAL' })
      : await authorizeRequest({ request, tenantId, requiredPermission: 'ai_firewall.actions.manage', scope: 'TENANT' });
    const dto = ActionModeUpdateDTO.parse(await request.json());
    const change = await AiFirewallCatalogueService.setMode(tenantId, dto, user?.userId ?? null);
    return NextResponse.json({ success: true, change });
  } catch (e) {
    return normalizeError(e);
  }
}
