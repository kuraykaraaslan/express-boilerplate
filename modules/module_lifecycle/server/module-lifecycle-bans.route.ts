// path: app/tenant/[ROOT]/api/module-lifecycle/bans/route.ts  (system scope)
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { banModule, liftModuleBan, listModuleBans } from './module-lifecycle.bans';

const BanDTO = z.object({ moduleId: z.string().min(1).max(100), reason: z.string().trim().min(1).max(500) });

/** GET — the banned modules. Root admin only. */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'module_lifecycle.bans.manage', scope: 'GLOBAL' });
    return NextResponse.json({ items: await listModuleBans() });
  } catch (e) {
    return normalizeError(e);
  }
}

/** POST { moduleId, reason } — ban a module for every tenant at once (data kept). */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.bans.manage', scope: 'GLOBAL' });
    const dto = BanDTO.parse(await request.json());
    return NextResponse.json({ item: await banModule(dto.moduleId, dto.reason, user?.userId ?? null) }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}

/** DELETE ?moduleId= — lift a ban; each tenant gets back exactly what it had switched on. */
export async function DELETE(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.bans.manage', scope: 'GLOBAL' });
    const moduleId = request.nextUrl.searchParams.get('moduleId') ?? '';
    await liftModuleBan(moduleId, user?.userId ?? null);
    return NextResponse.json({ success: true });
  } catch (e) {
    return normalizeError(e);
  }
}
