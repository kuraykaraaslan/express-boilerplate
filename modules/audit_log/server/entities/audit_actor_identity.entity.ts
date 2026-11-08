import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, Check } from 'typeorm';

/**
 * The only place where a pseudonymous `audit_logs.actorRef` can be turned back into a person.
 *
 * Erasure (GDPR Art. 17) is the withdrawal of the actor id from the rows of an actor here (`audit_anonymise_actor`, migration 005): the audit
 * rows, and every column the chain hash covers, stay exactly as written, so the chain keeps verifying and the actor becomes unresolvable. The
 * mapping row itself STAYS as a tombstone (`actorId` NULL, `erasedAt` set): the writer inserts with ON CONFLICT DO NOTHING, so a deleted row
 * would be re-created with the real id by the actor's next write and every old row would resolve to the person again.
 *
 * Keyed on (tenantId, actorRef) because the reference is derived with a per-tenant key: the same person has a
 * different reference in every tenant. `keyVersion` records which version of the derivation key produced the
 * reference, so a later move to a rotated key leaves every old mapping resolvable (the reader never recomputes
 * a reference, it looks it up). Append-only by design (INSERT ... ON CONFLICT DO NOTHING; the only change is the erasure function).
 */
@Index('IDX_audit_actor_identities_actor', ['tenantId', 'actorId'])
@Check('ck_audit_actor_identities_erased', `("actorId" IS NULL) = ("erasedAt" IS NOT NULL)`)
@Entity('audit_actor_identities')
export class AuditActorIdentity {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  actorRef!: string;

  /** The person; NULL once erased (then `erasedAt` is set). */
  @Column({ type: 'uuid', nullable: true })
  actorId!: string | null;

  /** When the actor was erased; NULL while the mapping is live. */
  @Column({ type: 'timestamp', nullable: true })
  erasedAt!: Date | null;

  @Column({ type: 'smallint' })
  keyVersion!: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
