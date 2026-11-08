import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';

import { NextRequest, NextResponse } from "next/server";
import UserService from "@kuraykaraaslan-labs/user/server/user.service";
import { CreateUserRequestSchema } from "@kuraykaraaslan-labs/user/server/user.dto";
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { ListUsersQuery } from '@kuraykaraaslan-labs/user/server/user.dto';
import { assertLocalCredentialsAllowed } from '@kuraykaraaslan-labs/auth/server/auth.local-credentials';
import { assertMayCreateUser, validationRefusal } from './user.admin-guard';
import { platformStepUp } from './user.account-actions.http';

/**
 * GET /tenant/[tenantId]/api/users
 * Root-tenant admins only. Phase 43 list contract (0-based page, sort, userRole / userStatus / createdFrom-To, search).
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'user.users.read', scope: 'GLOBAL' });

    // phase 43 list contract: sort, role / status / joined filters, search over the email; 400 for anything outside it
    const { page, pageSize, search, sort, userRole, userStatus, createdFrom, createdTo } = readListQuery(new URL(request.url).searchParams, ListUsersQuery);

    // 06-user 2.1: each row carries its root membership role and status (one join), so the UI does not offer what the guard refuses.
    // Phase 43: the same sort and filters as the plain list.
    const { users, total } = await UserService.getAllWithRootMembership({ page, pageSize, search, sort, userRole, userStatus, createdFrom, createdTo });

    return NextResponse.json({ users, data: users, total, page, pageSize });

  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/users
 * Root-tenant admins only — KD-13 enforced by guard.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.create', scope: 'GLOBAL' });
    // Creating a person here always stores a local password hash: refused where people may not hold local credentials (a Fleet ID node in a
    // required region, decision F15, `identity.no_credentials_on_nodes`). People arrive there as shadow users from their Fleet ID login.
    await assertLocalCredentialsAllowed();

    const body = await request.json();

    const parsedData = CreateUserRequestSchema.safeParse(body);

    if (!parsedData.success) {
      // 06-user 1.1: a message and a code, as PUT answers, never a raw ZodError.
      return NextResponse.json(validationRefusal(parsedData.error.issues), { status: 400 });
    }

    const { email, password, phone, userRole } = parsedData.data;
    const actorId = auth?.user?.userId;

    // 06-user 2.2: a platform admin is minted only by an ACTIVE root OWNER.
    await assertMayCreateUser({ actorId, userRole });
    // Phase 55 00.6: minting a platform admin is made under the acting owner's step-up, after the rank rule, before the write.
    if (userRole === 'ADMIN') await platformStepUp(request, auth, 'user.users.create')();

    const user = await UserService.create({
      email,
      password,
      phone: phone ?? undefined,
      userRole,
      actorId,
    });

    return NextResponse.json({ user });

  } catch (e) {
    return normalizeError(e);
  }
}
