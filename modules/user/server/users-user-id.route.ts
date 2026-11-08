import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';

import { NextRequest, NextResponse } from "next/server";
import UserService from "@kuraykaraaslan-labs/user/server/user.service";
import { UpdateUserRequestSchema } from "@kuraykaraaslan-labs/user/server/user.dto";
import UserMessages from "@kuraykaraaslan-labs/user/server/user.messages";
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { assertMayDeleteUser, assertMayUpdateUser, rootMembership, validationRefusal } from './user.admin-guard';
import { platformStepUp } from './user.account-actions.http';

/**
 * GET /tenant/[tenantId]/api/users/[userId]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> }
) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'user.users.read', scope: 'GLOBAL' });
    const user = await UserService.getById(userId);

    if (!user) {
      return NextResponse.json(
        { message: "USER_NOT_FOUND" },
        { status: 404 }
      );
    }

    // 06-user 2.1: the root membership role and status (any status), so the UI sees a suspended root OWNER too. A failed lookup
    // leaves both out, which the UI reads as "not known" (privileged, fail closed).
    const root = await rootMembership(userId);
    const body = root === undefined
      ? user
      : { ...user, rootMemberRole: root?.memberRole ?? null, rootMemberStatus: root?.memberStatus ?? null };

    return NextResponse.json({ user: body });

  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/users/[userId]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> }
) {
  try {
    const { userId } = await params;
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.delete', scope: 'GLOBAL' });
    const user = await UserService.getById(userId);

    if (!user) {
      return NextResponse.json(
        { message: UserMessages.USER_NOT_FOUND },
        { status: 404 }
      );
    }

    // 06-user 2.1: never one's own account, never a root OWNER or platform admin unless an ACTIVE root OWNER asks.
    await assertMayDeleteUser({ actorId: auth?.user?.userId, target: user });

    await UserService.delete(userId);

    return NextResponse.json(
      { message: UserMessages.USER_DELETED_SUCCESSFULLY },
    );
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/users/[userId]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> }
) {
  try {
    const { userId } = await params;
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.update', scope: 'GLOBAL' });
    const data = await request.json();

    const parsedData = UpdateUserRequestSchema.safeParse(data);

    if (!parsedData.success) {
      return NextResponse.json(validationRefusal(parsedData.error.issues), { status: 400 });
    }

    const actorId = auth?.user?.userId;
    const current = await UserService.getById(userId);
    if (!current) {
      return NextResponse.json(
        { message: UserMessages.USER_NOT_FOUND },
        { status: 404 }
      );
    }

    // S9 and 06-user 1.7 / 2.1 / 2.2: the platform role only by an ACTIVE root OWNER (never on one's own account); an erased account is
    // not edited back; an outranking account's email and status only by an ACTIVE root OWNER; no self-suspension.
    await assertMayUpdateUser({ actorId, target: current, data: parsedData.data });

    // Phase 55 00.6: a change of the platform role (a platform-admin grant or removal) is made under the acting owner's step-up,
    // asked after the rank rules and before the write.
    if (parsedData.data.userRole != null && parsedData.data.userRole !== (current.userRole ?? 'USER')) {
      await platformStepUp(request, auth, 'user.users.update', userId)();
    }

    const updatedUser = await UserService.update({ userId, data: parsedData.data, actorId });

    if (!updatedUser) {
      return NextResponse.json(
        { message: UserMessages.USER_NOT_FOUND },
        { status: 404 }
      );
    }

    return NextResponse.json({ user: updatedUser });

  } catch (e) {
    return normalizeError(e);
  }
}
