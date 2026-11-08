import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { UserSession as UserSessionEntity } from '@kuraykaraaslan-labs/user_session/server/entities/user_session.entity';
import { SafeUserSessionSchema } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

// GET /tenant/[tenantId]/api/users/[userId]/impersonation-sessions
//
// GOODTOHAVE #9 — results are scoped to the requesting tenant: only
// impersonation sessions whose metadata.impersonation.tenantId matches the
// tenant in the URL are returned, so a tenant admin cannot see sessions a
// different tenant's admins initiated against the same user. We also filter to
// rows that actually carry an `impersonation` block (not just any metadata).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> }
) {
  try {
    const { tenantId, userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'user.impersonation.read', scope: 'GLOBAL' });
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20')));
    const activeOnly = url.searchParams.get('activeOnly') === 'true';

    const ds = await getDataSource();
    const repo = ds.getRepository(UserSessionEntity);

    const baseQuery = () => {
      const qb = repo
        .createQueryBuilder('s')
        .where('s.userId = :userId', { userId })
        .andWhere(`s.metadata -> 'impersonation' ->> 'tenantId' = :tenantId`, { tenantId });
      if (activeOnly) qb.andWhere('s.sessionExpiry > :now', { now: new Date() });
      return qb;
    };

    const [sessions, total] = await Promise.all([
      baseQuery()
        .orderBy('s.createdAt', 'DESC')
        .skip(Math.max(0, (page - 1) * pageSize))
        .take(pageSize)
        .getMany(),
      baseQuery().getCount(),
    ]);

    return NextResponse.json({
      sessions: sessions.map((s) => SafeUserSessionSchema.parse(s)),
      total,
      page,
      pageSize,
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
