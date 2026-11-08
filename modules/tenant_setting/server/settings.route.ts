// path: app/tenant/[tenantId]/api/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import SettingMessages from "@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.messages";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { assertIpListWriteKeepsWriter } from "@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.ip-lists";
import { assertTwoFactorWriteKeepsWriter } from "@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.two-factor";
import { maskSecrets } from "@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.validation";
import { assertDeclaredSettingKeys, isGenericWriteRefusedKey, withoutInternalKeys } from "@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.key-policy";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { assertOwnedKeysWritable, withoutUnreadableOwnedKeys } from "@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.key-owners.next";

/** Max keys one by-keys read may ask for (tenant_setting.07): a 100 000 key list used to become one giant IN() query. */
const MAX_KEYS_PER_READ = 500;

/** The JSON body as a plain object, or null (a `null`, array, string or number body used to throw a TypeError: a 500). */
async function objectBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json();
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

const bad = (message: string) => NextResponse.json({ success: false, message }, { status: 400 });

/**
 * GET /tenant/[tenantId]/api/settings
 * Get all tenant settings (requires ADMIN role)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.read', scope: 'TENANT' });

    // Secrets are answered masked (tenant_setting.01): the API never returns a credential in plaintext. A module's keys
    // only while that module is on and with its settings permission (tenant_setting.key-owners.ts); a module's internal
    // rows never (MS-09).
    const [settings] = await withoutUnreadableOwnedKeys(request, tenantId, auth, [withoutInternalKeys(maskSecrets(await SettingService.getAllAsRecord(tenantId)))]);

    return NextResponse.json({
      success: true,
      settings
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/settings
 * Get tenant settings by keys (requires ADMIN role)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.read', scope: 'TENANT' });

    const body = await objectBody(request);
    const keys = body?.keys;

    if (!keys || !Array.isArray(keys)) {
      return NextResponse.json({
        success: false,
        message: "Keys array is required"
      }, { status: 400 });
    }
    // tenant_setting.07: only non-empty strings (a non-string or empty entry aliased the tenant-wide cache entry), and a cap.
    if (keys.length > MAX_KEYS_PER_READ) return bad(`At most ${MAX_KEYS_PER_READ} keys can be read at once`);
    if (keys.some((k) => typeof k !== 'string' || k.trim() === '')) return bad('Every key must be a non-empty string');

    // Masked (tenant_setting.01): neither the tenant's own secrets nor a ROOT default it inherits come back in plaintext.
    // A module's internal rows are never answered, asked for by name or not (MS-09).
    const [settings] = await withoutUnreadableOwnedKeys(request, tenantId, auth, [withoutInternalKeys(maskSecrets(await SettingService.getByKeys(tenantId, keys as string[])))]);

    return NextResponse.json({
      success: true,
      settings
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/settings
 * Update tenant settings (requires ADMIN role)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.update', scope: 'TENANT' });
    const { user } = auth;

    const body = await objectBody(request);
    const settings = body?.settings as Record<string, unknown> | undefined;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return NextResponse.json({
        success: false,
        message: "Settings object is required"
      }, { status: 400 });
    }
    // tenant_setting.07: values are strings, as on admin-settings (a number reached the encryptor and threw: a 500).
    if (Object.values(settings).some((v) => typeof v !== 'string')) return bad('Every setting value must be a string');
    const values = settings as Record<string, string>;
    // F.tsetting.01: only keys a module declares (generated catalog); checked before anything else reads the batch.
    assertDeclaredSettingKeys(Object.keys(values));
    // A module's keys need that module on and its settings permission too (tenant_setting.key-owners.ts).
    await assertOwnedKeysWritable(request, tenantId, auth, Object.keys(values));

    // The IP allow/deny lists apply from the moment they are written: refuse a change that would lock its writer out
    // (unless the lists never apply to the writer: the same exemptions the enforcement uses).
    await assertIpListWriteKeepsWriter(tenantId, values, request, { exempt: 'ipListsExempt' in auth && auth.ipListsExempt === true });
    // MS-39: twoFactorRequired is switched on only from a session that proved a second factor (its writer is bound by it next).
    await assertTwoFactorWriteKeepsWriter(tenantId, values, auth);

    // Maker-checker aware: when the tenant enables `tenantSettingMakerChecker`,
    // gateable keys are parked in the approval queue (surfaced via `pending`)
    // instead of being written; otherwise this behaves exactly like updateMany.
    const { applied, pending } = await SettingService.updateManyGated(tenantId, values, {
      actorId: user.userId, actorRole: auth.tenantMember?.memberRole ?? null, isGlobalAdmin: auth.isGlobalAdmin === true,
    });

    // Convert to key-value object
    const updatedSettings: Record<string, string> = {};
    for (const s of applied) {
      updatedSettings[s.key] = s.value;
    }

    return NextResponse.json({
      success: true,
      // A just-written secret is not echoed back (tenant_setting.01).
      settings: maskSecrets(updatedSettings),
      pending
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/settings
 * Delete a tenant setting (requires OWNER role)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.delete', scope: 'TENANT' });
    const { user } = auth;

    const body = await objectBody(request);
    const key = body?.key;

    if (!key || typeof key !== 'string') {
      return NextResponse.json({
        success: false,
        message: "Setting key is required"
      }, { status: 400 });
    }

    // MS-09 / MS-21: what the generic write refuses, the generic delete refuses too (a ledger projection, a plugin's
    // config, an internal row, a key with its own validating route): deleting one would skip its owner's checks as well.
    if (isGenericWriteRefusedKey(key)) {
      throw new AppError(`This setting is managed by its own module and cannot be deleted here: ${key}.`, 403, ErrorCode.FORBIDDEN);
    }
    await assertOwnedKeysWritable(request, tenantId, auth, [key]);

    // tenant_setting.09: the deletion is attributed to the caller (it was written as SYSTEM).
    const deleted = await SettingService.delete(tenantId, key, { actorId: user.userId });

    if (!deleted) {
      return NextResponse.json({
        success: false,
        message: SettingMessages.SETTING_NOT_FOUND
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: SettingMessages.SETTING_DELETED
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
