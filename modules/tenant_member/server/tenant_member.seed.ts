import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_USER_ID, SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { TenantMember } from './entities/tenant_member.entity';
import { TenantRole } from './entities/tenant_role.entity';
import { PERMISSION_MATRIX, PERMISSION_ROLES } from './tenant_member.permissions';

/**
 * Demo-data seed for the `tenant_member` module.
 *
 * `tenant_member` is the membership join between a tenant and a user: it pins
 * each user's role (OWNER/ADMIN/USER) and status (ACTIVE/INACTIVE/SUSPENDED/
 * PENDING) inside one tenant, plus optional SCIM `externalId` correlation.
 *
 * Rules followed (see modules/commerce_catalog/store.seed.ts for the reference):
 *  - `TenantMember` HAS a `tenantId` column → tenant-scoped via `ctx.repo`.
 *  - Natural key is the @Unique(['tenantId', 'userId']) pair → re-runs reuse rows.
 *  - Enum values are copied verbatim from tenant_member.enums.ts.
 *  - userId values are cross-module bare uuids: prefer the shared SEED_*_ID
 *    constants / ctx.refs, falling back to fixed uuid literals.
 *  - Numbers (sessionVersion) are real numbers; timestamps are real Date objects.
 */
/**
 * Synthetic tenant that owns the persisted role rows of the full-load lane.
 *
 * `tenant_roles` is special: ANY persisted row flips a tenant from "never edited
 * access control, enforce the static PERMISSION_MATRIX" to "enforce what the rows say"
 * (`loadSet` -> `seeded: true`), and it drops the synthesized built-ins from the access
 * matrix. Writing rows for ACME would therefore change how the base fixtures are
 * authorised, so they live on a tenant that no login, route or entitlement points at.
 */
export const SYNTHETIC_ROLES_TENANT_ID = 'c0000000-0000-4000-8000-0000000000b1';

/** Custom groups: `key` is namespaced lowercase (see RoleKeySchema); permissions are real catalog ids. */
export const CUSTOM_ROLE_SEEDS: Array<{
  key: string; label: string; description: string; permissions: string[]; isActive?: boolean
}> = [
  { key: 'content.editor', label: 'Content editor', description: 'Writes and publishes blog posts and moderates comments.', permissions: ['blog.posts.read', 'blog.posts.create', 'blog.posts.update', 'blog.posts.transition', 'blog.categories.read', 'blog.comments.read', 'blog.comments.moderate'] },
  { key: 'store_operator', label: 'Store operator', description: 'Reads and ships orders, receives returns and moderates reviews.', permissions: ['commerce_order.orders.read', 'commerce_order.orders.fulfill', 'commerce_fulfillment.fulfillment.read', 'commerce_fulfillment.fulfillment.pack', 'commerce_fulfillment.fulfillment.ship', 'commerce_return.returns.read', 'commerce_return.returns.receive', 'commerce_review.reviews.read', 'commerce_review.reviews.approve'] },
  { key: 'hr.recruiter', label: 'HR recruiter', description: 'Reads the employee directory and org chart; no access to personal data.', permissions: ['hr.employees.read', 'hr.departments.read', 'hr.orgchart.read', 'hr.positions.read'] },
  { key: 'sales.rep', label: 'Sales representative', description: 'Works own leads and tasks.', permissions: ['crm_lead.leads.read', 'crm_lead.leads.create', 'crm_lead.leads.update', 'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.update'] },
  { key: 'readonly.auditor', label: 'Read-only auditor', description: 'Reads documents and calendars without changing anything.', permissions: ['document.documents.read', 'document.compliance.read', 'calendar.calendars.read', 'calendar.events.read'] },
  { key: 'legacy.operator', label: 'Legacy operator (retired)', description: 'Retired group kept so old audit entries still resolve.', permissions: [], isActive: false },
];

