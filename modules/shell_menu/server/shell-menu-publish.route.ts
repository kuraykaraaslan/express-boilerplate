import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuService from './shell_menu.service';
import { PublishBodySchema } from './shell_menu.dto';
import { LAYOUT_MANAGE_PERMISSION } from './shell_menu.messages';

/**
 * POST /tenant/[tenantId]/api/shell-menu/publish   body { baseRevision?, note? }
 * Publish the draft: the menu, a revision and the label texts in one transaction; audited.
 */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: LAYOUT_MANAGE_PERMISSION, scope: 'GLOBAL' });
    const body = PublishBodySchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ success: true, ...(await ShellMenuService.publish(body, { userId: user.userId, via: 'ui' })) });
  } catch (e) {
    return normalizeError(e);
  }
}
