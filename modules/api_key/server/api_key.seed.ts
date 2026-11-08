import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { SEED_USER_ID, SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { ApiKey } from './entities/api_key.entity';
import { ApiKeyScopeDefinition } from './entities/api_key_scope_definition.entity';
import { AnyScopeSchema } from './api_key.enums';

/**
 * Demo-data seed for the `api_key` module.
 *
 * Rules of the house (mirrors `store.seed.ts`):
 *  - Always go through `ctx.foc(repo, where, create)` with a natural key in
 *    `where` so re-runs reuse rows. The `ApiKey` natural key is `keyHash`
 *    (unique across tenants) — we use a deterministic fake hash per tenant and seeded key.
 *  - `ApiKey` and `ApiKeyScopeDefinition` are pinned to the shared database
 *    (02-fleet F8): `ctx.repo` hands them out from the shared DataSource even
 *    when the target tenant has a database of its own.
 *  - Only valid scope values from `api_key.enums.ts`:
 *    read / write / admin / scim:read / scim:write.
 *  - `ApiKey` HAS a `tenantId` column → tenant-scoped: `ctx.repo<ApiKey>(ApiKey)`
 *    and set `tenantId: ctx.tenantId`.
 *  - Timestamps are real Date objects.
 *  - `createdByUserId` is a cross-module (identity) reference → bare uuid.
 *
 * Three varied rows are seeded: an active read/write key (last used recently),
 * an admin key with an expiry, a SCIM provisioning key (read+write), and a
 * revoked/expired key — exercising scope combinations and the isActive flag.
 *
 * It also seeds the descriptive scope catalogue (`api_key_scope_definitions`): the five
 * built-in verbs, `resource:action` scopes (including the `*` wildcard form), several
 * categories, an inactive definition and a SOFT-DELETED one (the unique `(tenantId, scope)`
 * index covers deleted rows, so it is looked up with `withDeleted`). The catalogue only
 * documents scopes for the admin picker; it never widens what a key may be granted, so it
 * is safe in every lane.
 */
export async function seedApiKey(ctx: SeedContext): Promise<void> {
  const { tenantId, foc, refs } = ctx;

  // Cross-module identity references (bare uuids — no cross-DB FKs).
  const ownerUserId = (refs.userId as string) ?? SEED_USER_ID;
  const adminUserId = (refs.adminUserId as string) ?? SEED_ADMIN_USER_ID;

  // keyHash is unique across ALL tenants and api_keys lives on the shared database for every tenant, dedicated ones
  // included (02-fleet F8): a fixed hash would make a second tenant's seed find (and reference) the first tenant's key.
  const seedKeyHash = (n: number) => `seed-apikey-hash-${tenantId}-${String(n).padStart(4, '0')}`;

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  type ApiKeyDef = {
    keyHash: string;
    name: string;
    description: string | null;
    scopes: string[];
    // Phase 48: module permissions (none on these demo keys) and the review mark of a key from before per-module permissions.
    permissions: string[];
    scopeReview: boolean;
    isActive: boolean;
    createdByUserId: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
  };

  const apiKeyDefs: ApiKeyDef[] = [
    // 1) Active read/write integration key, used recently, no expiry.
    {
      keyHash: seedKeyHash(1),
      name: 'CI Pipeline Key',
      description: 'Read/write key used by the demo CI pipeline.',
      scopes: ['read', 'write'],
      permissions: [],
      scopeReview: true,
      isActive: true,
      createdByUserId: ownerUserId,
      lastUsedAt: daysAgo(1),
      expiresAt: null,
      createdAt: daysAgo(30),
    },
    // 2) Admin key with an upcoming expiry, never used yet.
    {
      keyHash: seedKeyHash(2),
      name: 'Admin Automation Key',
      description: 'Full-access admin key for back-office automation. Rotates quarterly.',
      scopes: ['read', 'write', 'admin'],
      permissions: [],
      scopeReview: true,
      isActive: true,
      createdByUserId: adminUserId,
      lastUsedAt: null,
      expiresAt: daysFromNow(90),
      createdAt: daysAgo(10),
    },
    // 3) SCIM provisioning bearer token (read + write SCIM scopes).
    {
      keyHash: seedKeyHash(3),
      name: 'SCIM Provisioning Token',
      description: 'IdP SCIM 2.0 bearer token for user provisioning.',
      scopes: ['scim:read', 'scim:write'],
      permissions: [],
      scopeReview: false,
      isActive: true,
      createdByUserId: adminUserId,
      lastUsedAt: daysAgo(2),
      expiresAt: daysFromNow(365),
      createdAt: daysAgo(5),
    },
    // 4) Revoked + expired read-only key (inactive, past expiry).
    {
      keyHash: seedKeyHash(4),
      name: 'Legacy Reporting Key',
      description: 'Read-only key, revoked after a leak and now expired.',
      scopes: ['read'],
      permissions: [],
      scopeReview: true,
      isActive: false,
      createdByUserId: ownerUserId,
      lastUsedAt: daysAgo(60),
      expiresAt: daysAgo(15),
      createdAt: daysAgo(120),
    },
  ];

  const apiKeyRepo = ctx.repo<ApiKey>(ApiKey);
  let first: ApiKey | undefined;
  for (const def of apiKeyDefs) {
    const row = await foc(apiKeyRepo,
      { tenantId, keyHash: def.keyHash } as FindOptionsWhere<ApiKey>,
      { tenantId, ...def },
    );
    first ??= row;
  }

  // Publish a reference later modules might consume.
  if (first) refs.apiKeyId = first.apiKeyId;

  // ── Scope catalogue (descriptive master-data) ──────────────────────────────
  type ScopeDef = { scope: string; label: string; description: string | null; category: string; isActive: boolean; deleted?: boolean };
  const scopeDefs: ScopeDef[] = [
    { scope: 'read', label: 'Read', description: 'Read access to every resource the key owner can see.', category: 'Core', isActive: true },
    { scope: 'write', label: 'Write', description: 'Create and change data. Implies read.', category: 'Core', isActive: true },
    { scope: 'admin', label: 'Administrator', description: 'Full access, including key and settings management.', category: 'Core', isActive: true },
    { scope: 'scim:read', label: 'SCIM read', description: 'Read users and groups through the SCIM 2.0 API.', category: 'SCIM', isActive: true },
    { scope: 'scim:write', label: 'SCIM write', description: 'Provision users and groups through the SCIM 2.0 API.', category: 'SCIM', isActive: true },
    { scope: 'invoices:read', label: 'Invoices (read)', description: 'List and download invoices.', category: 'Billing', isActive: true },
    { scope: 'invoices:write', label: 'Invoices (write)', description: 'Create and void invoices. Implies invoices:read.', category: 'Billing', isActive: true },
    { scope: 'orders:*', label: 'Orders (any action)', description: 'Every action on orders; the wildcard form of a resource scope.', category: 'Commerce', isActive: true },
    { scope: 'users:read', label: 'Users (read)', description: null, category: 'Identity', isActive: true },
    { scope: 'webhooks:write', label: 'Webhooks (write)', description: 'Manage webhook endpoints.', category: 'Integrations', isActive: true },
    // Documented but switched off: shown greyed out in the picker.
    { scope: 'reports:read', label: 'Reports (read)', description: 'Retired: reports moved to the analytics API.', category: 'General', isActive: false },
    // Deleted from the catalogue, kept for history.
    { scope: 'legacy:admin', label: 'Legacy admin', description: 'Removed with the legacy integration.', category: 'General', isActive: false, deleted: true },
  ];
  const scopeRepo = ctx.repo<ApiKeyScopeDefinition>(ApiKeyScopeDefinition);
  for (const def of scopeDefs) {
    // Every seeded scope token must be valid under the production grammar.
    if (!AnyScopeSchema.safeParse(def.scope).success) throw new Error(`api_key seed: invalid scope token "${def.scope}"`);
    // Soft-deleted rows are invisible to `foc` but still hold the unique (tenantId, scope).
    const existing = await scopeRepo.findOne({ where: { tenantId, scope: def.scope } as FindOptionsWhere<ApiKeyScopeDefinition>, withDeleted: true });
    if (existing) continue;
    await scopeRepo.save(scopeRepo.create({
      tenantId, scope: def.scope, label: def.label, description: def.description,
      category: def.category, isActive: def.isActive,
      deletedAt: def.deleted ? daysAgo(30) : undefined,
    }));
  }

  ctx.log(`api_key: 4 keys (read/write, admin, scim, revoked) and ${scopeDefs.length} scope definitions for ${tenantId}`);
}
