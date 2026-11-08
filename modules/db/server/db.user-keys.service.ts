import type { DataSource, EntityManager } from 'typeorm';
import { UserKey } from './entities/user_key.entity';
import {
  DataKeyService, type DataKeyRow, UUID_RE, nodeDataKeyProvider, registerDataKeyScope, type DataKeyDestroyReportBase, type DataKeyScope, type DataKeyServiceDeps,
} from './db.data-keys';

/**
 * The per-user data keys (UDEK) of field-encryption v2 (decision F27 of docs/phases/02-fleet/decisions-2026-10-18.md; P7-TDEK): a person's
 * user-level secrets (the `user_social_accounts` OAuth tokens, the auth TOTP secret `user_securities.otpSecret`, declared with `keyScope: 'user'` on
 * `db:tenant_key_columns`) are encrypted as `v2.udek-<userId>-<generation>.<iv>.<ct>.<tag>` under the user's ACTIVE key.
 *
 * The same engine as the tenant keys (db.data-keys.ts: generate, wrap, cache, rotate, destroy, escrow; the node's one provider and key store), on its
 * own table `user_keys` (db 004). What is specific to a user:
 *
 *  - User binding: `decrypt(userId, value)` refuses an envelope under another user's key, and under any key that is not a user key (a tenant's),
 *    as `WRONG_USER` (counted), before anything opens: a token copied into another person's row never opens in that person's context. The column
 *    transformer (common `encryptedColumnTransformer`) keeps such an envelope sealed, because it cannot know whose row it reads.
 *  - Dual read (F17): a v1 or node-key v2 envelope written before F27, and a legacy plaintext, still read; the online backfill
 *    (db.tenant-key-backfill.ts, user-scope sets) moves them under the user's key.
 *  - Crypto-shredding: erasing the person (the account deletion of privacy self-service, the hard delete of the user module) calls
 *    `recordErasure(userId, 'USER_ERASURE')` and then `destroy(userId, 'USER_ERASURE')`; an identity merge does the same for the merged-away
 *    placeholder with `USER_MERGED`. Both reasons are final, and the final record (`user_key_erasures`, db 005) is what makes them so: from
 *    `recordErasure` on no key is ever created for the user again, whether or not they had one (a straggling write, or the backfill re-sealing a
 *    leftover legacy value, fails instead of starting a fresh key), and the record stays pending (`keysDestroyedAt` null) until a destroy marked
 *    every key DESTROYED. `retryErasures` (run by the `db-tenant-key-backfill` worker) reruns the destroys still owed and the provider slots a
 *    destroy left (`slotsPendingAt`). The report says whether the destruction reaches database backups (`shredsBackups`: the provider keeps its
 *    slots outside the database and every slot went); a caller that knows of legacy values (sealed only at erasure time, so a backup holds them in
 *    their old shape) discounts it, as the tenant purge does.
 *  - A user's key is never part of a tenant's purge, a tenant's migration export or a tenant bundle: it belongs to the person, on this node.
 */

export const USER_KID_RE = /^udek-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([1-9][0-9]{0,8})$/;

export function userKidOf(userId: string, generation: number): string {
  if (!UUID_RE.test(userId)) throw new Error('user keys: userId must be a lower-case uuid');
  if (!Number.isInteger(generation) || generation < 1) throw new Error('user keys: generation must be a positive integer');
  return `udek-${userId}-${generation}`;
}

export function parseUserKid(kid: string): { userId: string; generation: number } | null {
  const m = USER_KID_RE.exec(kid);
  return m ? { userId: m[1], generation: Number(m[2]) } : null;
}

/**
 * Why a user key was destroyed (`user_keys.destroyReason`). `USER_ERASURE` (the person was erased) and `USER_MERGED` (a placeholder account merged
 * into a real one) are final: no key is ever created for the user again.
 */
export type UserKeyDestroyReason = 'USER_ERASURE' | 'USER_MERGED' | 'COMPROMISE' | 'OPERATOR';

/** The final reasons, recorded on `user_key_erasures`. */
export type UserKeyFinalReason = Extract<UserKeyDestroyReason, 'USER_ERASURE' | 'USER_MERGED'>;
const FINAL_REASONS: readonly UserKeyFinalReason[] = ['USER_ERASURE', 'USER_MERGED'];

export interface UserKeyRetryResult {
  /** Final records still owed a destroy that this run took up, and how many of those destroys went through. */
  erasures: number;
  destroyed: number;
  /** Users whose pending provider slots this run retried, and the slots still pending after it. */
  slotUsers: number;
  pendingSlots: number;
  /** Destroys or slot retries that threw (the record stays pending; the next run retries). */
  failed: number;
}

export interface UserKeyDestroyReport extends DataKeyDestroyReportBase {
  userId: string;
}

const USER_SCOPE: DataKeyScope = {
  label: 'user',
  entity: UserKey,
  table: 'user_keys',
  ownerColumn: 'userId',
  kidOf: (userId, generation) => userKidOf(userId, generation),
  parseKid: (kid) => { const p = parseUserKid(kid); return p ? { ownerId: p.userId, generation: p.generation } : null; },
  wrongOwnerReason: 'WRONG_USER',
  finalReasons: FINAL_REASONS,
  finalMessage: 'the user was erased: no new key is created for them',
};

export class UserKeyService extends DataKeyService {
  constructor(deps: DataKeyServiceDeps) {
    super(deps, USER_SCOPE);
  }

