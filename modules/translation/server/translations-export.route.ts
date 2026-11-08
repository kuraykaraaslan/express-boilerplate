import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import TranslationAdminService from './translation.admin.service';
import { ExportQuerySchema } from './translation.admin.dto';
import { TEXTS_READ_PERMISSION } from './translation.messages';

/**
 * GET /tenant/[tenantId]/api/translations/export?locale=bg&platform=shared
 * Root super-admin (GLOBAL): the stored texts of one language and platform as a flat map, the shape
 * the import accepts back.
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: TEXTS_READ_PERMISSION, scope: 'GLOBAL' });
    const p = request.nextUrl.searchParams;
    const { locale, platform } = ExportQuerySchema.parse({ locale: p.get('locale') ?? undefined, platform: p.get('platform') ?? undefined });
    const messages = await TranslationAdminService.exportMessages(locale, platform);
    return NextResponse.json({ success: true, locale, platform, messages });
  } catch (e) {
    return normalizeError(e);
  }
}
