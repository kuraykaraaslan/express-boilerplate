import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuCatalogService from './shell_menu.catalog.service';
import { LAYOUT_READ_PERMISSION } from './shell_menu.messages';

/**
 * GET /tenant/[tenantId]/api/shell-menu/catalog — every menu entry of this build, the workspaces and groups, the admin
 * pages a page link may name, the link kinds, the editor's languages and the built-in texts in each.
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: LAYOUT_READ_PERMISSION, scope: 'GLOBAL' });
    return NextResponse.json({ success: true, catalog: await ShellMenuCatalogService.catalog() });
  } catch (e) {
    return normalizeError(e);
  }
}
