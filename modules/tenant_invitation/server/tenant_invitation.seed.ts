import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { TenantInvitation } from './entities/tenant_invitation.entity';

/**
 * Seeds the `tenant_invitation` module.
 *
 * Rules of the house (mirrors store.seed.ts):
 *  - Always go through `ctx.foc(repo, where, create)` with a natural key in
 *    `where` — here the unique `token` column — so re-runs reuse rows.
 *  - Use *valid* enum values: status ∈ PENDING/ACCEPTED/DECLINED/EXPIRED/REVOKED,
 *    memberRole ∈ OWNER/ADMIN/USER.
 *  - Cover the entity with varied rows (different statuses + roles + expiries).
 *
 * The `TenantInvitation` entity HAS a `tenantId` column → tenant-scoped repo.
 * `invitedByUserId` is a cross-module (identity) id; the tenant DBs carry no
 * cross-database FK, so we use the deterministic seed admin user id.
 */
export async function seedTenantInvitation(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, refs } = ctx;

  const invitedByUserId = (refs.adminUserId as string) ?? SEED_ADMIN_USER_ID;

  const now = Date.now();
  const days = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000);

  // Each invitation has a stable token (the @Unique natural key) so re-running
  // the seed reuses the row rather than inserting a duplicate.
  type InvitationDef = {
    email: string;
    memberRole: string;
    token: string;
    status: string;
    expiresAt: Date;
  };

  const invitationDefs: InvitationDef[] = [
    // Fresh pending invite for a regular member — still well within its window.
    {
      email: 'pending.user@seed-tenant.test',
      memberRole: 'USER',
      token: 'seed-invitation-token-pending-user',
      status: 'PENDING',
      expiresAt: days(7),
    },
    // Pending admin invite, closer to expiry.
    {
      email: 'pending.admin@seed-tenant.test',
      memberRole: 'ADMIN',
      token: 'seed-invitation-token-pending-admin',
      status: 'PENDING',
      expiresAt: days(2),
    },
    // Already accepted invite.
    {
      email: 'accepted.user@seed-tenant.test',
      memberRole: 'USER',
      token: 'seed-invitation-token-accepted',
      status: 'ACCEPTED',
      expiresAt: days(-3),
    },
    // Recipient declined the invite.
    {
      email: 'declined.user@seed-tenant.test',
      memberRole: 'USER',
      token: 'seed-invitation-token-declined',
      status: 'DECLINED',
      expiresAt: days(-5),
    },
    // Lapsed without action — already past expiry.
    {
      email: 'expired.user@seed-tenant.test',
      memberRole: 'USER',
      token: 'seed-invitation-token-expired',
      status: 'EXPIRED',
      expiresAt: days(-10),
    },
    // Owner-level invite revoked by an admin before it was used.
    {
      email: 'revoked.owner@seed-tenant.test',
      memberRole: 'OWNER',
      token: 'seed-invitation-token-revoked',
      status: 'REVOKED',
      expiresAt: days(4),
    },
  ];

  // `token` is unique across ALL tenants: every tenant but the root one gets a
  // tenant suffix (the root tenant keeps the tokens it was first seeded with).
  const tenantTag = tenantId.replace(/-/g, '').slice(-8);
  if (tenantTag !== '00000000') for (const def of invitationDefs) def.token = `${def.token}-${tenantTag}`;

  const repo = ctx.repo<TenantInvitation>(TenantInvitation);
  let firstInvitationId: string | undefined;
  for (const def of invitationDefs) {
    const invitation = await foc(repo,
      { tenantId, token: def.token } as FindOptionsWhere<TenantInvitation>,
      {
        tenantId,
        email: def.email,
        invitedByUserId,
        memberRole: def.memberRole,
        token: def.token,
        status: def.status,
        expiresAt: def.expiresAt,
      },
    );
    firstInvitationId ??= invitation.invitationId;
  }

  // Publish a reference later modules might consume.
  refs.invitationId = firstInvitationId;

  ctx.log(`tenant_invitation: ${invitationDefs.length} invitations (pending/accepted/declined/expired/revoked) for ${tenantId}`);
}

/**
 * Filler for `tenant_invitation`: dozens of invitations (demo: 30) to people outside the user base, across
 * every status. Registered as its own seeder (`tenant_invitation_filler`).
 *
 * Demo-safe: every invitation is for the USER role (no OWNER or ADMIN), addressed to example.com, and its
 * token is random bytes nobody holds, so none can be accepted. Pending ones may expire in the future like
 * a real backlog. Idempotent: keyed on (tenant, email), the email built from the index and the tenant tail.
 */
export async function seedTenantInvitationFiller(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, faker, refs } = ctx;
  const invitedByUserId = (refs.adminUserId as string) ?? SEED_ADMIN_USER_ID;
  const repo = ctx.repo<TenantInvitation>(TenantInvitation);
  const tail = tenantId.replace(/-/g, '').slice(-8);
  const statuses = ['PENDING', 'ACCEPTED', 'PENDING', 'DECLINED', 'EXPIRED', 'REVOKED', 'ACCEPTED'];
  const first = ['ali', 'berk', 'cansu', 'derya', 'ege', 'filiz', 'gokhan', 'hande', 'ilker', 'kaan', 'lara', 'mina', 'nazli', 'oguz', 'pinar'];
  const n = Math.min(ctx.count(6), 300);
  for (let i = 0; i < n; i++) {
    const email = `${first[i % first.length]}.invitee.${String(i + 1).padStart(3, '0')}.seed-${tail}@example.com`;
    const status = statuses[i % statuses.length];
    const createdAt = faker.pastDate(90);
    await foc(repo, { tenantId, email } as FindOptionsWhere<TenantInvitation>, {
      tenantId, email, invitedByUserId, memberRole: 'USER', token: randomBytes(24).toString('base64url'), status,
      expiresAt: new Date(createdAt.getTime() + (status === 'PENDING' ? 120 : 7) * 86_400_000), createdAt, updatedAt: createdAt,
    });
  }
  ctx.log(`tenant_invitation(filler): ${n} USER invitations for ${tenantId}`);
}
