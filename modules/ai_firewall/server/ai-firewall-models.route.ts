import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { ModelOverrideDTO } from './ai_firewall.models.dto';
import { holdModel, releaseModel } from './promotion/ai_firewall.promotion.service';
import { modelPromotionView } from './promotion/ai_firewall.promotion-view';

// A ROOT owner's override of the automatic promotion gate (docs/phases/55-ai-firewall/04-tree-models.md 4.7, FWD-12, D55-112): hold a tree
// model in shadow (a promoted one is demoted at once) or release the hold (which promotes nothing; the next evaluation decides). The models
// are the platform's: GLOBAL scope (the KD-13 admin gate) with the ROOT membership role OWNER (a platform administrator's ADMIN role is not
// enough, as for the platform kill switch, D55-17), and `ai_firewall.actions.manage` (what the firewall may do). The URL tenant decides
// nothing. Audited by the service (`ai_firewall.model_held`, `.model_released`, `.model_demoted`).

/** PUT /tenant/[tenantId]/api/ai-firewall/models { model: behaviour | attack, action: hold | release, reason } */
export async function PUT(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({
      request, requiredPermission: 'ai_firewall.actions.manage', scope: 'GLOBAL', requiredTenantRole: 'OWNER',
    });
    const input = ModelOverrideDTO.parse(await request.json());
    const actorId = user?.userId ?? null;
    const result = input.action === 'hold'
      ? await holdModel(input.model, actorId, input.reason)
      : await releaseModel(input.model, actorId, input.reason);
    const now = Date.now();
    // `at`: the server's time of the change, so the page shows it until a read made after it arrives (the activity read is shared 25 s).
    return NextResponse.json({ success: true, changed: result.changed, at: new Date(now).toISOString(), model: modelPromotionView(result.record, now) });
  } catch (e) {
    return normalizeError(e);
  }
}
