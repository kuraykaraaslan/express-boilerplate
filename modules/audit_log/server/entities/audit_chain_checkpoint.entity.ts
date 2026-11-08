import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, Check } from 'typeorm';

/**
 * A retention purge of a sealed chain, recorded BEFORE any row is deleted (docs/phases/02-fleet/04-security-model.md section 7).
 *
 * The oldest kept row of a purged chain names a predecessor that no longer exists, so without a record of what was deleted the verifier cannot tell a
 * purge from tampering. A checkpoint says: every row of this tenant up to and including `(coveredThrough, coveredThroughId)` was removed on purpose, the last
 * of them hashed to `headHash`, and `rowCount` rows went with it. The verifier starts from the newest checkpoint: the first kept row must link to
 * `headHash` and nothing else.
 *
 * Written ONLY by the `audit_chain_checkpoint` function (migration 007), which refuses to cover a row the control plane has not acknowledged
 * (`audit_chain_anchors`) or one younger than the tenant's retention window; `audit_chain_purge` deletes only what the newest checkpoint covers.
 * `purgedTotal` is the running total, so the row count of the chain over its whole life (checkpointed rows included) is `purgedTotal` plus what is kept.
 */
@Entity('audit_chain_checkpoints')
@Index('IDX_audit_chain_checkpoints_tenant_through', ['tenantId', 'coveredThrough'])
@Check('ck_audit_chain_checkpoints_values', `"headHash" ~ '^[a-f0-9]{64}$' AND "rowCount" > 0 AND "purgedTotal" >= "rowCount"`)
export class AuditChainCheckpoint {
  // gen_random_uuid(), not uuid_generate_v4(): a built-in, so the table and the functions that insert into it work in a schema without uuid-ossp
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  checkpointId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** `createdAt` of the last row this checkpoint covers (the chain is ordered by createdAt, then auditLogId). */
  @Column({ type: 'timestamp' })
  coveredThrough!: Date;

  /** `auditLogId` of that row, the tie-break of the order. */
  @Column({ type: 'uuid' })
  coveredThroughId!: string;

  /** `rowHash` of that row: what the first kept row's `prevHash` must be. */
  @Column({ type: 'varchar', length: 64 })
  headHash!: string;

  /** Rows this checkpoint covers (those between the previous checkpoint and this one). */
  @Column({ type: 'int' })
  rowCount!: number;

  /** Rows purged from this chain over its whole life, this checkpoint included. */
  @Column({ type: 'bigint' })
  purgedTotal!: string;

  /** The acknowledged anchor (`audit_chain_anchors.anchorId`) that proved the covered rows were witnessed by the control plane. */
  @Column({ type: 'uuid' })
  anchorId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
