import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/** Why the tenant's own row forbids a deletion right now (docs/phases/02-fleet/05 section 7 stage 9), or null. */
export type FleetDeletionBlock = 'LEGAL_HOLD' | 'MIGRATION_IN_PROGRESS' | 'TOMBSTONE_ACTIVE';

/** The columns of the tenant row the built-in deletion rules read. */
export interface DeletionFacts {
  tenantStatus: string;
  legalHoldUntil?: Date | null;
  tombstoneUntil?: Date | null;
}

/**
 * The tenant's own reasons to refuse a deletion, read from its row: a legal hold that has not run out (it blocks deletion and migration and
 * nothing else), a migration in flight on either side (the source is MIGRATING, the target IMPORTING: deleting either half loses the tenant),
 * and the tombstone a cutover left (RELOCATED) until it expires, because the redirect it serves is how the tenant's users find the new home.
 * Built in rather than contributed: these are facts about the tenant row itself, and they must hold whichever modules are loaded.
 */
export function fleetDeletionBlock(t: DeletionFacts, now: Date = new Date()): FleetDeletionBlock | null {
  if (t.legalHoldUntil && t.legalHoldUntil.getTime() > now.getTime()) return 'LEGAL_HOLD';
  if (t.tenantStatus === 'MIGRATING' || t.tenantStatus === 'IMPORTING') return 'MIGRATION_IN_PROGRESS';
  if (t.tenantStatus === 'RELOCATED' && t.tombstoneUntil && t.tombstoneUntil.getTime() > now.getTime()) return 'TOMBSTONE_ACTIVE';
  return null;
}

const BLOCK_MESSAGES: Record<FleetDeletionBlock, string> = {
  LEGAL_HOLD: 'Tenant is under a legal hold and cannot be deleted',
  MIGRATION_IN_PROGRESS: 'Tenant is being migrated and cannot be deleted',
  TOMBSTONE_ACTIVE: 'Tenant was relocated and its redirect is still in force; it cannot be deleted yet',
};

/** Throws 409 with the reason when {@link fleetDeletionBlock} objects. */
export function assertNoFleetDeletionBlock(t: DeletionFacts, now?: Date): void {
  const block = fleetDeletionBlock(t, now);
  if (block) throw new AppError(BLOCK_MESSAGES[block], 409, ErrorCode.CONFLICT);
}
