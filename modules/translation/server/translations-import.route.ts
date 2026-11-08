import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import TranslationAdminService from './translation.admin.service';
import { ImportBodySchema } from './translation.admin.dto';
import { TEXTS_MANAGE_PERMISSION } from './translation.messages';

/**
 * POST /tenant/[tenantId]/api/translations/import   body { locale, platform?, messages, write? }
 * Root super-admin (GLOBAL): import a flat `{ key: text }` map into one language and platform.
 * Without `write: true` it is a preview (new / changed / unchanged / invalid) and nothing is stored.
 */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: TEXTS_MANAGE_PERMISSION, scope: 'GLOBAL' });
    const body = ImportBodySchema.parse(await request.json().catch(() => ({})));
    const report = await TranslationAdminService.importMessages(body, { userId: user.userId, via: 'api' });
    return NextResponse.json({ success: true, report });
  } catch (e) {
    return normalizeError(e);
  }
}
