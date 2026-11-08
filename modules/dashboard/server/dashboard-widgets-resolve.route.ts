import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { resolveWorkspaceWidgets, widgetLabelModules } from './widget-catalog.service';
import { requestLabelTexts } from './contributed-label-texts';

type Ctx = { params: Promise<{ tenantId: string }> };

/**
 * GET …/dashboard/widgets/resolve?workspace=<id> — the widgets this caller may see
 * on that workspace dashboard, already permission-filtered.
 *
 * The dashboard is a permission-gated LIST, and the browser cannot filter one: it
 * has no permission context and there is no effective-permissions endpoint. So the
 * page asks the server what to render instead of rendering everything the manifest
 * declares. `scope` mirrors what the page did before — the root tenant sees system
 * and tenant contributions, everyone else only tenant ones.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({
      request,
      tenantId,
      requiredPermission: 'dashboard.boards.read',
      scope: 'TENANT',
    });

    const workspace = new URL(request.url).searchParams.get('workspace') ?? undefined;
    const widgets = await resolveWorkspaceWidgets({
      request,
      tenantId,
      session: { user: auth.user, tenantMember: auth.tenantMember },
      workspace,
      scope: isRootTenant(tenantId) ? undefined : 'tenant',
      enabledIds: await getEnabledModuleIds(tenantId),
      // D551: the widgets' names in the workspace's language
      labels: await requestLabelTexts(request, tenantId, widgetLabelModules()),
    });

    return NextResponse.json({ widgets });
  } catch (e) {
    return normalizeError(e);
  }
}
