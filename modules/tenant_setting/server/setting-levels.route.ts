// path: app/tenant/[tenantId]/api/setting-levels/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest, grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { GetSettingLevelsQueryDTO, UpdateSettingLevelDTO } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.dto';
import { listSettingLevels, setSettingLevel, tenantSettingLevels } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.levels.service';

/**
 * The platform operator's setting levels (docs/phases/53-setting-levels, 53.3): where each module's provider keys come from,
 * the platform (ROOT) or the tenant, for the whole installation and per tenant. ROOT only: any other tenant gets 403 after the
 * guard, like every platform-level route.
 */
type Params = { params: Promise<{ tenantId: string }> };

const NOT_ROOT = 'Setting levels are platform-level and can only be read or changed in the root tenant.';
const UPDATE = 'tenant_setting.levels.update';
const invalid = (issues: Array<{ message: string }>) =>
  NextResponse.json({ success: false, message: issues.map((i) => i.message).join(', ') }, { status: 400 });

/**
 * GET /tenant/[ROOT]/api/setting-levels[?tenantId=<uuid>]
 * Every module with a setting level: its allowed levels, its default, the installation's choice and the per-tenant overrides.
 * With `tenantId`, also that tenant's resolved level for each module and where it comes from. `capabilities.canUpdate` tells the
 * screens whether to offer the change (the PDP's answer, a display; PUT judges again).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.levels.read', scope: 'TENANT' });
    if (!isRootTenant(tenantId)) return NextResponse.json({ success: false, message: NOT_ROOT }, { status: 403 });

    const parsed = GetSettingLevelsQueryDTO.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return invalid(parsed.error.issues);
    const modules = await listSettingLevels();
    const tenant = parsed.data.tenantId
      ? { tenantId: parsed.data.tenantId, levels: await tenantSettingLevels(parsed.data.tenantId) }
      : undefined;
    const granted = await grantedPermissions({
      request, tenantId, session: { user: auth.user, tenantMember: auth.tenantMember }, permissionIds: [UPDATE],
    });
    return NextResponse.json({ success: true, modules, ...(tenant ? { tenant } : {}), capabilities: { canUpdate: granted.has(UPDATE) } });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[ROOT]/api/setting-levels  { moduleId, level, tenantId? }
 * Sets a module's level for the installation, or for one tenant; `level: null` clears the choice. OWNER floor: the level
 * decides whose account a tenant's usage runs on and is billed to.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.levels.update', scope: 'TENANT' });
    if (!isRootTenant(tenantId)) return NextResponse.json({ success: false, message: NOT_ROOT }, { status: 403 });

    const parsed = UpdateSettingLevelDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error.issues);
    const state = await setSettingLevel(parsed.data, { actorId: user.userId });
    return NextResponse.json({ success: true, module: state });
  } catch (e) {
    return normalizeError(e);
  }
}
