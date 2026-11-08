// path: app/tenant/[tenantId]/api/admin-settings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest, grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import {
  UpdateSettingsDTO,
  GetSettingsResponseDTO,
  UpdateSettingsResponseDTO,
  SettingLevelDTO,
} from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { assertIpListWriteKeepsWriter } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.ip-lists';
import { assertTwoFactorWriteKeepsWriter } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.two-factor';
import { isCredentialIdentifierKey, maskSecrets } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.validation';
import { assertDeclaredSettingKeys, isInternalSettingKey, PLATFORM_ONLY_SETTING_KEYS, withoutInternalKeys } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.key-policy';
import { getInheritedFromRoot, getSettingLevelsView } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.read.service';
import { levelFollowOf, selectableLevelModules } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.levels';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { assertOwnedKeysWritable, withoutUnreadableOwnedKeys } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.key-owners.next';

// 04-tenant-setting 1.2: the answer also carries what the tenant inherits from ROOT, so a form can show the effective value.
// Phase 53.6: and the setting levels its pages show (a tenant), or the modules whose level the operator can choose (ROOT); and what the
// caller may do here (ui-fixes: the page hides Save for a reader).
const GetAdminSettingsResponseDTO = GetSettingsResponseDTO.extend({
  inherited: z.record(z.string(), z.string()),
  levels: z.record(z.string(), z.object({
    level: SettingLevelDTO,
    source: z.enum(['override', 'installation', 'manifest']),
    keys: z.array(z.string()),
    prefixes: z.array(z.string()),
    ownGroup: z.boolean(),
  })).optional(),
  levelModules: z.array(z.string()).optional(),
  capabilities: z.object({ canUpdate: z.boolean() }).nullable(),
});

/** A key read from one side for its whole module group (phase 53.2), not a cap. */
const followsLevel = (key: string) => {
  const follow = levelFollowOf(key);
  return follow !== null && !follow.cap;
};

/**
 * GET /tenant/[tenantId]/api/admin-settings
 *
 * Tenant integration / provider configuration (Email, SMS, Storage, Payment,
 * AI, Auth, Security, Notifications). Each tenant owns its own row in the
 * shared `settings` table — what used to be platform-wide super-admin config
 * is now per-tenant. Admin-only.
 *
 * Answers `{ settings, inherited }`: `settings` is the tenant's own rows; `inherited` (04-tenant-setting 1.2) the keys it has no row for that resolve
 * from ROOT at run time (the read service's own inheritance rule), so the page shows the value in force and a save does not shadow it with
 * defaults. Both masked. Always `{}` on ROOT. `capabilities.canUpdate` says whether the caller may save (`tenant_setting.config.update`, the
 * decision the PUT makes), so a page can open read-only instead of failing on Save (26-support 01-ui-fixes 2.2); null when it
 * cannot be worked out, and the page then offers Save and lets the PUT decide. The platform-only keys are left out: they are the operator's, not a value the tenant configures. So are
 * ROOT's provider account names and ids (`smtpUsername`, `awsSesAccessKeyId`, ...): the platform's accounts are not shown to every tenant.
 * So are the keys of a module that is off or whose settings permission the caller lacks (tenant_setting.key-owners.ts): the generic permission alone opens
 * no module's settings. So are a module's internal rows (MS-09, INTERNAL_KEY_PREFIXES in tenant_setting.key-policy.ts).
 *
 * Phase 53.6 (docs/phases/53-setting-levels): ROOT's values of the keys that follow a module's setting level are not inherited either. At `platform`
 * they are the operator's and the page hides those fields; at `tenant` they are never used; at `tenant_first` they serve only while the tenant has none
 * of its own, and a form pre-filled with them would save one edited field as a group of one. A tenant's answer adds `levels` (its level of each module
 * whose level the operator chooses, the keys that follow it, and whether it set any); ROOT's adds `levelModules` (the modules its pages offer the
 * choice on).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.read', scope: 'TENANT' });

    // Secrets are answered masked (tenant_setting.01).
    // MS-09: a module's internal rows (fleet_license's license, lease and deployment key on ROOT) are never answered.
    const own = withoutInternalKeys(maskSecrets(await SettingService.getAllAsRecord(tenantId)));
    const fromRoot = await getInheritedFromRoot(tenantId);
    const fromRootShown = maskSecrets(Object.fromEntries(Object.entries(fromRoot)
      .filter(([key]) => !PLATFORM_ONLY_SETTING_KEYS.has(key) && !isCredentialIdentifierKey(key) && !isInternalSettingKey(key) && !followsLevel(key))));
    const [settings, inherited] = await withoutUnreadableOwnedKeys(request, tenantId, auth, [own, fromRootShown]);
    const levelsPart = isRootTenant(tenantId)
      ? { levelModules: selectableLevelModules() }
      : { levels: await getSettingLevelsView(tenantId) };
    const capabilities = await grantedPermissions({
      request, tenantId, session: { user: auth.user, tenantMember: auth.tenantMember },
      permissionIds: ['tenant_setting.config.update'],
    }).then((granted) => ({ canUpdate: granted.has('tenant_setting.config.update') })).catch(() => null);
    const response = { success: true, settings, inherited, ...levelsPart, capabilities };
    GetAdminSettingsResponseDTO.parse(response);
    return NextResponse.json(response);
  } catch (e) {
    return normalizeError(e);
  }
}

async function updateSettings(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');

    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.update', scope: 'TENANT' });
    const { user } = auth;

    const body = await request.json();
    const parsedData = UpdateSettingsDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        {
          success: false,
          message: parsedData.error.issues.map((err) => err.message).join(', '),
        },
        { status: 400 },
      );
    }

    const { settings } = parsedData.data;
    // F.tsetting.01: only keys a module declares (generated catalog); checked before anything else reads the batch.
    assertDeclaredSettingKeys(Object.keys(settings));
    // A module's keys need that module on and its settings permission too (tenant_setting.key-owners.ts).
    await assertOwnedKeysWritable(request, tenantId, auth, Object.keys(settings));
    // The IP allow/deny lists apply from the moment they are written: refuse a change that would lock its writer out
    // (unless the lists never apply to the writer: the same exemptions the enforcement uses).
    await assertIpListWriteKeepsWriter(tenantId, settings, request, { exempt: 'ipListsExempt' in auth && auth.ipListsExempt === true });
    // MS-39: twoFactorRequired is switched on only from a session that proved a second factor (its writer is bound by it next).
    await assertTwoFactorWriteKeepsWriter(tenantId, settings, auth);
    // Maker-checker aware: when the tenant enables `tenantSettingMakerChecker`,
    // gateable keys are parked in the approval queue (surfaced via `pending`)
    // instead of being written; otherwise this behaves exactly like updateMany.
    const { applied, pending } = await SettingService.updateManyGated(tenantId, settings, {
      actorId: user.userId, actorRole: auth.tenantMember?.memberRole ?? null, isGlobalAdmin: auth.isGlobalAdmin === true,
    });

    const updatedSettings: Record<string, string> = {};
    for (const s of applied) {
      updatedSettings[s.key] = s.value;
    }

    // A just-written secret is not echoed back (tenant_setting.01).
    const response = { success: true, settings: maskSecrets(updatedSettings), pending };
    UpdateSettingsResponseDTO.parse(response);
    return NextResponse.json(response);
  } catch (e) {
    return normalizeError(e);
  }
}

export const PUT = updateSettings;
export const POST = updateSettings;
