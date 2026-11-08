import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, Check } from 'typeorm';

/**
 * What the control plane has acknowledged about one tenant's chain: the chain head (hash and row count) that was a leaf of an attestation whose ack the
 * node verified and stored (docs/phases/02-fleet/04-security-model.md section 7, "Anchoring"). It is the proof a retention checkpoint needs: rows up to
 * and including the anchored head have been witnessed outside the node, so deleting the oldest of them loses nothing the control plane cannot vouch for.
 *
 * Written by the node app when the agent reports a verified ack (the anchoring seam, audit hardening item 13); read by `audit_chain_checkpoint`. One row
 * per (tenant, attestation): the same attestation is never recorded twice.
 */
@Entity('audit_chain_anchors')
@Index('uq_audit_chain_anchors_attestation', ['tenantId', 'attestationId'], { unique: true })
@Index('IDX_audit_chain_anchors_tenant_acked', ['tenantId', 'ackedAt'])
@Check('ck_audit_chain_anchors_values', `"headHash" ~ '^[a-f0-9]{64}$' AND "rowCount" > 0`)
export class AuditChainAnchor {
  // gen_random_uuid(), not uuid_generate_v4(): a built-in, so the table and the functions that insert into it work in a schema without uuid-ossp
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  anchorId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** The attestation (and so the control-plane ack) this head came from. */
  @Column({ type: 'uuid' })
  attestationId!: string;

  /** `rowHash` of the chain head that attestation committed to. */
  @Column({ type: 'varchar', length: 64 })
  headHash!: string;

  /** Rows the chain held at that head. */
  @Column({ type: 'int' })
  rowCount!: number;

  /** When the control plane acknowledged it (`ackedAt` of the verified ack). */
  @Column({ type: 'timestamp' })
  ackedAt!: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
