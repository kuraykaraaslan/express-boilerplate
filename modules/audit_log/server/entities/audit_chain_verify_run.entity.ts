import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, Index, Check } from 'typeorm';

/**
 * One run of the weekly chain verification (`audit_log.verify.job.ts`): when it ran and what it found, counts only. The `audit.chain_ok` compliance
 * check reads the newest one (docs/phases/02-fleet/08 section 7: "the weekly chain verification is green on every sealed chain"), so a node that stopped
 * verifying, or whose last run found a break, cannot answer green. Node-level, no tenantId: RLS-exempt (modules/db/scripts/gen-rls-policies.mts).
 */
@Entity('audit_chain_verify_runs')
@Index('idx_audit_chain_verify_runs_finished', ['finishedAt'])
@Check('ck_audit_chain_verify_runs_values', `"tenants" >= 0 AND "checked" >= 0 AND "broken" >= 0 AND "errors" >= 0 AND "broken" + "errors" <= "tenants" AND "finishedAt" >= "startedAt"`)
export class AuditChainVerifyRun {
  // gen_random_uuid(): a built-in, so the table works in a schema without uuid-ossp on its search path (migrate mode).
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  runId!: string;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz' })
  finishedAt!: Date;

  /** Active tenants the run walked. */
  @Column({ type: 'int' })
  tenants!: number;

  /** Rows examined across the tenants that could be verified. */
  @Column({ type: 'bigint' })
  checked!: string;

  /** Tenants whose chain did not verify. */
  @Column({ type: 'int' })
  broken!: number;

  /** Tenants the verifier could not answer for at all. */
  @Column({ type: 'int' })
  errors!: number;
}