export async function seedTenantMember(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, refs } = ctx;

  // Cross-module user ids: the tenant's people. Owner + admin reuse the shared
  // seed constants; the rest fall back to deterministic uuid literals so the
  // membership rows stay stable across re-runs even without the user module.
  const ownerUserId = (refs.adminUserId as string) ?? SEED_ADMIN_USER_ID;
  const adminUserId = (refs.userId as string) ?? SEED_USER_ID;
  const memberUserId = 'a0000000-0000-4000-8000-000000000003';

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  // Concrete local row shape so foc's create argument keeps full type inference
  // (never spread a Partial<Entity> into foc — it breaks inference).
  type MemberDef = {
    userId: string;
    memberRole: 'OWNER' | 'ADMIN' | 'USER';
    memberStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';
    externalId: string | null;
    sessionVersion: number;
    createdAt: Date;
  };

  const memberDefs: MemberDef[] = [
    // Founder: OWNER, active, provisioned via SCIM (has an externalId).
    {
      userId: ownerUserId,
      memberRole: 'OWNER',
      memberStatus: 'ACTIVE',
      externalId: 'okta|00u1a2b3c4d5e6f7g8h9',
      sessionVersion: 3,
      createdAt: daysAgo(90),
    },
    // Operator: ADMIN, active, also SCIM-linked from a different IdP.
    {
      userId: adminUserId,
      memberRole: 'ADMIN',
      memberStatus: 'ACTIVE',
      externalId: 'azuread|7f3c1d9e-2b44-4a01-9c8e-1122334455aa',
      sessionVersion: 1,
      createdAt: daysAgo(45),
    },
    // Suspended regular member, manually created (no SCIM externalId).
    {
      userId: memberUserId,
      memberRole: 'USER',
      memberStatus: 'SUSPENDED',
      externalId: null,
      sessionVersion: 0,
      createdAt: daysAgo(14),
    },
  ];

  const memberRepo = ctx.repo<TenantMember>(TenantMember);
  let ownerMemberId: string | undefined;

  for (const def of memberDefs) {
    const member = await foc(
      memberRepo,
      { tenantId, userId: def.userId } as FindOptionsWhere<TenantMember>,
      {
        tenantId,
        userId: def.userId,
        memberRole: def.memberRole,
        memberStatus: def.memberStatus,
        externalId: def.externalId,
        sessionVersion: def.sessionVersion,
        createdAt: def.createdAt,
      },
    );
    if (def.memberRole === 'OWNER') ownerMemberId = member.tenantMemberId;
  }

  // ── Persisted tenant roles (full-load lane only, on a SYNTHETIC tenant) ────
  // Not demo-safe on ACME: see SYNTHETIC_ROLES_TENANT_ID. No existing member's
  // `roleKeys` is touched and nobody is assigned the custom groups.
  let roleCount = 0;
  if (ctx.fullLoad) {
    const roleRepo = ctx.repo<TenantRole>(TenantRole);
    const builtins = PERMISSION_ROLES.map((role) => ({
      key: role as string,
      label: role.charAt(0) + role.slice(1).toLowerCase(),
      description: `Built-in ${role} role (grants follow the static permission matrix).`,
      permissions: PERMISSION_MATRIX.filter((row) => row.roles[role]).map((row) => row.key),
      isBuiltin: true,
      isActive: true,
      createdByUserId: null as string | null,
    }));
    const customs = CUSTOM_ROLE_SEEDS.map((r) => ({
      ...r,
      isBuiltin: false,
      isActive: r.isActive ?? true,
      createdByUserId: ownerUserId as string | null,
    }));
    for (const def of [...builtins, ...customs]) {
      await foc(
        roleRepo,
        { tenantId: SYNTHETIC_ROLES_TENANT_ID, key: def.key } as FindOptionsWhere<TenantRole>,
        {
          tenantId: SYNTHETIC_ROLES_TENANT_ID,
          key: def.key,
          label: def.label,
          description: def.description,
          permissions: def.permissions,
          isBuiltin: def.isBuiltin,
          isActive: def.isActive,
          createdByUserId: def.createdByUserId,
        },
      );
      roleCount += 1;
    }
  }

  // Publish the owner membership id for any later module that wants it.
  refs.tenantMemberId = ownerMemberId;
  refs.ownerUserId = ownerUserId;

  ctx.log(
    `tenant_member: 3 members (OWNER/ADMIN active, USER suspended) for ${tenantId}` +
      (ctx.fullLoad ? `; ${roleCount} persisted roles on synthetic tenant ${SYNTHETIC_ROLES_TENANT_ID}` : ''),
  );
}

// ── Filler: members for the user base ──────────────────────────────────────

/** The filler user pool of `user_filler` for this tenant, in index order (found by the `.seed-<tail>@example.com` email suffix). */
async function fillerUsers(ctx: SeedContext): Promise<Array<{ userId: string; email: string; i: number }>> {
  const tail = ctx.tenantId.replace(/-/g, '').slice(-8);
  const rows = (await ctx.systemDs.query(`SELECT "userId", email FROM users WHERE email LIKE $1 ORDER BY email`, [`%.seed-${tail}@example.com`])) as Array<{ userId: string; email: string }>;
  return rows
    .map((r) => ({ ...r, i: Number(/\.(\d{3})\.seed-/.exec(r.email)?.[1] ?? 0) - 1 }))
    .sort((a, b) => a.i - b.i);
}

/**
 * Filler for `tenant_member`: most of the `user_filler` pool joins the tenant (demo: ~34 members), so
 * member lists, filters and pagination have data. Registered as its own seeder (`tenant_member_filler`).
 *
 * Demo-safe: every filler member is a plain USER (no OWNER or ADMIN, no role keys): no permission is
 * granted beyond the base role. Statuses spread over ACTIVE / INACTIVE / SUSPENDED / PENDING.
 * Idempotent: keyed on (tenant, user), the table's unique key.
 */
export async function seedTenantMemberFiller(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, faker } = ctx;
  const repo = ctx.repo<TenantMember>(TenantMember);
  const statuses: Array<'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING'> = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'PENDING', 'ACTIVE', 'INACTIVE', 'ACTIVE', 'SUSPENDED'];
  let n = 0;
  for (const u of await fillerUsers(ctx)) {
    if (u.i % 7 === 6) continue; // some users of the pool are not members (invited elsewhere, left, ...)
    const status = statuses[u.i % statuses.length];
    const createdAt = faker.pastDate(300);
    await foc(repo, { tenantId, userId: u.userId } as FindOptionsWhere<TenantMember>, {
      tenantId, userId: u.userId, memberRole: 'USER', memberStatus: status, externalId: u.i % 5 === 0 ? `scim|seed-${u.i + 1}` : null,
      sessionVersion: faker.int(0, 3),
      suspensionReason: status === 'SUSPENDED' ? 'Policy violation under review (seed)' : null,
      suspendedUntil: status === 'SUSPENDED' && u.i % 2 ? new Date(Date.UTC(2027, 0, 1)) : null,
      lastActiveAt: status === 'ACTIVE' ? new Date(createdAt.getTime() + faker.int(1, 200) * 86_400_000) : null,
      createdAt,
    });
    n++;
  }
  ctx.log(`tenant_member(filler): ${n} USER members for ${tenantId}`);
}
