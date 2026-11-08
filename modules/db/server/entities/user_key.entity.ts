import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, Index, Check } from 'typeorm';
import type { TenantKeyProviderKind, TenantKeyState } from './tenant_key.entity';

/**
 * One per-user data key (UDEK, decision F27 of docs/phases/02-fleet/decisions-2026-10-18.md; P7-TDEK): the 32-byte AES key that encrypts a PERSON's
 * user-level secrets (the `user_social_accounts` OAuth tokens, the auth TOTP secret `user_securities.otpSecret`) as field-encryption v2 envelopes
 * named by `kid` (`udek-<userId>-<generation>`). The secret belongs to the person, not to any one workspace: a home-tenant key would be shredded by
 * that tenant's purge while the user still works elsewhere, and the node key could never be crypto-shredded on the person's erasure.
 *
 * Same shape, lifecycle and provider machinery as `tenant_keys` (db.data-keys.ts): the key itself is never stored, `wrappedDek` is the key wrapped by
 * the node's key provider under the slot named `kid`, `escrowWrappedDek` a second wrap under `hold-<kid>` while a legal hold runs. Erasing the user
 * (account deletion) destroys the key (`USER_ERASURE`, final: no key is ever created for that user again).
 *
 * Its own table rather than a scope column on `tenant_keys`: purely additive (no constraint of `tenant_keys` is relaxed), a tenant code path that
 * joins or purges `tenant_keys` by `tenantId` can never meet a user's key, and the owner column says what it holds.
 *
 * Node-local and user-level by design: control database only, never in a tenant's dedicated database, a migration bundle (no tenant column) or a
 * tenant export; only the key service reads it, always in system context; RLS-exempt (gen-rls-policies.mts gives the reason). Every CHECK and index
 * is mirrored by migration db 004 under the same name; the migration's guard trigger keeps a destroyed key destroyed.
 */
@Entity('user_keys')
@Index('uq_user_keys_active', ['userId'], { unique: true, where: `"state" = 'ACTIVE'` })
@Index('uq_user_keys_generation', ['userId', 'generation'], { unique: true })
@Index('ix_user_keys_slots_pending', ['userId'], { where: `"slotsPendingAt" IS NOT NULL` })
@Check('ck_user_keys_kid', `"generation" >= 1 AND "kid" = 'udek-' || "userId"::text || '-' || "generation"::text`)
@Check('ck_user_keys_state', `"state" IN ('ACTIVE', 'RETIRED', 'DESTROYED') AND ("state" = 'DESTROYED') = ("wrappedDek" IS NULL) AND ("state" = 'DESTROYED') = ("destroyedAt" IS NOT NULL) AND ("destroyedAt" IS NULL) = ("destroyReason" IS NULL) AND ("state" <> 'RETIRED' OR "retiredAt" IS NOT NULL)`)
@Check('ck_user_keys_provider', `"provider" IN ('node-key', 'file', 'kms', 'vault')`)
@Check('ck_user_keys_escrow', `("escrowWrappedDek" IS NULL) = ("escrowUntil" IS NULL)`)
export class UserKey {
  /** `udek-<userId>-<generation>`: the kid of the v2 envelopes this key writes. */
  @PrimaryColumn({ type: 'varchar', length: 80 })
  kid!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  /** 1 for the first key of a user; a rotation (compromise only) adds the next one. */
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

  /** Why the key was destroyed: USER_ERASURE | COMPROMISE | OPERATOR. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  destroyReason!: string | null;

  /** When a destroy of this key last failed to destroy one of its provider slots; null when every slot it could reach is gone (a rerun clears it). */
  @Column({ type: 'timestamptz', nullable: true })
  slotsPendingAt!: Date | null;
}
