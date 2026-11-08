import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
// path: app/tenant/[tenantId]/api/settings/public/route.ts
import { NextRequest, NextResponse } from "next/server";
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import TenantService from '@kuraykaraaslan-labs/tenant/server/tenant.service';
import { TENANT_BRANDING_KEYS } from './tenant_branding.setting.keys'
import { PUBLIC_CACHE } from '@kuraykaraaslan-labs/common/server/utils/cacheHeaders'
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { installBrand } from '@kuraykaraaslan-labs/common/server/install-config/install-config.brand';
import { withInstallBrand } from './tenant_branding.install';

/**
 * GET /tenant/[tenantId]/api/settings/public
 * Public branding surface (MIS-04): the only consumer is
 * `use-tenant-branding.hook.ts`, so this endpoint's key set is exactly
 * TENANT_BRANDING_KEYS — no unrelated domain has ever used it — plus the
 * installation's sign-in texts. Keys the tenant and the root left empty carry
 * the installation's config/brand.ts (tenant_branding.install).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_branding.public.read', scope: 'GUEST' });
    const [settings, tenant] = await Promise.all([
      // tenant_branding.06 (fixed 2026-10-20): the tenant's customJs source is never served to anonymous callers; nothing on the
      // public side runs it (the admin shell does not either), and admins paste tokens into it.
      SettingService.getByKeys(tenantId, TENANT_BRANDING_KEYS.filter((k) => k !== 'customJs')),
      TenantService.getById(tenantId).catch(() => null),
    ]);
    const install = installBrand();
    return NextResponse.json({
      success: true,
      settings: {
        ...withInstallBrand(settings),
        ...(install.signInTitle ? { signInTitle: install.signInTitle } : {}),
        ...(install.signInSubtitle ? { signInSubtitle: install.signInSubtitle } : {}),
      },
      tenant: tenant ? { name: tenant.name } : null,
    }, { status: 200, headers: PUBLIC_CACHE.long });
  } catch (e) {
    return normalizeError(e);
  }
}
