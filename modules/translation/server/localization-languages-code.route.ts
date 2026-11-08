import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import TranslationLanguagesService from './translation.languages.service';
import TranslationReadService from './translation.read.service';
import { LocaleSchema } from './translation.dto';
import { BundleRequestSchema } from './translation.routes.dto';
import { toStoredPlatform } from './translation.platform';
import { isMobileModule } from './translation.mobile-source';
import { READ_PUBLIC_PERMISSION, TranslationMessages as M } from './translation.messages';

type Ctx = { params: Promise<{ tenantId: string; code: string }> };

/**
 * POST /tenant/[tenantId]/api/localization/languages/[code]   body { platform, module }
 *
 * Guest. One module's stored texts in one language for one platform:
 *   { code, version, platform, module, messages: { "<module>.<area>.<slug>": "text" } }
 * `code` and `platform` are echoed exactly as the client sent them: the app validates
 * the bundle against what it asked for, and the internal `mobile` must never leak out.
 * `messages` holds only the stored rows (shared rows with the platform's rows over
 * them); the app lays them over its own bundled dictionaries. A module with no rows
 * answers `{ version: "0-0", messages: {} }`.
 *
 * The language must be enabled for the tenant and the module must exist (on android/ios,
 * be one the mobile app reads, as the language list names): both bound the set of cache
 * keys a guest can make the server fill.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, code } = await params;
    await Limiter.checkRateLimit(request, 'i18n');
    await authorizeRequest({ request, tenantId, requiredPermission: READ_PUBLIC_PERMISSION, scope: 'GUEST' });

    const locale = LocaleSchema.parse(code);
    const body = BundleRequestSchema.parse(await request.json().catch(() => ({})));
    const platform = toStoredPlatform(body.platform);
    if (!moduleRegistry.getModule(body.module) || (platform === 'mobile' && !isMobileModule(body.module))) {
      throw new AppError(M.UNKNOWN_MODULE, 404, ErrorCode.NOT_FOUND);
    }
    if (!(await TranslationLanguagesService.isEnabled(tenantId, locale))) {
      throw new AppError(M.LANGUAGE_NOT_ENABLED, 404, ErrorCode.NOT_FOUND);
    }

    const { version, messages } = await TranslationReadService.getBundle(locale, body.module, platform);
    return NextResponse.json({ code, version, platform: body.platform, module: body.module, messages });
  } catch (e) {
    return normalizeError(e);
  }
}
