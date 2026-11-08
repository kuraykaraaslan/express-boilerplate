import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { catalogPages } from './shell_menu.catalog.service';
import { linkTargetProviders } from './shell_menu.links';
import { LinkTargetsQuerySchema } from './shell_menu.dto';
import { LAYOUT_READ_PERMISSION, ShellMenuMessages as M } from './shell_menu.messages';

/** GET /tenant/[tenantId]/api/shell-menu/link-targets?kind&q — targets for a link's picker: admin pages, or a contributor's suggestions. */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: LAYOUT_READ_PERMISSION, scope: 'GLOBAL' });
    const p = request.nextUrl.searchParams;
    const { kind, q } = LinkTargetsQuerySchema.parse({ kind: p.get('kind') ?? '', q: p.get('q') ?? undefined });
    const needle = q.toLowerCase();
    if (kind === 'page') {
      const items = catalogPages().filter((r) => !needle || r.path.includes(needle)).slice(0, 50)
        .map((r) => ({ target: r.path, label: r.path, hint: r.moduleId }));
      return NextResponse.json({ success: true, items });
    }
    const provider = (await linkTargetProviders()).get(kind);
    if (!provider) throw new AppError(M.UNKNOWN_LINK_KIND, 404, ErrorCode.NOT_FOUND);
    const items = (await provider.suggest(q)).slice(0, 50);
    return NextResponse.json({ success: true, items });
  } catch (e) {
    return normalizeError(e);
  }
}
