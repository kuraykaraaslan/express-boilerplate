// path: app/tenant/[tenantId]/api/auth/me/tenants/route.ts
import 'reflect-metadata';
import { IsNull } from 'typeorm';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { activeMembershipsOf, pendingInvitationsFor } from './account.tenants.queries';
import { Tenant as TenantEntity } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { TenantDomain as TenantDomainEntity } from '@kuraykaraaslan-labs/tenant_domain/server/entities/tenant_domain.entity';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth/me/tenants
 * Tenant-scoped /api/auth/me endpoint.
 * Returns every tenant the current user is a member of, plus pending invitations.
 * The path tenant only gates authentication — the result list is user-global.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.tenants.read',
      scope: 'ACCOUNT',
    });


    // On the system connection (38-security 6.1, docs/phases/10-db Faz 3): both this membership lookup
    // and the invitation lookup below are keyed by userId/email, across EVERY
    // tenant at once — there is no single tenantId to scope them to. The
    // per-membership Tenant/TenantDomain reads further down ARE single-tenant
    // and go through withTenantRepositoryFor.
    // 38-security 6.1: across every tenant by design, so on the system connection (a runtime login with no tenant context sees nothing once RLS is forced).
    const memberships = await activeMembershipsOf(user.userId);

    const tenants = await Promise.all(
      memberships.map(async (m) => {
        const tenant = await withTenantRepositoryFor(m.tenantId, TenantEntity, (repo) => repo.findOne({
          where: { tenantId: m.tenantId, tenantStatus: 'ACTIVE', deletedAt: IsNull() },
        }));
        if (!tenant) return null;

        // Host names only: verification tokens, SSL and provisioning fields stay behind
        // the tenant_domain.* permissions, and any member (a plain USER too) reads this.
        const domainRows = await withTenantRepositoryFor(m.tenantId, TenantDomainEntity, (repo) => repo.find({
          select: { tenantDomainId: true, tenantId: true, domain: true, isPrimary: true, domainStatus: true },
          where: [
            { tenantId: m.tenantId, domainStatus: 'ACTIVE' },
            { tenantId: m.tenantId, domainStatus: 'VERIFIED' },
          ],
        }));
        // Fail closed: the response is built from an allow-list, so a column the read returns beyond the `select`
        // (a driver or repository that ignores it, an eager relation, a later edit of the select) never reaches a member.
        const domains = domainRows.map((d) => ({
          tenantDomainId: d.tenantDomainId,
          tenantId: d.tenantId,
          domain: d.domain,
          isPrimary: d.isPrimary,
          domainStatus: d.domainStatus,
        }));

        return {
          tenantMemberId: m.tenantMemberId,
          memberRole: m.memberRole,
          memberStatus: m.memberStatus,
          tenant: {
            tenantId: tenant.tenantId,
            name: tenant.name,
            description: tenant.description,
            tenantStatus: tenant.tenantStatus,
            domains,
          },
        };
      }),
    );

    const now = new Date();
    const pendingInvitations = await pendingInvitationsFor(user.email, now);

    const tenantIds = [...new Set(pendingInvitations.map((i) => i.tenantId))];
    const invitationTenants: Record<string, Pick<TenantEntity, 'tenantId' | 'name' | 'description' | 'tenantStatus'>> = {};
    await Promise.all(
      tenantIds.map(async (tid) => {
        const t = await withTenantRepositoryFor(tid, TenantEntity, (repo) => repo.findOne({ where: { tenantId: tid } }));
        if (t) {
          invitationTenants[tid] = {
            tenantId: t.tenantId,
            name: t.name,
            description: t.description,
            tenantStatus: t.tenantStatus,
          };
        }
      }),
    );

    const invitations = pendingInvitations.map((inv) => ({
      invitationId: inv.invitationId,
      tenantId: inv.tenantId,
      memberRole: inv.memberRole,
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      tenant: invitationTenants[inv.tenantId] ?? null,
    }));

    return NextResponse.json(
      { success: true, tenants: tenants.filter(Boolean), invitations },
      { status: 200 },
    );
  } catch (e) {
    return normalizeError(e);
  }
}
