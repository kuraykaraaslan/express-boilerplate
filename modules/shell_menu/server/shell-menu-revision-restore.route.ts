import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuService from './shell_menu.service';
import { RevisionParamSchema } from './shell_menu.dto';
import { LAYOUT_MANAGE_PERMISSION } from './shell_menu.messages';

type Ctx = { params: Promise<{ tenantId: string; revision: string }> };

/** POST /tenant/[tenantId]/api/shell-menu/revisions/[revision]/restore — publish that revision again, as a new one; audited. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: LAYOUT_MANAGE_PERMISSION, scope: 'GLOBAL' });
    const revision = RevisionParamSchema.parse((await params).revision);
    return NextResponse.json({ success: true, ...(await ShellMenuService.restore(revision, { userId: user.userId, via: 'ui' })) });
  } catch (e) {
    return normalizeError(e);
  }
}
