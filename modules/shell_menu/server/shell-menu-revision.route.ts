import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuService from './shell_menu.service';
import { RevisionParamSchema } from './shell_menu.dto';
import { LAYOUT_READ_PERMISSION } from './shell_menu.messages';

type Ctx = { params: Promise<{ tenantId: string; revision: string }> };

/** GET /tenant/[tenantId]/api/shell-menu/revisions/[revision] — one revision's menu and label texts. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: LAYOUT_READ_PERMISSION, scope: 'GLOBAL' });
    const revision = RevisionParamSchema.parse((await params).revision);
    return NextResponse.json({ success: true, revision: await ShellMenuService.revision(revision) });
  } catch (e) {
    return normalizeError(e);
  }
}
