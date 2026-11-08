import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { ident } from './db.tenant-bundle';

/**
 * The MEMBERS section of a streamed tenant bundle (docs/phases/02-fleet/05 section 6.4 "Users", decision F32). A tenant's `tenant_members` rows travel with
 * it, but they only name `userId`s, and a user is not a tenant row (the `users` table is node-wide): without the people the memberships point at nothing, and
 * nobody can sign in to the tenant on the target. The section carries, for every user that holds a membership of the tenant, the part of the user the
 * target needs to recognise the person and nothing else:
 *
 *  - `userId`, kept (ids are preserved across a migration, so every reference to a user stays true);
 *  - `email` and `emailVerifiedAt`, `emailReleased` (a shadow's address is a placeholder unless the person released it, F10), `identitySub` (null for a
 *    local account) and `userStatus`, `createdAt`.
 *
 * NEVER carried: a password hash, a phone number, the role (the target forces USER), consent records, the profile, preferences, sessions, MFA secrets,
 * passkeys, social tokens. A credential does not cross a region, and a profile is what the person keeps on the node they created it on.
 *
 * One control line per member (`["member", {...}]`), strictly ascending by `userId`, after the last table and before the objects; the trailer's `members`
 * is the count and the sha256 over `JSON.stringify(member) + "\n"`. A bundle without the section (every bundle sealed before it) has no `members` in its
 * trailer. The target requires the set of users to equal the set of `userId`s of the bundle's own `tenant_members` rows, so a member cannot be left out
 * and a person who holds no membership cannot be smuggled in (scan guard `MEMBER_REFUSED`).
 */
export const MAX_BUNDLE_MEMBERS = 200_000;
export const MEMBER_KEYS = ['userId', 'email', 'emailVerifiedAt', 'emailReleased', 'identitySub', 'userStatus', 'createdAt'] as const;

export interface BundleMember {
  userId: string;
  email: string;
  emailVerifiedAt: string | null;
  emailReleased: boolean;
  identitySub: string | null;
  userStatus: string;
  createdAt: string;
}
export interface BundleMembersSummary { count: number; sha256: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A pairwise subject: 43 base64url characters (HMAC-SHA256 without padding). */
const SUB = /^[A-Za-z0-9_-]{43}$/;
const STATUS = /^[A-Z_]{1,32}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$/;

export const memberLine = (m: BundleMember): string => JSON.stringify(m);
export const memberHashLine = (m: BundleMember): string => `${memberLine(m)}\n`;
export const emptyMembersSummary = (): { h: ReturnType<typeof createHash>; count: number } => ({ h: createHash('sha256'), count: 0 });

/** Why a payload may not be a member (null when it may): exactly the keys above, every one of the shape the target can write without judging anything else. */
export function memberRefusal(p: unknown): string | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'SHAPE';
  const o = p as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== MEMBER_KEYS.length || !MEMBER_KEYS.every((k) => Object.prototype.hasOwnProperty.call(o, k))) return 'KEYS';
  if (typeof o.userId !== 'string' || !UUID.test(o.userId)) return 'USER_ID';
  if (typeof o.email !== 'string' || o.email.length === 0 || o.email.length > 320 || /[\u0000-\u001f\u007f\s]/.test(o.email) || !o.email.includes('@')) return 'EMAIL';
  if (o.emailVerifiedAt !== null && (typeof o.emailVerifiedAt !== 'string' || !ISO.test(o.emailVerifiedAt))) return 'EMAIL_VERIFIED_AT';
  if (typeof o.emailReleased !== 'boolean') return 'EMAIL_RELEASED';
  if (o.identitySub !== null && (typeof o.identitySub !== 'string' || !SUB.test(o.identitySub))) return 'IDENTITY_SUB';
  if (typeof o.userStatus !== 'string' || !STATUS.test(o.userStatus)) return 'USER_STATUS';
  if (typeof o.createdAt !== 'string' || !ISO.test(o.createdAt)) return 'CREATED_AT';
  return null;
}

/**
 * The query behind the section: the users that hold a membership of the tenant, in `userId` order, one jsonb text per user in the shape above (Postgres
 * renders the timestamps, so nothing passes through a JavaScript date). A soft-deleted user is not carried: the person is gone from this node.
 */
export function membersSql(schema: string): string {
  const u = `${ident(schema)}."users"`; const tm = `${ident(schema)}."tenant_members"`;
  return `SELECT to_jsonb(x)::text AS line FROM (
      SELECT u."userId", u."email", to_char(u."emailVerifiedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "emailVerifiedAt", u."emailReleased", u."identitySub", u."userStatus",
             to_char(u."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt"
        FROM ${u} u WHERE u."deletedAt" IS NULL AND u."userId" IN (SELECT "userId" FROM ${tm} WHERE "tenantId" = $1) ORDER BY u."userId") x`;
}

/**
 * Whether this schema has the two tables the section reads. A real node always does; a schema without them (a test harness, a database that never had the
 * user module) has no people to carry, so the export writes no section instead of failing: the target then sees the legacy shape.
 */
export async function hasMemberTables(m: EntityManager, schema: string): Promise<boolean> {
  const rows = (await m.query('SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AS ok', [`${ident(schema)}."users"`, `${ident(schema)}."tenant_members"`])) as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/** Calls `onMember` with every member of the tenant (one cursor, `batch` rows per FETCH), inside the caller's transaction. */
export async function forEachTenantMember(m: EntityManager, schema: string, tenantId: string, onMember: (member: BundleMember) => void | Promise<void>, batch = 500): Promise<void> {
  await m.query(`DECLARE fleet_bundle_members NO SCROLL CURSOR FOR ${membersSql(schema)}`, [tenantId]);
  try {
    for (;;) {
      const rows = (await m.query(`FETCH ${Math.max(1, Math.floor(batch))} FROM fleet_bundle_members`)) as { line: string }[];
      for (const r of rows) {
        const member = JSON.parse(r.line) as BundleMember;
        // the column order of the line is the order of MEMBER_KEYS, whatever jsonb gave: one canonical text per member
        await onMember(Object.fromEntries(MEMBER_KEYS.map((k) => [k, (member as unknown as Record<string, unknown>)[k]])) as unknown as BundleMember);
      }
      if (rows.length < batch) break;
    }
  } finally {
    await m.query('CLOSE fleet_bundle_members');
  }
}

/** What an importer throws from `onMember` / `writeMembers` to refuse the bundle for a reason of its own (e.g. an address another account holds). */
export class MemberRefused extends Error { constructor(readonly reason: string) { super(`member refused: ${reason}`); } }
