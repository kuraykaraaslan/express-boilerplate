import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ShellMenuLabelsService from './shell_menu.labels.service';
import { SuggestQuerySchema } from './shell_menu.dto';
import { LAYOUT_READ_PERMISSION } from './shell_menu.messages';

/**
 * GET /tenant/[tenantId]/api/shell-menu/suggest?en=Flows&languages=tr,bg — translations of an English label from keys
 * that already have exactly that English (docs/phases/54-menu-editor, 02 "Reusing existing translations").
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: LAYOUT_READ_PERMISSION, scope: 'GLOBAL' });
    const p = request.nextUrl.searchParams;
    const { en, languages } = SuggestQuerySchema.parse({ en: p.get('en') ?? '', languages: p.get('languages') ?? undefined });
    const codes = languages
      ? languages.split(',').map((c) => c.trim().toLowerCase()).filter((c) => /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(c)).slice(0, 40)
      : (await ShellMenuLabelsService.languages()).map((l) => l.code);
    return NextResponse.json({ success: true, ...(await ShellMenuLabelsService.suggest(en, codes)) });
  } catch (e) {
    return normalizeError(e);
  }
}
