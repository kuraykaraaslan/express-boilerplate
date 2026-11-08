import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * The external anchor of a tenant's approval chain (approval.08, 2026-10-20).
 *
 * The chain itself cannot see its own tail: deleting the newest items leaves a shorter chain that still links, and an
 * emptied queue verified as "ok, 0 checked". This row is written in the SAME transaction as every link
 * (`chainOnInsert`, under the per-tenant advisory lock) and records the hash of the newest row and the number of rows on
 * the chain. `verifyChain` compares the walk's tip and length against it, so a truncated or emptied chain is reported.
 * `seal` (approval.constants `approvalHeadSeal`) binds the row to the chain key. One row per tenant; never deleted by the application.
 */
@Entity('approval_chain_heads')
export class ApprovalChainHead {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  /** The rowHash of the newest row on the chain. */
  @Column({ type: 'varchar', length: 64 })
  headHash!: string;

  /** How many rows the chain holds, the head included. */
  @Column({ type: 'int' })
  length!: number;

  /** Keyed HMAC over (tenant, headHash, length): the anchor cannot be edited to match a truncated chain without the server key. */
  @Column({ type: 'varchar', length: 64 })
  seal!: string;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
