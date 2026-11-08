import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import TranslationLanguagesService from './translation.languages.service';
import { LanguagesQuerySchema } from './translation.routes.dto';
import { toScope } from './translation.platform';
import { READ_PUBLIC_PERMISSION } from './translation.messages';

type Ctx = { params: Promise<{ tenantId: string }> };

/**
 * GET /tenant/[tenantId]/api/localization/languages?platform=android|ios|web
 *
 * Guest (the login screen is translated before sign-in). The languages the app can
 * switch to, each with the version of every module's stored texts for that platform:
 *   { languages: [{ code, name, flag, versions: { <module>: "<version>" } }] }
 * No `platform` = versions over every row, so the app may download more but never
 * misses a change. Rate-limited on the `i18n` counter, never the app's `api` budget.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'i18n');
    await authorizeRequest({ request, tenantId, requiredPermission: READ_PUBLIC_PERMISSION, scope: 'GUEST' });

    const { platform } = LanguagesQuerySchema.parse({ platform: request.nextUrl.searchParams.get('platform') ?? undefined });
    const languages = await TranslationLanguagesService.list(tenantId, toScope(platform));
    return NextResponse.json({ languages });
  } catch (e) {
    return normalizeError(e);
  }
}
