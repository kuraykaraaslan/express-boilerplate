import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, Index, Check } from 'typeorm';

/** Lifecycle of a tenant data key: ACTIVE encrypts and decrypts, RETIRED only decrypts (after a rotation), DESTROYED is gone for good. */
export const TENANT_KEY_STATES = ['ACTIVE', 'RETIRED', 'DESTROYED'] as const;
export type TenantKeyState = (typeof TENANT_KEY_STATES)[number];

/** Where the key that wraps a tenant data key lives (db.key-provider.ts). `kms` and `vault` are interfaces only so far. */
export const TENANT_KEY_PROVIDERS = ['node-key', 'file', 'kms', 'vault'] as const;
export type TenantKeyProviderKind = (typeof TENANT_KEY_PROVIDERS)[number];

/**
 * One per-tenant data key (TDEK, docs/phases/02-fleet/04 section 3 level L3; P7-TDEK, F16): the 32-byte AES key that encrypts the tenant's
 * DECLARED sensitive columns (`db:tenant_key_columns`) as field-encryption v2 envelopes named by `kid` (`tdek-<tenantId>-<generation>`).
 *
 * The key itself is never stored: `wrappedDek` is the key wrapped by the node's key provider under the slot named `kid`, and `escrowWrappedDek`
 * a second wrap under the hold slot `hold-<kid>` while a legal hold keeps the key restorable (06 section 6: legal hold escrows rather than blocks).
 * Destroying a key (tenant purge: crypto-shredding) clears `wrappedDek` and destroys the provider slot; with the `file` provider the slot lives
 * outside this database, so a database backup taken before the purge cannot be decrypted either.
 *
 * Node-local and cross-tenant by design: it lives in the node's control database only (never in a tenant's dedicated database, never in a migration
 * bundle or a tenant export), only the key service reads it, always in system context; RLS-exempt (gen-rls-policies.mts gives the reason).
 * Every CHECK and index is mirrored by migrations db 002 and 003 under the same name; the migration's guard trigger keeps a destroyed key destroyed.
 */
@Entity('tenant_keys')
@Index('uq_tenant_keys_active', ['tenantId'], { unique: true, where: `"state" = 'ACTIVE'` })
@Index('uq_tenant_keys_generation', ['tenantId', 'generation'], { unique: true })
@Index('ix_tenant_keys_slots_pending', ['tenantId'], { where: `"slotsPendingAt" IS NOT NULL` })
@Check('ck_tenant_keys_kid', `"generation" >= 1 AND "kid" = 'tdek-' || "tenantId"::text || '-' || "generation"::text`)
@Check('ck_tenant_keys_state', `"state" IN ('ACTIVE', 'RETIRED', 'DESTROYED') AND ("state" = 'DESTROYED') = ("wrappedDek" IS NULL) AND ("state" = 'DESTROYED') = ("destroyedAt" IS NOT NULL) AND ("destroyedAt" IS NULL) = ("destroyReason" IS NULL) AND ("state" <> 'RETIRED' OR "retiredAt" IS NOT NULL)`)
@Check('ck_tenant_keys_provider', `"provider" IN ('node-key', 'file', 'kms', 'vault')`)
@Check('ck_tenant_keys_escrow', `("escrowWrappedDek" IS NULL) = ("escrowUntil" IS NULL)`)
export class TenantKey {
  /** `tdek-<tenantId>-<generation>`: the kid of the v2 envelopes this key writes. */
  @PrimaryColumn({ type: 'varchar', length: 80 })
  kid!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** 1 for the first key of a tenant; a rotation (compromise only, 04 section 3) adds the next one. */
  @Column({ type: 'integer' })
  generation!: number;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  state!: TenantKeyState;

  /** The provider that wrapped `wrappedDek` (a key wrapped by one provider is not opened by another). */
  @Column({ type: 'varchar', length: 16 })
  provider!: TenantKeyProviderKind;

  /** The data key wrapped under the provider slot `kid`; null once destroyed. Never a raw key. */
  @Column({ type: 'text', nullable: true })
  wrappedDek!: string | null;

  /** The data key wrapped under the hold slot `hold-<kid>` while a legal hold is in force; null otherwise. */
  @Column({ type: 'text', nullable: true })
  escrowWrappedDek!: string | null;

  /** Until when the escrow is kept (the hold's end); set together with `escrowWrappedDek`. */
  @Column({ type: 'timestamptz', nullable: true })
  escrowUntil!: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  destroyedAt!: Date | null;

  /** Why the key was destroyed: TENANT_PURGE | COMPROMISE | OPERATOR. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  destroyReason!: string | null;

  /**
   * When a destroy of this key last failed to destroy one of its provider slots (db 003); null when every slot it could reach is gone. The
   * key-shredding sweep reruns the destroy for a key with this set, and a destroy that reaches every slot clears it.
   */
  @Column({ type: 'timestamptz', nullable: true })
  slotsPendingAt!: Date | null;
}
