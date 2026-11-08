import { z } from 'zod';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** A node id as the control plane issues it (`node:<id>` issuers use the same pattern); a UUID is one. */
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Migration contract (02/02 section on fleet_tenant_migrations.contract): signed by approvers, embedded in every step. */
export const MigrationContractSchema = z
  .object({
    migrationId: z.uuid(),
    tenantId: z.uuid(),
    sourceNodeId: nodeId,
    targetNodeId: nodeId,
    targetNodeFingerprint: sha256,
    legalBasis: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    legalBasisRef: z.string().min(1).max(256),
    consentRef: z.string().min(1).max(256).optional(),
    exp: z.number().int().positive(),
  })
  .strict()
  .refine((c) => c.sourceNodeId !== c.targetNodeId, { message: 'source and target must differ' });
export type MigrationContract = z.infer<typeof MigrationContractSchema>;

export const ApproverSignatureSchema = z
  .object({ operatorId: z.uuid(), kid: z.string().min(1).max(128), sig: z.string().min(1).max(512) })
  .strict();

export const SignedMigrationContractSchema = z
  .object({ contract: MigrationContractSchema, approvals: z.array(ApproverSignatureSchema).min(2).max(8) })
  .strict()
  .refine((s) => new Set(s.approvals.map((a) => a.operatorId)).size === s.approvals.length, {
    message: 'approvers must be distinct',
  });
export type SignedMigrationContract = z.infer<typeof SignedMigrationContractSchema>;

/**
 * Schema migration contract (docs/phases/02-fleet 07 section 5.1 and 5.3, T13). Not to be confused with the tenant
 * `MigrationContract` above: this one governs the numbered SQL migrations a release carries, in three phases.
 *
 * - `expand`:   additive and N-1 safe (new nullable column, new table); stays on rollback, N-1 code ignores it.
 * - `migrate`:  data movement between expand and contract (backfill); `reversible` says whether a rollback can undo it.
 * - `contract`: destructive (drop, narrow, rename away); never reversible, so a release with one is `compatibleWithPrevious=false`.
 *
 * Rules, all pure so the control plane (publish), `fleet-deployd` (run, rollback) and tests share one definition:
 * 1. within a release the phases never go backwards (expand, then migrate, then contract);
 * 2. a release with a `contract` step cannot claim `compatibleWithPrevious`, and a `contract` step cannot claim `reversible`;
 * 3. a `contract` step runs only inside an open SYSTEM maintenance window in READ_ONLY (or the stricter FULL) mode, after the pre-deploy backup;
 * 4. rollback is refused, not attempted, across a `contract` step, an incompatible release or an irreversible data migration.
 */
export const MIGRATION_PHASES = ['expand', 'migrate', 'contract'] as const;
export type MigrationPhase = (typeof MIGRATION_PHASES)[number];
export const MigrationPhaseSchema = z.enum(MIGRATION_PHASES);

export const ReleaseMigrationSchema = z
  .object({
    name: z.string().min(1).max(256),
    checksum: sha256,
    kind: MigrationPhaseSchema,
    reversible: z.boolean(),
  })
  .strict();
export type ReleaseMigration = z.infer<typeof ReleaseMigrationSchema>;

export type MigrationContractDecision =
  | 'REJECTED_PHASE_ORDER'
  | 'REJECTED_DUPLICATE_MIGRATION'
  | 'REJECTED_CONTRACT_COMPAT'
  | 'REJECTED_CONTRACT_REVERSIBLE'
  | 'REJECTED_NOT_READ_ONLY'
  | 'REJECTED_NO_BACKUP'
  | 'REJECTED_ROLLBACK_ACROSS_CONTRACT'
  | 'REJECTED_ROLLBACK_INCOMPATIBLE'
  | 'REJECTED_ROLLBACK_IRREVERSIBLE';

type PhaseEntry = Pick<ReleaseMigration, 'kind'>;

const PHASE_RANK: Readonly<Record<MigrationPhase, number>> = { expand: 0, migrate: 1, contract: 2 };

function phasesGoBackwards(list: ReadonlyArray<PhaseEntry>): boolean {
  let max = 0;
  for (const m of list) {
    // Own keys only: an unknown kind (`toString`, `__proto__`) must read as unknown, never as an inherited member.
    const rank = Object.hasOwn(PHASE_RANK, m.kind) ? PHASE_RANK[m.kind] : undefined;
    if (rank === undefined || rank < max) return true;
    max = rank;
  }
  return false;
}

/** What a release manifest may contain (checked at publish, by the manifest schema, and again by the helper). */
export function checkMigrationPlan(
  migrations: ReadonlyArray<ReleaseMigration>,
  release: { compatibleWithPrevious: boolean },
): MigrationContractDecision | null {
  if (phasesGoBackwards(migrations)) return 'REJECTED_PHASE_ORDER';
  if (new Set(migrations.map((m) => m.name)).size !== migrations.length) return 'REJECTED_DUPLICATE_MIGRATION';
  const hasContract = migrations.some((m) => m.kind === 'contract');
  if (hasContract && release.compatibleWithPrevious) return 'REJECTED_CONTRACT_COMPAT';
  if (migrations.some((m) => m.kind === 'contract' && m.reversible)) return 'REJECTED_CONTRACT_REVERSIBLE';
  return null;
}

/** The maintenance window the node is in when the helper is about to run `pending` (shape of the `maintenance.open` body). */
export interface MaintenanceWindowState {
  scope: 'SYSTEM' | 'TENANT';
  mode: 'FULL' | 'READ_ONLY';
}

/** Gate for `fleet-deployd migrate`: contract steps need a SYSTEM READ_ONLY (or FULL) window and the automatic pre-deploy backup. */
export function checkMigrationWindow(i: {
  pending: ReadonlyArray<PhaseEntry>;
  window: MaintenanceWindowState | null;
  backupTaken: boolean;
}): MigrationContractDecision | null {
  if (phasesGoBackwards(i.pending)) return 'REJECTED_PHASE_ORDER';
  if (!i.pending.some((m) => m.kind === 'contract')) return null;
  const w = i.window;
  if (!w || w.scope !== 'SYSTEM' || (w.mode !== 'READ_ONLY' && w.mode !== 'FULL')) return 'REJECTED_NOT_READ_ONLY';
  if (i.backupTaken !== true) return 'REJECTED_NO_BACKUP';
  return null;
}

/**
 * Gate for `release.rollback`: `undone` lists every release a rollback would step back over (the current one and any
 * between it and the target). Refuses across a contract step first, then an incompatible release, then an irreversible data migration.
 */
export function checkRollback(
  undone: ReadonlyArray<{ version: string; compatibleWithPrevious: boolean; migrations: ReadonlyArray<ReleaseMigration> }>,
): MigrationContractDecision | null {
  if (undone.some((r) => r.migrations.some((m) => m.kind === 'contract'))) return 'REJECTED_ROLLBACK_ACROSS_CONTRACT';
  if (undone.some((r) => !r.compatibleWithPrevious)) return 'REJECTED_ROLLBACK_INCOMPATIBLE';
  if (undone.some((r) => r.migrations.some((m) => m.kind === 'migrate' && !m.reversible))) return 'REJECTED_ROLLBACK_IRREVERSIBLE';
  return null;
}
