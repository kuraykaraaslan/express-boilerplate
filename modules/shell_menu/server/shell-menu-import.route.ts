import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import ShellMenuService from './shell_menu.service';
import { IMPORT_MAX_BYTES, ImportBodySchema } from './shell_menu.dto';
import { LAYOUT_MANAGE_PERMISSION } from './shell_menu.messages';

/**
 * POST /tenant/[tenantId]/api/shell-menu/import   body { file, target: draft | publish, write?, replace?, note? }
 * Without `write` a preview (what would change); with it, into the draft or published as a new revision; audited.
 */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: LAYOUT_MANAGE_PERMISSION, scope: 'GLOBAL' });
    const raw = await request.text();
    if (raw.length > IMPORT_MAX_BYTES) throw new AppError('The menu file is too large', 413, ErrorCode.VALIDATION_ERROR);
    let json: unknown = {};
    try { json = JSON.parse(raw || '{}'); } catch { throw new AppError('The body is not JSON', 400, ErrorCode.VALIDATION_ERROR); }
    const body = ImportBodySchema.parse(json);
    return NextResponse.json({ success: true, ...(await ShellMenuService.importFile(body, { userId: user.userId, via: 'ui' })) });
  } catch (e) {
    return normalizeError(e);
  }
}
