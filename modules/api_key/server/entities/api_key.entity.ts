import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { SharedDatabaseOnly } from '@kuraykaraaslan-labs/db/server/db.shared-database';

// Pinned to the shared database (02-fleet F8): verify() finds a key by its hash before the tenant is known, so the row
// must be where that lookup reads, never in a tenant's own database. Use withSharedTenantRepositoryFor/TransactionFor.
@SharedDatabaseOnly()
@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid', { name: 'apiKeyId' })
  apiKeyId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // SHA-256 hash of the raw key — never store the raw key
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  keyHash!: string;

  // JSON array of scope strings: ["read", "write", "admin"]
  @Column({ type: 'simple-array', default: '' })
  scopes!: string[];

  // Environment namespace baked into the raw-key prefix: `live` → `sk_live_…`,
  // `test` → `sk_test_…`. Lets a tenant keep dev/staging/prod keys distinct and
  // prevents accidental cross-environment reuse.
  @Column({ type: 'varchar', default: 'live' })
  keyEnv!: string;

  // CIDR / IP allowlist for this key. Empty = no per-key restriction (the
  // tenant-wide default allowlist, if any, still applies).
  @Column({ type: 'simple-array', default: '' })
  ipAllowlist!: string[];

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt!: Date | null;

  // Last source IP observed on a successful verify — feeds anomaly detection.
  @Column({ type: 'varchar', nullable: true })
  lastUsedIp!: string | null;

  // Monotonic counter of successful verifications. Lets admins spot stale keys
  // and report on per-key activity beyond "was it used recently".
  @Column({ type: 'integer', default: 0 })
  usageCount!: number;

  // Successor key minted by a rotation. Set on the OLD key so consumers can
  // discover the replacement during the grace window.
  @Column({ type: 'uuid', nullable: true })
  successorKeyId!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  // api_key.03 (2026-10-20): a key works only while the member who minted it is an ACTIVE member of the tenant, unless an OWNER
  // marked it a service key (an integration the workspace owns, not a person's credential). Who marked it is kept for the audit.
  @Column({ type: 'boolean', default: false })
  isServiceKey!: boolean;

  @Column({ type: 'uuid', nullable: true })
  serviceKeyMarkedByUserId!: string | null;

  // Phase 48 (D11, D12): the module permission ids the key may use on module routes (the key lane of auth_abac's tenant guard),
  // always within its holder's current rights. NULL only on a row from before the phase: migration 002 turns it into an explicit
  // empty list (what such a key could do on module routes) and marks the key for review. Written explicitly on every insert.
  @Column({ type: 'simple-array', nullable: true })
  permissions!: string[] | null;

  // Phase 48 (D14): an admin should look at this key's grant (a key from before per-module permissions). Cleared by an edit of
  // its permissions or scopes, or by "Mark reviewed".
  @Column({ type: 'boolean', default: false })
  scopeReview!: boolean;

  // Phase 55 (D55-16, migration 003): when `update` last deactivated the key; cleared by its reactivation. Written only by that
  // transition, never by the usage stamp (`recordUsage`), which moves `updatedAt`: the firewall's revocation undo compares it to tell
  // its own deactivation from a later one. Null on an active key and on one deactivated before the column existed.
  @Column({ type: 'timestamptz', nullable: true })
  deactivatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
