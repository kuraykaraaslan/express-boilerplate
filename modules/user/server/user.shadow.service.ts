import 'reflect-metadata';
import type { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from './entities/user.entity';
import { SafeUserSchema, type SafeUser } from './user.types';
import { invalidate } from './user.helpers';
import { cleanPreviousSubs, decideShadowEmail, isIdentitySub, retiredShadowEmail, shadowPlaceholderEmail, type ShadowEmailClaims } from './user.shadow.rules';

/**
 * Just-in-time shadow users of Fleet ID (FID-07; 12-fleet-identity.md section 4.2; decisions F10 and F14). The node relying party calls
 * `upsertShadowUser` after it verified an ID token; nothing else creates a row with an `identitySub`.
 *
 * - One row per pairwise subject (`uq_users_identity_sub`). Two concurrent first logins of the same person insert once and both get the row.
 * - A shadow row has no password, the role `USER` and nothing from the token but the subject and, when released, the address. A role, a status or
 *   a profile is never taken from the identity provider.
 * - No linking by e-mail, ever: when the released address already belongs to another row (a local account in an `optional` region, or another
 *   shadow), the shadow keeps the placeholder and the answer says `emailConflict`. Converting a local account into a shadow is the explicit `sub`
 *   transition of the migration bundle (FID-12), never a side effect of a login.
 * - A shadow that is not ACTIVE, or soft-deleted, is refused (`SHADOW_INACTIVE`): a suspension on the node outranks the hub.
 */
export type ShadowUpsertResult =
  | { ok: true; user: SafeUser; created: boolean; emailReleased: boolean; emailConflict: boolean; /** Shadow rows of earlier subjects re-keyed to this one or merged into it (decision F32): 0 for almost every login. */ continuity: { rekeyed: number; merged: number } }
  | { ok: false; code: 'BAD_SUBJECT' | 'SHADOW_INACTIVE' };

export interface ShadowUpsertInput extends ShadowEmailClaims {
  sub: string;
  /** false when the tenant being logged into opted out of the e-mail release (F10). */
  tenantAllowsRelease: boolean;
  /**
   * The previous subjects the hub reported (`fid_prev_subs`, decision F32): the person's subjects on the nodes a workspace of theirs moved from. The shadow rows
   * imported with that workspace still carry one of them; they are re-keyed to `sub` (or merged into the row `sub` already has), so the person lands in the
   * moved workspace with the role they held. Untrusted until `cleanPreviousSubs`.
   */
  previousSubs?: unknown;
}

type Row = Pick<UserEntity, 'userId' | 'email' | 'userStatus' | 'emailReleased' | 'identitySub' | 'deletedAt'>;

const UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (e: unknown): boolean =>
  (e as { driverError?: { code?: string }; code?: string })?.driverError?.code === UNIQUE_VIOLATION || (e as { code?: string })?.code === UNIQUE_VIOLATION;

async function findBySub(m: EntityManager, sub: string): Promise<Row | null> {
  return m.getRepository(UserEntity).createQueryBuilder('u').withDeleted()
    .select(['u.userId', 'u.email', 'u.userStatus', 'u.emailReleased', 'u.identitySub', 'u.deletedAt'])
    .where('u.identitySub = :sub', { sub }).getOne();
}

/** Inserts unless ANY unique key is taken (the subject by a concurrent first login, or the address by another row). True when it inserted. */
async function tryInsert(m: EntityManager, sub: string, email: string, released: boolean): Promise<boolean> {
  const r = await m.getRepository(UserEntity).createQueryBuilder().insert().into(UserEntity)
    .values({ email, password: null, identitySub: sub, emailReleased: released, emailVerifiedAt: released ? new Date() : null, userRole: 'USER', userStatus: 'ACTIVE' } as never)
    .orIgnore().returning(['userId']).execute();
  return Array.isArray(r.raw) && r.raw.length > 0;
}

/** Moves the row to `email`; false when another row holds that address. Bound to the subject, so it can never rewrite a local account. */
async function tryUpdateEmail(m: EntityManager, row: Row, email: string, released: boolean): Promise<boolean> {
  try {
    await m.getRepository(UserEntity).createQueryBuilder().update(UserEntity)
      .set({ email, emailReleased: released, emailVerifiedAt: released ? new Date() : null } as never)
      .where('"userId" = :id AND "identitySub" = :sub', { id: row.userId, sub: row.identitySub }).execute();
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

const NO_CONTINUITY = { rekeyed: 0, merged: 0 };

async function finish(m: EntityManager, sub: string, created: boolean, emailConflict: boolean, oldEmail: string | null, continuity = NO_CONTINUITY): Promise<ShadowUpsertResult> {
  const user = await m.getRepository(UserEntity).findOne({ where: { identitySub: sub } });
  if (!user) throw new Error('user.shadow: the row vanished during the upsert');
  await invalidate({ userId: user.userId, email: user.email });
  if (oldEmail && oldEmail !== user.email) await invalidate({ userId: user.userId, email: oldEmail });
  return { ok: true, user: SafeUserSchema.parse(user), created, emailReleased: user.emailReleased, emailConflict, continuity };
}

/**
 * The continuity of a moved workspace (decision F32): the shadow rows of the person's EARLIER subjects (imported with the workspace, or left by a failover) are
 * re-keyed to `sub`, or merged into the row `sub` already has. One transaction under an advisory lock keyed by the subject, so two concurrent first logins agree.
 *
 *  - No row holds `sub` yet: the oldest earlier row takes it (`UPDATE ... SET identitySub = sub WHERE userId AND identitySub = <the earlier subject>`, conditional,
 *    so a racing change loses nothing), memberships and every reference to its `userId` stay true. A second earlier row (the person's workspaces came from two
 *    nodes) is merged into it.
 *  - A row already holds `sub` (the person used another workspace here first): every earlier row is merged into it: its memberships are reassigned (a tenant the
 *    target already is a member of keeps the target's membership), then it is retired: no subject, an undeliverable address, soft-deleted.
 *
 * Why this cannot move someone else's access: `previousSubs` is a claim of the signed ID token the hub issued for THIS person and THIS node, built from the hub's
 * own workspace list; a subject that is not one of the person's earlier subjects is never in it. A row's role, status and e-mail are not read from the claim.
 */
async function carryOver(m: EntityManager, sub: string, previous: string[]): Promise<{ rekeyed: number; merged: number }> {
  if (previous.length === 0) return NO_CONTINUITY;
  const retired: { userId: string; email: string }[] = [];
  const result = await m.transaction(async (tx) => {
    await tx.query("SET LOCAL app.bypass_rls = 'on'");
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`shadow-continuity:${sub}`]);
    const earlier = await tx.getRepository(UserEntity).createQueryBuilder('u').withDeleted()
      .select(['u.userId', 'u.email', 'u.identitySub', 'u.deletedAt']).where('u.identitySub IN (:...previous)', { previous }).orderBy('u.createdAt', 'ASC').addOrderBy('u.userId', 'ASC').getMany();
    const live = earlier.filter((r) => !r.deletedAt);
    if (live.length === 0) return NO_CONTINUITY;
    const holder = await findBySub(tx, sub);
    // a row that holds the subject but may not sign in (suspended on this node, soft-deleted) is a login refusal below, never somewhere to move people into
    if (holder && (holder.deletedAt || holder.userStatus !== 'ACTIVE')) return NO_CONTINUITY;
    let keeper = holder?.userId ?? null;
    let rekeyed = 0; let merged = 0;
    for (const row of live) {
      if (keeper === null) {
        const r = await tx.getRepository(UserEntity).createQueryBuilder().update(UserEntity).set({ identitySub: sub } as never)
          .where('"userId" = :id AND "identitySub" = :old', { id: row.userId, old: row.identitySub }).execute();
        if (r.affected) { keeper = row.userId; rekeyed++; }
        continue;
      }
      await mergeShadowInto(tx, keeper, row.userId);
      retired.push({ userId: row.userId, email: row.email });
      merged++;
    }
    return { rekeyed, merged };
  });
  for (const r of retired) await invalidate(r);
  return result;
}

/** `from` is absorbed into `into`: memberships move (a tenant `into` already belongs to keeps its own), then `from` is retired. Inside the caller's transaction. */
async function mergeShadowInto(tx: EntityManager, into: string, from: string): Promise<void> {
  await tx.query(
    `UPDATE tenant_members SET "userId" = $1 WHERE "userId" = $2 AND NOT EXISTS (SELECT 1 FROM tenant_members x WHERE x."tenantId" = tenant_members."tenantId" AND x."userId" = $1)`, [into, from]);
  await tx.query('DELETE FROM tenant_members WHERE "userId" = $1', [from]);
  // `password` becomes '!': the table refuses a row with neither a password nor a subject (`ck_users_credential_or_identity`), and '!' is no bcrypt hash, so it
  // matches nothing; the row is soft-deleted and DELETED anyway, a reference to its id resolves and nothing can sign in as it
  await tx.query(`UPDATE users SET "identitySub" = NULL, "password" = '!', "email" = $2, "emailReleased" = false, "emailVerifiedAt" = NULL, "userStatus" = 'DELETED', "deletedAt" = now() WHERE "userId" = $1`, [from, retiredShadowEmail(from)]);
}

export async function upsertShadowUser(input: ShadowUpsertInput, ds?: DataSource): Promise<ShadowUpsertResult> {
  if (!isIdentitySub(input.sub)) return { ok: false, code: 'BAD_SUBJECT' };
  const m = (ds ?? (await getDataSource())).manager;
  const sub = input.sub;

  // The people of a workspace that moved here are re-keyed before anything else: after it the row of `sub` is the one holding their memberships.
  const continuity = await carryOver(m, sub, cleanPreviousSubs(sub, input.previousSubs));

  const existing = await findBySub(m, sub);
  if (existing) {
    if (existing.deletedAt || existing.userStatus !== 'ACTIVE') return { ok: false, code: 'SHADOW_INACTIVE' };
    const want = decideShadowEmail(sub, input, input.tenantAllowsRelease, existing);
    if (want.keep || (want.email === existing.email && want.released === existing.emailReleased)) return finish(m, sub, false, false, null, continuity);
    if (await tryUpdateEmail(m, existing, want.email, want.released)) return finish(m, sub, false, false, existing.email, continuity);
    // The released address belongs to another row: never link. Fall back to the placeholder unless the row already holds a released address.
    if (!existing.emailReleased && existing.email !== shadowPlaceholderEmail(sub)) await tryUpdateEmail(m, existing, shadowPlaceholderEmail(sub), false);
    return finish(m, sub, false, true, existing.email, continuity);
  }

  const want = decideShadowEmail(sub, input, input.tenantAllowsRelease, null);
  let created = await tryInsert(m, sub, want.email, want.released);
  let emailConflict = false;
  let row = await findBySub(m, sub);
  if (!row && want.released) {
    // Nothing holds the subject, so the address was the taken key: another row owns it. The shadow is created with the placeholder instead.
    emailConflict = true;
    created = await tryInsert(m, sub, shadowPlaceholderEmail(sub), false);
    row = await findBySub(m, sub);
  }
  if (!row) throw new Error('user.shadow: could not create the shadow user');
  if (!created && (row.deletedAt || row.userStatus !== 'ACTIVE')) return { ok: false, code: 'SHADOW_INACTIVE' };
  return finish(m, sub, created, emailConflict, null, continuity);
}

/**
 * The shadow row of a pairwise subject, whatever its status (a back-channel logout of the hub must reach a suspended or soft-deleted shadow's
 * sessions too), or null. Read only; never creates a row.
 */
export async function findShadowUserIdBySub(sub: string, ds?: DataSource): Promise<string | null> {
  if (!isIdentitySub(sub)) return null;
  const row = await findBySub((ds ?? (await getDataSource())).manager, sub);
  return row?.userId ?? null;
}

/**
 * The pairwise subject of a user, or null for a local account (FID-09: the node names the person by it when it tells the hub a membership ended).
 * Read only.
 */
export async function findIdentitySubByUserId(userId: string, ds?: DataSource): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
  const row = await (ds ?? (await getDataSource())).manager.getRepository(UserEntity).findOne({ select: { userId: true, identitySub: true }, where: { userId } });
  return row?.identitySub && isIdentitySub(row.identitySub) ? row.identitySub : null;
}

const UserShadowService = { upsertShadowUser, findShadowUserIdBySub, findIdentitySubByUserId };
export default UserShadowService;
