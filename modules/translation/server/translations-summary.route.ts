import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import TranslationAdminService from './translation.admin.service';
import { SummaryQuerySchema } from './translation.admin.dto';
import { TEXTS_READ_PERMISSION } from './translation.messages';

/**
 * GET /tenant/[tenantId]/api/translations/summary?locale=bg
 * Root super-admin (GLOBAL): per module, the keys in the English source, the keys the code ships for
 * this language and the stored rows per platform. Shows how far a language is.
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: TEXTS_READ_PERMISSION, scope: 'GLOBAL' });
    const { locale } = SummaryQuerySchema.parse({ locale: request.nextUrl.searchParams.get('locale') ?? undefined });
    const modules = await TranslationAdminService.summary(locale);
    return NextResponse.json({ success: true, locale, modules });
  } catch (e) {
    return normalizeError(e);
  }
}
