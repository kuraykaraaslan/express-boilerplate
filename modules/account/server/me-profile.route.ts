// path: app/tenant/[tenantId]/api/auth/me/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import UserProfileService from "@kuraykaraaslan-labs/user_profile/server/user_profile.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { UpdateProfileRequestSchema } from "@kuraykaraaslan-labs/user_profile/server/user_profile.dto";
import AccountMessages from "./account.messages";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.profile.read',
      scope: 'ACCOUNT'
    });

    const userProfile = await UserProfileService.getByUserId(user.userId);

    return NextResponse.json(
      { userProfile },
      { status: 200 }
    );
  } catch (e) {
    return normalizeError(e);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.profile.update',
      scope: 'ACCOUNT'
    });

    // `?? {}`: a JSON `null` body is a validation error (400), not a TypeError (500).
    const { userProfile } = (await request.json()) ?? {};

    const parsedData = UpdateProfileRequestSchema.safeParse(userProfile);

    if (!parsedData.success) {
      // 06-user 1.2: a code the page translates, and the fields at fault; the issue text stays for logs and API clients.
      return NextResponse.json(
        {
          message: parsedData.error.issues.map((err) => err.message).join(", "),
          code: 'VALIDATION_ERROR',
          fields: [...new Set(parsedData.error.issues.map((err) => err.path.map(String).join('.')).filter(Boolean))],
        },
        { status: 400 }
      );
    }

    const updatedProfile = await UserProfileService.update(user.userId, parsedData.data);

    return NextResponse.json(
      {
        message: AccountMessages.PROFILE_UPDATED_SUCCESSFULLY,
        userProfile: updatedProfile
      },
      { status: 200 }
    );
  } catch (e) {
    return normalizeError(e);
  }
}
