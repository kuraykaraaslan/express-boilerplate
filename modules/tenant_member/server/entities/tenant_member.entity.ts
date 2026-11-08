import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index, Unique } from 'typeorm';

@Unique(['tenantId', 'userId'])
@Entity('tenant_members')
export class TenantMember {
  @PrimaryGeneratedColumn('uuid', { name: 'tenantMemberId' })
  tenantMemberId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', default: 'USER' })
  memberRole!: string;

  /**
   * Custom role keys this member also holds (auth_abac phase 6.2).
   *
   * `memberRole` stays the PRIMARY, built-in role and keeps every guard,
   * webhook and demote-the-last-OWNER rule working unchanged. This is purely
   * additive: `tenant_roles` could already hold a custom group with its own
   * permissions and the matrix UI could edit one, but no member could be put
   * in it — `memberRole` is a three-value enum. A group nobody can join is a
   * feature that exists only in its own admin screen.
   *
   * Additive in the grant direction too: a custom role can only ever ADD
   * permissions on top of the built-in role's matrix, never remove one. That
   * keeps the migration safe (an existing member gains nothing until somebody
   * assigns them a group) and keeps the removal story in one place — the
   * matrix — instead of two that can disagree.
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  roleKeys!: string[];

  @Column({ type: 'varchar', default: 'ACTIVE' })
  memberStatus!: string;

  /**
   * SCIM 2.0 externalId — opaque identifier minted by the upstream IdP
   * (Okta/Azure AD/OneLogin/Google Workspace) for cross-system correlation.
   * Per tenant, externalIds must be unique when present; null is allowed
   * for members that were not provisioned via SCIM.
   *
   * Partial unique index is added via migration on
   * `(tenantId, externalId) WHERE externalId IS NOT NULL`.
   */
  @Index('IDX_tenant_members_tenant_external', ['tenantId', 'externalId'])
  @Column({ type: 'varchar', length: 256, nullable: true })
  externalId?: string | null;

  @Column({ type: 'int', default: 0 })
  sessionVersion!: number;

  // ── Suspension (reason + optional auto-expiry) ──────────────────────────
  @Column({ type: 'varchar', length: 512, nullable: true })
  suspensionReason?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  suspendedUntil?: Date | null;

  // ── Activity tracking ───────────────────────────────────────────────────
  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt?: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}
