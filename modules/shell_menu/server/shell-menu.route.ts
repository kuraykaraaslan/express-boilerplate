import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuService from './shell_menu.service';
import { LAYOUT_READ_PERMISSION } from './shell_menu.messages';

// The menu editor's API (docs/phases/54-menu-editor, 03): root super-admin behind the KD-13 gate (GLOBAL scope). The
// menu is system-wide, so the URL tenant is only where the dispatcher mounts the routes.

/** GET /tenant/[tenantId]/api/shell-menu — the published menu and the draft, each with its problems, and their stored texts. */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: LAYOUT_READ_PERMISSION, scope: 'GLOBAL' });
    return NextResponse.json({ success: true, ...(await ShellMenuService.state()) });
  } catch (e) {
    return normalizeError(e);
  }
}
