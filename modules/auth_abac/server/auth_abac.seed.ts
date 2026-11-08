import 'reflect-metadata';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { AbacPolicy } from './entities/auth_abac_policy.entity';
import { EXAMPLE_POLICIES } from './auth_abac.examples';

/**
 * Demo-data seed for the `auth_abac` module.
 *
 * ABAC enforcement is opt-in, so a fresh tenant has zero policies and the
 * Access Policies screen is empty. This seed gives every tenant the shared
 * {@link EXAMPLE_POLICIES} set so the screen is self-explanatory and the
 * dynamic_page pilot (phase 5) visibly enforces out of the box.
 *
 * Rules followed (see modules/tenant_member/server/tenant_member.seed.ts):
 *  - `AbacPolicy` HAS a `tenantId` column → tenant-scoped via `ctx.repo`.
 *  - Natural key is @Unique(['tenantId','name']) → re-runs reuse rows (foc).
 */
export async function seedAuthAbac(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx;
  const repo = ctx.repo<AbacPolicy>(AbacPolicy);

  for (const p of EXAMPLE_POLICIES) {
    await foc(
      repo,
      { tenantId, name: p.name },
      {
        tenantId,
        name: p.name,
        description: p.description,
        effect: p.effect,
        priority: p.priority,
        isActive: p.isActive,
        target: p.target,
        rules: p.rules,
      },
    );
  }
}
