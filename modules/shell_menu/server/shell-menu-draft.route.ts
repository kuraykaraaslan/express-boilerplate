import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuService from './shell_menu.service';
import { SaveDraftBodySchema } from './shell_menu.dto';
import { LAYOUT_MANAGE_PERMISSION } from './shell_menu.messages';

/**
 * PUT /tenant/[tenantId]/api/shell-menu/draft   body { spec, labels, etag }
 * Save the whole draft; 409 with the current draft when another editor saved since `etag`.
 */
export async function PUT(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: LAYOUT_MANAGE_PERMISSION, scope: 'GLOBAL' });
    const body = SaveDraftBodySchema.parse(await request.json().catch(() => ({})));
    const draft = await ShellMenuService.saveDraft({ spec: body.spec, labels: body.labels }, body.etag, { userId: user.userId, via: 'ui' });
    return NextResponse.json({ success: true, draft });
  } catch (e) {
    return normalizeError(e);
  }
}

/** DELETE /tenant/[tenantId]/api/shell-menu/draft — throw the draft away. */
export async function DELETE(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: LAYOUT_MANAGE_PERMISSION, scope: 'GLOBAL' });
    return NextResponse.json({ success: true, ...(await ShellMenuService.discardDraft({ userId: user.userId, via: 'ui' })) });
  } catch (e) {
    return normalizeError(e);
  }
}