  /**
   * Reads a user-level secret in the context of `userId` (dual read): a legacy plaintext passes through, a v1 or node-key envelope opens under the
   * node key, a user envelope opens only under THIS user's key. Throws a counted `FieldDecryptError`: WRONG_USER for another user's key or a key
   * that is not a user key, KEY_UNAVAILABLE for a destroyed or unknown key, AUTH_FAILED for a damaged value. A database or key-store fault
   * propagates as itself.
   */
  async decrypt(userId: string, value: string): Promise<string> {
    this.checkOwner(userId);
    return this.openFor(userId, value);
  }

  /**
   * Destroys every live key of the user (crypto-shredding); see `DataKeyService.destroyKeys`. With a final reason the final record is written (or
   * closed: `keysDestroyedAt`) in the same transaction as the rows, also for a user who never had a key. The caller records the report.
   */
  async destroy(userId: string, reason: UserKeyDestroyReason): Promise<UserKeyDestroyReport> {
    return { userId, ...(await this.destroyKeys(userId, reason)) };
  }

  /**
   * Writes the final record of the user's erasure (idempotent: an existing record keeps its reason and time), before anything is destroyed: from
   * here on no key is created for the user, and the destroy is owed until one marks every key DESTROYED (`retryErasures` reruns it). Needs the
   * database only, never the key provider, so it holds when the key store is the part that is down.
   */
  async recordErasure(userId: string, reason: UserKeyFinalReason): Promise<void> {
    this.checkOwner(userId);
    if (!FINAL_REASONS.includes(reason)) throw new Error('user keys: an erasure reason is USER_ERASURE or USER_MERGED');
    const ds = await this.deps.dataSource();
    await ds.transaction(async (m) => {
      await this.lock(m, userId);
      await m.query(
        `INSERT INTO "user_key_erasures" ("userId", "reason", "requestedAt") VALUES ($1, $2, $3) ON CONFLICT ("userId") DO NOTHING`,
        [userId, reason, new Date(this.now())],
      );
    });
  }

  /** Whether the user's erasure is recorded (final), and whether its destroy has been done. Null when there is no record. */
  async erasureOf(userId: string): Promise<{ reason: UserKeyFinalReason; keysDestroyedAt: Date | null } | null> {
    this.checkOwner(userId);
    const rows = await (await this.deps.dataSource()).query(
      `SELECT "reason", "keysDestroyedAt" FROM "user_key_erasures" WHERE "userId" = $1`, [userId],
    ) as Array<{ reason: UserKeyFinalReason; keysDestroyedAt: Date | null }>;
    return rows[0] ?? null;
  }

  /**
   * The retry of what an erasure still owes: every final record whose destroy has not been done (`keysDestroyedAt` null: a destroy that threw, or
   * a hard delete whose destroy failed after the user row was gone) is destroyed again with its reason, and every DESTROYED key of a user with a
   * provider slot still pending (`slotsPendingAt`) has its slots retried (`retryPendingSlots`, which never touches a live key). Bounded per run.
   */
  async retryErasures(opts: { limit?: number } = {}): Promise<UserKeyRetryResult> {
    const limit = Math.max(1, Math.floor(opts.limit ?? 100));
    const out: UserKeyRetryResult = { erasures: 0, destroyed: 0, slotUsers: 0, pendingSlots: 0, failed: 0 };
    const ds: DataSource = await this.deps.dataSource();
    const owed = await ds.query(
      `SELECT "userId"::text AS "userId", "reason" FROM "user_key_erasures" WHERE "keysDestroyedAt" IS NULL ORDER BY "requestedAt" LIMIT $1`, [limit],
    ) as Array<{ userId: string; reason: UserKeyFinalReason }>;
    for (const { userId, reason } of owed) {
      out.erasures += 1;
      try { await this.destroy(userId, reason); out.destroyed += 1; } catch { out.failed += 1; }
    }
    const slotted = await ds.query(
      `SELECT DISTINCT "userId"::text AS "userId" FROM "user_keys" WHERE "slotsPendingAt" IS NOT NULL AND "state" = 'DESTROYED' LIMIT $1`, [limit],
    ) as Array<{ userId: string }>;
    for (const { userId } of slotted) {
      out.slotUsers += 1;
      try { out.pendingSlots += (await this.retryPendingSlots(userId)).length; } catch { out.failed += 1; }
    }
    return out;
  }

  protected override async isFinal(m: EntityManager, userId: string, rows: DataKeyRow[]): Promise<boolean> {
    if (await super.isFinal(m, userId, rows)) return true;
    const found = await m.query(`SELECT 1 FROM "user_key_erasures" WHERE "userId" = $1`, [userId]) as unknown[];
    return found.length > 0;
  }

  protected override async onFinalDestroy(m: EntityManager, userId: string, reason: string): Promise<void> {
    const at = new Date(this.now());
    await m.query(
      `INSERT INTO "user_key_erasures" ("userId", "reason", "requestedAt", "keysDestroyedAt") VALUES ($1, $2, $3, $3)
       ON CONFLICT ("userId") DO UPDATE SET "keysDestroyedAt" = EXCLUDED."keysDestroyedAt" WHERE "user_key_erasures"."keysDestroyedAt" IS NULL`,
      [userId, reason, at],
    );
  }
}

/** The process-wide service on the node's control database and the node's provider (shared with the tenant keys). */
export const userKeys = new UserKeyService({
  dataSource: async () => (await import('./db.datasource')).getSystemDataSource(),
  provider: nodeDataKeyProvider,
});

registerDataKeyScope('udek-', userKeys);
