import { FLEET_TENANT_ID, FLEET_TENANT_NAME, SEED_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';

/** The slice of a TypeORM repository the seed needs (kept narrow so it is testable without a database). */
export interface FleetTenantRepo {
  findOne(opts: { where: { tenantId: string }; withDeleted: boolean }): Promise<{ tenantId: string; name?: string | null; deletedAt?: Date | null } | null>;
  insert(row: { tenantId: string; name: string; description: string; tenantStatus: string }): Promise<unknown>;
}

/**
 * What tells the fleet row from a customer sitting at its id (phase 46, D46-5): the people and the hosts of the tenant at FLEET_TENANT_ID.
 * `controlPlane` (FLEET_ROLE=fleet): no check at all. A control plane never holds a customer tenant (the bootstrap seed never runs there),
 * and the fleet's own operators are members of the fleet tenant there.
 */
export interface FleetTenantInspect {
  members(tenantId: string): Promise<number>;
  domains(tenantId: string): Promise<number>;
  controlPlane?: boolean;
}

/**
 * Thrown when the row at FLEET_TENANT_ID is not what the fleet tenant is on a node: the deploy stops instead of treating it as the fleet. The
 * advice follows the evidence. Another name is a customer at the fleet id (the fleet tenant's name is fixed since phase 46): it is moved with
 * `tenant:rekey`. A row named Fleet is the fleet tenant itself, which a node never gives members or domains: those are removed (or the database
 * is a control plane's, which says FLEET_ROLE=fleet), and `tenant:rekey` refuses to move it, so it is never the advice there.
 */
export class FleetTenantCollisionError extends Error {
  constructor(readonly reasons: string[], readonly customer: boolean) {
    super(
      `[db-deploy] the tenant at the fleet id ${FLEET_TENANT_ID} is not the fleet tenant this node expects (${reasons.join('; ')}). `
      + (customer
        ? 'It is a customer at the fleet id: a database seeded before 2026-10-27 keeps its demo customer there. Move it with '
          + `\`npm run tenant:rekey -- --from ${FLEET_TENANT_ID} --to ${SEED_TENANT_ID}\` `
          + '(a backup and a dry run first; modules/db/README.md, "Moving a tenant to another id"), then deploy again.'
        : `It is named ${FLEET_TENANT_NAME}, so it is the fleet tenant with members or domains a node never gives it: remove them in the root console `
          + '(or, on a control plane, set FLEET_ROLE=fleet), then deploy again. Do not move it: tenant:rekey refuses the fleet tenant.'),
    );
    this.name = 'FleetTenantCollisionError';
  }
}

/**
 * Ensures the fleet tenant row exists (docs/phases/02-fleet README S6, Decision 19): one fixed-UUID row beside
 * ROOT on every deployment. Unlike the bootstrap seed this runs on EVERY deploy, so established databases gain
 * the row too. Idempotent; never touches an existing row (a soft-deleted one is reported, not resurrected).
 * Returns 'created' or 'present'.
 *
 * An existing row must BE the fleet tenant (phase 46, D46-5). Given `inspect` off the control plane, a row with another name, members or
 * domains is a customer that took the fleet id (the old bootstrap seed's Acme): that throws `FleetTenantCollisionError`, naming
 * `tenant:rekey`, instead of answering 'present', because a customer at this id is a reserved tenant with the operator-only modules on.
 */
export async function ensureFleetTenant(repo: FleetTenantRepo, inspect?: FleetTenantInspect): Promise<'created' | 'present'> {
  const existing = await repo.findOne({ where: { tenantId: FLEET_TENANT_ID }, withDeleted: true });
  if (existing) {
    if (inspect && !inspect.controlPlane) {
      const reasons: string[] = [];
      if (existing.name !== FLEET_TENANT_NAME) reasons.push(`its name is ${JSON.stringify(existing.name ?? null)}, not ${JSON.stringify(FLEET_TENANT_NAME)}`);
      const [members, domains] = await Promise.all([inspect.members(FLEET_TENANT_ID), inspect.domains(FLEET_TENANT_ID)]);
      if (members > 0) reasons.push(`it has ${members} member(s)`);
      if (domains > 0) reasons.push(`it has ${domains} domain(s)`);
      if (reasons.length) throw new FleetTenantCollisionError(reasons, existing.name !== FLEET_TENANT_NAME);
    }
    if (existing.deletedAt) console.warn('[db-deploy] fleet tenant row is soft-deleted; leaving it untouched — investigate.');
    return 'present';
  }
  await repo.insert({
    tenantId: FLEET_TENANT_ID,
    name: FLEET_TENANT_NAME,
    description: 'Fleet tenant — the federation identity inside this deployment (never a customer tenant)',
    tenantStatus: 'ACTIVE',
  });
  return 'created';
}
