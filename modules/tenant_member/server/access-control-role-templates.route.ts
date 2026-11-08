import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { listRoleTemplates, createRoleFromTemplate } from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.templates';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';

type Ctx = { params: Promise<{ tenantId: string }> };

/** GET /api/access-control/role-templates: ready-made groups for this tenant's enabled modules. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });
    const templates = await listRoleTemplates(tenantId);
    return NextResponse.json({ templates }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

const Body = z.object({ templateKey: z.string().min(1).max(64) });

/**
 * POST /api/access-control/role-templates: create the tenant's own custom group
 * from a template. Same permission and OWNER rule as creating a group by hand.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: 'members.settings', scope: 'TENANT' });
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ message: 'templateKey is required' }, { status: 400 });
    const role = await createRoleFromTemplate(tenantId, parsed.data.templateKey, {
      isOwner: tenantMember.memberRole === 'OWNER',
      actorId: user.userId,
    });
    return NextResponse.json({ role }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
