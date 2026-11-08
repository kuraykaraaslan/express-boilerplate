// path: app/tenant/[tenantId]/api/auth/me/preferences/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserPreferencesService from '@kuraykaraaslan-labs/user_preferences/server/user_preferences.service';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { UpdatePreferencesRequestSchema } from '@kuraykaraaslan-labs/user_preferences/server/user_preferences.dto';
import AccountMessages from './account.messages';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * Whose configured defaults the caller sees and, on a first save, gets (06-user 1.3): the URL tenant's only for a session of that
 * tenant, otherwise the global defaults (`null`). GET and PUT share it, so the form never shows one set of defaults and saves another.
 */
function defaultsTenantOf(userSession: { tenantId?: string | null } | null | undefined, tenantId: string): string | null {
  return userSession?.tenantId === tenantId ? tenantId : null;
}

/**
 * GET /tenant/[tenantId]/api/auth/me/preferences
 * Tenant-scoped /api/auth/me endpoint.
 * Preferences are user-global; tenant membership is checked for authentication only.
 *
 * Answers the EFFECTIVE preferences (06-user 1.3): `{ userPreferences, defaults, persisted }`, where `userPreferences` is the
 * stored row or, for a user without one, the defaults (`persisted: false`), every marketing consent off. The tenant's
 * configured defaults apply only when the session belongs to the URL tenant: an ACCOUNT-scoped read never reveals the
 * settings of a tenant the caller is not signed in to.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await Limiter.checkRateLimit(request);
    const { tenantId } = await params;
    const { user, userSession } = await authorizeRequest({
      request,
      requiredPermission: 'account.preferences.read',
      scope: 'ACCOUNT',
    });

    const effective = await UserPreferencesService.getEffective(user.userId, defaultsTenantOf(userSession, tenantId) ?? undefined);
    return NextResponse.json(effective, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/auth/me/preferences
 * The save applies the URL tenant's notification-channel restrictions, so the caller
 * must be a member of that tenant (TENANT scope); naming a foreign tenant is refused.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await Limiter.checkRateLimit(request);
    const { tenantId } = await params;
    const { user, userSession } = await authorizeRequest({
      request,
      tenantId,
      requiredPermission: 'account.preferences.update',
      scope: 'TENANT',
    });

    const body = await request.json();
    // A JSON `null` body reaches the DTO as null (a 400), not a TypeError (a 500).
    const prefsData = body?.userPreferences ?? body;
    const parsedData = UpdatePreferencesRequestSchema.safeParse(prefsData);

    if (!parsedData.success) {
      return NextResponse.json(
        { message: parsedData.error.issues.map((e) => e.message).join(', ') },
        { status: 400 },
      );
    }

    // Upsert (create-or-update): a user without a preferences row yet — e.g. the
    // first time they pick an application language — must still persist, not 404. A new row is filled with the defaults the GET showed.
    const updatedPreferences = await UserPreferencesService.upsert(user.userId, parsedData.data, tenantId, {
      defaultsTenantId: defaultsTenantOf(userSession, tenantId),
    });
    return NextResponse.json(
      {
        message: AccountMessages.PREFERENCES_UPDATED_SUCCESSFULLY,
        userPreferences: updatedPreferences,
      },
      { status: 200 },
    );
  } catch (e) {
    return normalizeError(e);
  }
}
