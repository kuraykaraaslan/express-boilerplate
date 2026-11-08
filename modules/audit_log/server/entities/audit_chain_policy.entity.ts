import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Check } from 'typeorm';

/**
 * Which chain a tenant's audit rows use. A row here overrides the role default (`single` = legacy, `node` and
 * `fleet` = sealed); no row means the role default.
 *
 *   legacy  the writer hashes in JavaScript (hashVersion NULL) and supplies the hash; the trigger passes it through.
 *   sealed  PostgreSQL hashes (hashVersion 2); a caller-supplied hash, actorId or onBehalfOfActorId is refused.
 *
 * The trigger of audit_log:003 reads this table itself, so the switch is enforced where the rows are written and
 * not only in the application. Written by the platform operator (app_admin) and by nothing in the request path;
 * until the REVOKE of a later release the database does not yet stop a runtime role from writing it, so treat a
 * runtime login that can run arbitrary SQL as able to downgrade a tenant (the owner connection is out of scope
 * for every table privilege anyway).
 *
 * One row per tenant (not a global row): tenant sessions only see their own rows under the generated RLS policy,
 * and the writer needs the answer inside the tenant's own database.
 */
@Check('ck_audit_chain_policy_mode', `"mode" IN ('legacy', 'sealed')`)
@Check('ck_audit_chain_policy_retention', `"retentionDays" IS NULL OR "retentionDays" > 0`)
@Entity('audit_chain_policy')
export class AuditChainPolicy {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 16 })
  mode!: 'legacy' | 'sealed';

  /**
   * How many days of a SEALED chain are kept; NULL keeps everything. The checkpoint function reads it from here, not from a tenant setting: the setting is
   * writable by a tenant admin, this table by the platform operator only (`app_admin`, once the privileges of audit hardening item 10 are in place).
   */
  @Column({ type: 'int', nullable: true })
  retentionDays!: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
