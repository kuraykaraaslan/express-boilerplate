import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { maintenanceHtml, loadBranding } from '@kuraykaraaslan-labs/tenant/server/maintenance.gate';
import { MaintenanceModeEnum } from '@kuraykaraaslan-labs/tenant/server/maintenance.enums';

const MAINTENANCE_PERM = 'tenant.maintenance.manage';

const PreviewDTO = z.object({
  title: z.string().max(200).default(''),
  message: z.string().max(2000).optional(),
  scheduledEnd: z.coerce.date().optional(),
  mode: MaintenanceModeEnum.default('FULL'),
});

/**
 * POST /tenant/[tenantId]/api/maintenance-windows/preview → `{ success, data: { html } }`
 * Renders the EXACT downtime page (same `maintenanceHtml` the gate serves,
 * same branding read) for a draft window — see it before going live, without
 * going live. 200 on purpose: it is a preview, not an outage.
 *
 * JSON, not text/html (41-ui-fixes/09 B4.4): the console read the page as text, so an error body was a string too —
 * the toast lost the server's message and the client's 401 refresh check could not read it. The page is the `html`
 * field; the console writes it into the window it opened.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });

    const draft = PreviewDTO.parse(await request.json().catch(() => ({})));
    const branding = await loadBranding(tenantId);
    const html = maintenanceHtml({
      windowId: '00000000-0000-4000-8000-000000000000',
      tenantId,
      title: draft.title,
      message: draft.message ?? null,
      scope: 'TENANT',
      routePatterns: null,
      status: 'IN_PROGRESS',
      mode: draft.mode,
      percentage: null,
      scheduledStart: new Date(),
      scheduledEnd: draft.scheduledEnd ?? null,
      allowRoles: ['OWNER', 'ADMIN'],
    }, branding);

    return NextResponse.json({ success: true, data: { html } }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (e) {
    return normalizeError(e);
  }
}
