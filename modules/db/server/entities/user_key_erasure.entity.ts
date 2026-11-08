import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, Index, Check } from 'typeorm';

/**
 * The durable, final record that a person's per-user data keys (decision F27, `user_keys`) must be gone and must never come back: written when the
 * person is erased (account deletion, hard delete) or retired by an identity merge (the placeholder account), BEFORE their keys are destroyed.
 *
 *  - Final: while a row exists for a user, the key service never creates a key for them (db.data-keys.ts `createKey`, under the same advisory lock),
 *    whether or not they ever had one. So a straggling write (a request on a session that was still valid, the online backfill re-sealing a legacy
 *    value left behind by a failed erasure step) fails instead of starting a fresh key nobody would ever destroy.
 *  - Retried: `keysDestroyedAt` stays null until a destroy has marked every key of the user DESTROYED (in the same transaction). The user-key retry
 *    (db.user-keys.service.ts `retryErasures`, run by the `db-tenant-key-backfill` worker) reruns the destroy for every row still null, so a destroy
 *    that failed (key store or database down) is finished later instead of being left to a log line.
 *
 * Holds the user id only (pseudonymous, like `account_deletions`), never key material. Node-local and user-level like `user_keys`: control database
 * only, read and written only by the key service in system context, RLS-exempt (gen-rls-policies.mts gives the reason). Mirrored by migration
 * db 005 under the same names; its guard trigger keeps a row from being deleted or reopened.
 */
@Entity('user_key_erasures')
@Index('ix_user_key_erasures_pending', ['requestedAt'], { where: `"keysDestroyedAt" IS NULL` })
@Check('ck_user_key_erasures_reason', `"reason" IN ('USER_ERASURE', 'USER_MERGED')`)
export class UserKeyErasure {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  /** USER_ERASURE (the person was erased) or USER_MERGED (a placeholder account merged into a real one). Both are final. */
  @Column({ type: 'varchar', length: 32 })
  reason!: 'USER_ERASURE' | 'USER_MERGED';

  @Column({ type: 'timestamptz', default: () => 'now()' })
  requestedAt!: Date;

  /** When a destroy marked every key of the user DESTROYED; null while a destroy is still owed (the retry picks it up). */
  @Column({ type: 'timestamptz', nullable: true })
  keysDestroyedAt!: Date | null;
}
