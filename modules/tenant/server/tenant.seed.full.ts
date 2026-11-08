import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { TenantSlugTombstone } from './entities/tenant_slug_tombstone.entity';

/**
 * Full-load seed for `tenant`: slug tombstones (`tenant_slug_tombstones`), the slugs of purged tenants
 * that may not be handed out again.
 *
 * Why not in the default seed: a tombstone is written only when a tenant is purged; in a real
 * deployment a fabricated one would claim a purge that never happened.
 *
 * How this stays harmless: the slugs are `seed-purged-*` (no real tenant uses that prefix) and the
 * tenant ids are synthetic (in no `tenants` table). The only effect is that those slugs cannot be
 * registered on the test database. Idempotent: keyed on the slug; dates are fixed.
 */
export async function seedTenantFull(ctx: SeedContext): Promise<void> {
  const repo = ctx.systemRepo<TenantSlugTombstone>(TenantSlugTombstone);
  const words = ['atlas', 'beacon', 'cobalt', 'delta', 'ember', 'fjord', 'granite', 'harbor', 'iris', 'juniper'];
  for (const [i, w] of words.entries()) {
    const slug = `seed-purged-${w}`;
    await ctx.foc(repo, { slug } as FindOptionsWhere<TenantSlugTombstone>, {
      slug, tenantId: `c0000000-0000-4000-8000-00000000a8${String(i).padStart(2, '0')}`, purgedAt: new Date(Date.UTC(2026, 0, 10 + i * 7)),
    });
  }
  ctx.log(`tenant(full): ${words.length} slug tombstones of synthetic purged tenants`);
}
