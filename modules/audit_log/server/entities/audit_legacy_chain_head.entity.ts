import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * The external anchor of a tenant's LEGACY (JavaScript-hashed) audit chain (audit_log.11 / .02, 2026-10-20).
 *
 * A hash chain cannot see its own tail: deleting the newest rows, or all of them, leaves a prefix that verifies. This row is written in the
 * SAME transaction as every legacy write (under the chain lock) and every retention purge, and says where the chain ends (`headHash`), how
 * many rows it holds (`rowCount`), and what its oldest kept row links to after a purge (`baseHash`, null for a chain that starts at its
 * genesis). `seal` is a keyed HMAC over the four, so the anchor cannot be edited to match a truncated chain without the server key.
 * A sealed (hashVersion 2) chain is anchored by its checkpoints and the control plane instead.
 */
@Entity('audit_legacy_chain_heads')
export class AuditLegacyChainHead {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  headHash!: string | null;

  @Column({ type: 'int' })
  rowCount!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  baseHash!: string | null;

  @Column({ type: 'varchar', length: 64 })
  seal!: string;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
