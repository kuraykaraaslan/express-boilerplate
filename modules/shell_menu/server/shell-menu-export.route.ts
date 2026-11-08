import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuService from './shell_menu.service';
import { LAYOUT_READ_PERMISSION } from './shell_menu.messages';

/** GET /tenant/[tenantId]/api/shell-menu/export — the published menu as one file, every language of its own texts. */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: LAYOUT_READ_PERMISSION, scope: 'GLOBAL' });
    return NextResponse.json({ success: true, file: await ShellMenuService.exportFile() });
  } catch (e) {
    return normalizeError(e);
  }
}
