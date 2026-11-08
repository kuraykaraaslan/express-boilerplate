import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import TranslationAdminService from './translation.admin.service';
import { ModuleQuerySchema, RemoveBodySchema, SaveBodySchema } from './translation.admin.dto';
import { TEXTS_MANAGE_PERMISSION, TEXTS_READ_PERMISSION } from './translation.messages';

// System-level admin of the stored texts: root super-admin behind the KD-13 gate (GLOBAL scope).
// The texts are system-wide, so the URL tenant is only where the dispatcher mounts this.

/**
 * GET /tenant/[tenantId]/api/translations?locale=bg&module=auth&q=
 * Every key of one module in one language: English source, dictionary in code, stored texts.
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: TEXTS_READ_PERMISSION, scope: 'GLOBAL' });
    const p = request.nextUrl.searchParams;
    const query = ModuleQuerySchema.parse({ locale: p.get('locale') ?? undefined, module: p.get('module') ?? undefined, q: p.get('q') ?? undefined });
    const items = await TranslationAdminService.moduleKeys(query.locale, query.module, query.q);
    return NextResponse.json({ success: true, locale: query.locale, module: query.module, items });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/translations   body { entries: [{ locale, module, platform, key, value }] }
 * Store texts, one transaction; `platform` is shared | web | mobile.
 */
export async function PUT(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: TEXTS_MANAGE_PERMISSION, scope: 'GLOBAL' });
    const { entries } = SaveBodySchema.parse(await request.json().catch(() => ({})));
    const result = await TranslationAdminService.save(entries, { userId: user.userId, via: 'api' });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/translations   body { refs: [{ locale, module, platform, key }] }
 * Delete texts, one transaction; the dictionary in code shows through again.
 */
export async function DELETE(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: TEXTS_MANAGE_PERMISSION, scope: 'GLOBAL' });
    const { refs } = RemoveBodySchema.parse(await request.json().catch(() => ({})));
    const result = await TranslationAdminService.remove(refs, { userId: user.userId, via: 'api' });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return normalizeError(e);
  }
}
