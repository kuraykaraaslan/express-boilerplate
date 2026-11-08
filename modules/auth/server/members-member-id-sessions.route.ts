// path: app/tenant/[tenantId]/api/members/[memberId]/sessions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { requireActionStepUpWhenEnrolled } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.step-up.next';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service';
import { mayActOn } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.rank';
import { revokeUserSessionsByAdmin } from '@kuraykaraaslan-labs/user_session/server/user_session.admin.service';

/**
 * DELETE /tenant/[tenantId]/api/members/[memberId]/sessions (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.6, P-6):
 * a workspace administrator signs a member out of THIS workspace. Only the sessions minted for this workspace end; the person's
 * sessions in other workspaces are not this administrator's to end (the platform route /api/users/{id}/sessions ends them all).
 *
 * TENANT scope, `auth.member_sessions.revoke` (ADMIN floor), optional `{ reason }` (kept in the audit row only). The ranks of a
 * member change: never oneself (the account page signs one's own sessions out), an OWNER only by an OWNER, otherwise only a
 * member strictly below the caller (tenant_member.rank mayActOn). The administrator steps up when they hold a factor
 * (`requireActionStepUpWhenEnrolled`, purpose the permission, target the member), after the ranks, before the effect.
 * Audited `user_session.revoked_by_admin` in this workspace. Lives in auth beside the other session routes: tenant_member and
 * user_session import each other's neighbours already, and this keeps them from importing each other.
 */
const NoteSchema = z.object({
  reason: z.string().trim().max(500, 'The reason is too long (500 characters at most).').nullish(),
}).strict();

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; memberId: string }> },
) {
  try {
    const { tenantId, memberId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'auth.member_sessions.revoke', scope: 'TENANT' });

    const raw = await request.text().catch(() => '');
    let body: unknown = {};
    if (raw.trim()) {
      try { body = JSON.parse(raw); } catch { body = null; }
    }
    const parsed = NoteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', '), code: 'VALIDATION_ERROR' }, { status: 400 });

    const member = await TenantMemberService.getById(memberId, tenantId);
    const caller = auth.tenantMember;
    if (member.userId === auth.user.userId) {
      throw new AppError('Sign your own sessions out on your account page.', 403, ErrorCode.FORBIDDEN);
    }
    if (member.memberRole === 'OWNER' && caller?.memberRole !== 'OWNER') {
      throw new AppError('Only owners can sign out other owners.', 403, ErrorCode.FORBIDDEN);
    }
    if (!mayActOn(caller?.memberRole, member.memberRole)) {
      throw new AppError('You cannot sign out a member whose role is equal to or higher than your own.', 403, ErrorCode.FORBIDDEN);
    }

    const stepUp = await requireActionStepUpWhenEnrolled(request, auth, { tenantId, purpose: 'auth.member_sessions.revoke', target: memberId });
    const { count } = await revokeUserSessionsByAdmin(member.userId, {
      tenantId, actorId: auth.user.userId, reason: parsed.data.reason ?? null, source: 'admin',
    });
    return NextResponse.json({ revoked: true, count, stepUp }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
