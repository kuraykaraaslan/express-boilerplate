// path: app/tenant/[tenantId]/api/admin-settings/pages/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { openAdminPages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.page-access.next';

/** The hub asks about its own cards: a bounded list of admin paths. */
const MAX_PATHS = 50;
// `/admin` and its segments; a `.` or `..` segment is no page.
const PathsDTO = z.array(z.string().max(200).regex(/^\/admin(\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~-]+)*$/, 'Each path must be an admin path'))
  .min(1).max(MAX_PATHS);

/**
 * GET /tenant/[tenantId]/api/admin-settings/pages?path=/admin/settings/billing&path=...
 *
 * Which of the given admin pages the caller may open, by the admin renderer's own check (placement, module activation,
 * the page guard with config/access.ts): the settings hub shows a card only for these, so a page that would answer
 * not-found has no card. Guarded by the hub's own permission; answers only about pages, never their content.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.read', scope: 'TENANT' });

    const parsed = PathsDTO.safeParse(request.nextUrl.searchParams.getAll('path'));
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    const open = await openAdminPages({ request, tenantId, auth, paths: parsed.data });
    return NextResponse.json({ success: true, open });
  } catch (e) {
    return normalizeError(e);
  }
}
