import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuService from './shell_menu.service';
import { PageQuerySchema } from './shell_menu.dto';
import { LAYOUT_READ_PERMISSION } from './shell_menu.messages';

/** GET /tenant/[tenantId]/api/shell-menu/revisions?page&pageSize — the published states, newest first. */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: LAYOUT_READ_PERMISSION, scope: 'GLOBAL' });
    const p = request.nextUrl.searchParams;
    const { page, pageSize } = PageQuerySchema.parse({ page: p.get('page') ?? undefined, pageSize: p.get('pageSize') ?? undefined });
    return NextResponse.json({ success: true, page, pageSize, ...(await ShellMenuService.revisions(page, pageSize)) });
  } catch (e) {
    return normalizeError(e);
  }
}
