import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { SecurityLockRequestSchema, SecurityUnlockRequestSchema } from './user.dto';
import { validationRefusal } from './user.admin-guard';
import { getSecurityLockState, securityLockAccount, securityUnlockAccount } from './user.support.service';
import { platformStepUp } from './user.account-actions.http';

/**
 * /api/users/[userId]/security-lock (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.1): the SECURITY lock of an account.
 * Platform operators only (GLOBAL scope, ADMIN floor, `user.users.security_lock`), every write audited by user_security.
 *
 *  - GET: the lock while it holds (`{ locked, lock }`); the reason is shown here, to operators, and nowhere else.
 *  - POST `{ reason, until? }`: lock. Every sign-in method is refused and every live session ends; the person is mailed.
 *  - DELETE `{ reason? }`: unlock. The guessing lock (failed passwords) has its own route, `/unlock`, and is not touched here.
 *
 * Both writes are the firewall's candidate actions `user_security.security_lock` and its undo (phase 55 00.1, no registry yet).
 * Phase 55 00.6: both writes are made under the acting administrator's step-up (purpose `user.users.security_lock`, target the
 * person), asked after the ranks and before the effect.
 */
type Ctx = { params: Promise<{ tenantId: string; userId: string }> };

const lockBody = (lock: { lockedAt: Date; until: Date | null; reason: string; actorId: string | null; source: string } | null) =>
  lock
    ? { locked: true, lock: { lockedAt: lock.lockedAt.toISOString(), until: lock.until ? lock.until.toISOString() : null, reason: lock.reason, lockedBy: lock.actorId, source: lock.source } }
    : { locked: false, lock: null };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'user.users.security_lock', scope: 'GLOBAL' });
    return NextResponse.json(lockBody(await getSecurityLockState({ userId })), { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.security_lock', scope: 'GLOBAL' });
    const parsed = SecurityLockRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json(validationRefusal(parsed.error.issues), { status: 400 });
    const lock = await securityLockAccount({
      userId, actorId: auth.user.userId, reason: parsed.data.reason, until: parsed.data.until,
      confirm: platformStepUp(request, auth, 'user.users.security_lock', userId),
    });
    return NextResponse.json(lockBody(lock), { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, requiredPermission: 'user.users.security_lock', scope: 'GLOBAL' });
    // The body is optional: no body (or an empty one) is "no note".
    const raw = await request.text().catch(() => '');
    let body: unknown = {};
    if (raw.trim()) {
      try { body = JSON.parse(raw); } catch { body = null; }
    }
    const parsed = SecurityUnlockRequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json(validationRefusal(parsed.error.issues), { status: 400 });
    const { wasLocked } = await securityUnlockAccount({
      userId, actorId: auth.user.userId, reason: parsed.data.reason ?? null,
      confirm: platformStepUp(request, auth, 'user.users.security_lock', userId),
    });
    return NextResponse.json({ unlocked: true, wasLocked }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
