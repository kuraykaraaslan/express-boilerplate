import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { EntityManager } from 'typeorm';
import type { BundleMember } from '@kuraykaraaslan-labs/db/server/db.tenant-bundle.members';
import { MemberRefused } from '@kuraykaraaslan-labs/db/server/db.tenant-bundle.members';
import { invalidate } from './user.helpers';
import { isIdentitySub, retiredShadowEmail, shadowPlaceholderEmail } from './user.shadow.rules';

/**
 * The people of a migrated tenant on its target node (decision F32, docs/phases/02-fleet/05 section 6.4 "Users"). The bundle carries, for every user that holds
 * a membership of the tenant, the part of the user the target needs (`BundleMember`: no credential, no role, no profile); this is the target's side. `plan`
 * decides, `write` inserts inside the import transaction, `refusal` judges a batch without writing (the inspection that runs before the import).
 *
 *  - The user id is kept: ids are preserved across a migration, so the memberships that came with the tenant stay true. A row that already exists with that id is
 *    left as it is (the tenant is coming home to a node that still has its people, or a retry): never overwritten.
 *  - A SHADOW (a subject): inserted with the subject as it came (the one the source node's hub link issued). It is not this node's subject, so the person's
 *    first login here carries it as a previous subject and the row is re-keyed (`upsertShadowUser`, `fid_prev_subs`). The address is kept when it is a real one
 *    nobody here holds; when another account holds it the shadow gets its placeholder instead (the person is never linked by address, F10). A subject another row
 *    already holds is `SUB_TAKEN` (it cannot happen between two nodes; it would mean a forged bundle).
 *  - A LOCAL ACCOUNT (no subject): inserted with a password nobody knows (a bcrypt hash of a random secret that is thrown away, the way a social sign-in
 *    account is created; the table refuses a row with neither a password nor a subject), role USER. Its address is its login: when another account here
 *    holds it, the bundle is refused (`EMAIL_TAKEN`) instead of guessing whether the two are one person; the operator resolves that before the move. The
 *    person sets a password through the ordinary reset, because a credential does not cross a region.
 *  - Every inserted row is role USER (the source's role is not a fact about this node), with no consent record and no profile.
 */
export interface MemberLookup {
  /** user ids that exist here, and the address and subject holders among the batch's values. */
  byId: Map<string, { identitySub: string | null }>;
  byEmail: Map<string, string>;
  bySub: Map<string, string>;
}

export type MemberAction = { action: 'EXISTS' } | { action: 'INSERT'; email: string; released: boolean; verified: string | null };

/**
 * The schema-qualified tables of the manager's data source. A node's data source may live in a schema of its own (a migration port, a test harness); an
 * unqualified `users` would resolve through the search path to another schema's table instead of failing.
 */
function tablesOf(m: EntityManager): { users: string; members: string } {
  const schema = (m.connection?.options as { schema?: string } | undefined)?.schema;
  const q = (t: string) => (schema ? `"${schema.replace(/"/g, '""')}"."${t}"` : `"${t}"`);
  return { users: q('users'), members: q('tenant_members') };
}

/** Looks the batch up in three queries. Soft-deleted rows count: a deleted row still holds its address and subject. */
export async function lookupMembers(m: EntityManager, members: readonly BundleMember[]): Promise<MemberLookup> {
  const lookup0: MemberLookup = { byId: new Map(), byEmail: new Map(), bySub: new Map() };
  // nothing to look up (a bundle with no people, or an empty batch): no query, and nothing is asked of a schema that may not hold the user tables
  if (members.length === 0) return lookup0;
  const { users } = tablesOf(m);
  const ids = members.map((x) => x.userId);
  const emails = members.map((x) => x.email.toLowerCase());
  const subs = members.flatMap((x) => (x.identitySub ? [x.identitySub] : []));
  const rows = (await m.query(
    `SELECT "userId", lower("email") AS "email", "identitySub" FROM ${users} WHERE "userId" = ANY($1::uuid[]) OR lower("email") = ANY($2::text[]) OR ("identitySub" IS NOT NULL AND "identitySub" = ANY($3::text[]))`,
    [ids, emails, subs],
  )) as { userId: string; email: string; identitySub: string | null }[];
  const lookup = lookup0;
  for (const r of rows) {
    lookup.byId.set(r.userId, { identitySub: r.identitySub });
    lookup.byEmail.set(r.email, r.userId);
    if (r.identitySub) lookup.bySub.set(r.identitySub, r.userId);
  }
  return lookup;
}

/** What to do with one member given what the node already holds, or the reason the bundle is refused. */
export function planMember(member: BundleMember, lookup: MemberLookup): MemberAction | { refusal: string } {
  if (lookup.byId.has(member.userId)) return { action: 'EXISTS' };
  const email = member.email.toLowerCase();
  if (member.identitySub) {
    if (!isIdentitySub(member.identitySub)) return { refusal: 'BAD_SUBJECT' };
    if (lookup.bySub.has(member.identitySub)) return { refusal: 'SUB_TAKEN' };
    // a real address nobody here holds is kept as it came; anything else is the placeholder, and the row says nothing was released
    if (member.emailReleased && !lookup.byEmail.has(email)) return { action: 'INSERT', email, released: true, verified: member.emailVerifiedAt };
    return { action: 'INSERT', email: shadowPlaceholderEmail(member.identitySub), released: false, verified: null };
  }
  if (lookup.byEmail.has(email)) return { refusal: 'EMAIL_TAKEN' };
  return { action: 'INSERT', email, released: false, verified: member.emailVerifiedAt };
}

/** The first reason a batch is refused, or null: what the inspection that precedes the import asks, without writing a row. Members of one batch also meet each other. */
export async function memberBatchRefusal(m: EntityManager, members: readonly BundleMember[]): Promise<string | null> {
  const lookup = await lookupMembers(m, members);
  const seenEmails = new Set<string>(); const seenSubs = new Set<string>();
  for (const member of members) {
    const p = planMember(member, lookup);
    if ('refusal' in p) return p.refusal;
    if (p.action === 'INSERT') {
      if (seenEmails.has(p.email) || (member.identitySub && seenSubs.has(member.identitySub))) return member.identitySub ? 'SUB_TAKEN' : 'EMAIL_TAKEN';
      seenEmails.add(p.email); if (member.identitySub) seenSubs.add(member.identitySub);
    }
  }
  return null;
}

/** Writes a batch inside the import transaction: the rows `planMember` decided to insert; a refusal (or a row a racing writer took meanwhile) throws `MemberRefused`. */
export async function importMemberUsers(m: EntityManager, members: readonly BundleMember[]): Promise<{ inserted: number; existing: number; insertedIds: string[] }> {
  const lookup = await lookupMembers(m, members);
  let inserted = 0; let existing = 0;
  const insertedIds: string[] = [];
  let unusable: string | null = null;   // one hash per call, made only when a local account is in the batch
  const { users } = tablesOf(m);
  for (const member of members) {
    const p = planMember(member, lookup);
    if ('refusal' in p) throw new MemberRefused(p.refusal);
    if (p.action === 'EXISTS') { existing++; continue; }
    if (!member.identitySub && unusable === null) unusable = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const r = (await m.query(
      `INSERT INTO ${users} ("userId", "email", "password", "identitySub", "emailReleased", "emailVerifiedAt", "userStatus", "userRole", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'USER', $8, now()) ON CONFLICT DO NOTHING RETURNING "userId"`,
      [member.userId, p.email, member.identitySub ? null : unusable, member.identitySub, p.released, p.verified, member.userStatus, member.createdAt],
    )) as unknown[];
    // a unique key taken between the lookup and the insert (another writer on this node): the import fails whole rather than drop a person
    if ((Array.isArray(r[0]) ? (r[0] as unknown[]) : r).length !== 1) throw new MemberRefused(member.identitySub ? 'SUB_TAKEN' : 'EMAIL_TAKEN');
    lookup.byId.set(member.userId, { identitySub: member.identitySub });
    lookup.byEmail.set(p.email, member.userId);
    if (member.identitySub) lookup.bySub.set(member.identitySub, member.userId);
    inserted++; insertedIds.push(member.userId);
  }
  return { inserted, existing, insertedIds };
}

const FK_VIOLATION = '23503';

/**
 * An aborted or failed import on the target: the users THIS import inserted (the caller recorded their ids) and that hold no membership any more go again.
 * A user that acquired one is never touched; one that another module's rows now reference (a foreign key) is retired instead of deleted, so a person's data
 * is never left half-attached. Returns how many rows went or were retired.
 */
export async function discardImportedMembers(m: EntityManager, userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  try {
    const r = (await m.query(
      `DELETE FROM ${tablesOf(m).users} u WHERE u."userId" = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM ${tablesOf(m).members} x WHERE x."userId" = u."userId") RETURNING u."userId", u."email"`, [userIds])) as unknown[];
    const rows = (Array.isArray(r[0]) ? (r[0] as { userId: string; email: string }[]) : (r as { userId: string; email: string }[]));
    for (const x of rows) await invalidate({ userId: x.userId, email: x.email });
    return rows.length;
  } catch (e) {
    if ((e as { driverError?: { code?: string }; code?: string }).driverError?.code !== FK_VIOLATION && (e as { code?: string }).code !== FK_VIOLATION) throw e;
    return retireOrphanUsers(m, userIds, false);
  }
}

/**
 * The source of a purged tenant keeps no shadow of a person who has no workspace on this node any more (decision F32, data minimisation): a SHADOW among the
 * given users (a subject, never a local account, which is the person's own login here) that holds no membership is retired: no subject, an undeliverable
 * address, no released address, soft-deleted, its id still resolvable for the records that name it. Returns how many were retired.
 */
export async function retireOrphanShadows(m: EntityManager, userIds: readonly string[]): Promise<number> {
  return retireOrphanUsers(m, userIds, true);
}

async function retireOrphanUsers(m: EntityManager, userIds: readonly string[], shadowsOnly: boolean): Promise<number> {
  if (userIds.length === 0) return 0;
  const { users, members } = tablesOf(m);
  const rows = (await m.query(
    `SELECT u."userId", u."email" FROM ${users} u WHERE u."userId" = ANY($1::uuid[]) AND u."deletedAt" IS NULL ${shadowsOnly ? 'AND u."identitySub" IS NOT NULL' : ''}
       AND NOT EXISTS (SELECT 1 FROM ${members} x WHERE x."userId" = u."userId")`, [userIds])) as { userId: string; email: string }[];
  for (const r of rows) {
    await m.query(
      `UPDATE ${users} SET "identitySub" = NULL, "password" = '!', "email" = $2, "emailReleased" = false, "emailVerifiedAt" = NULL, "userStatus" = 'DELETED', "deletedAt" = now() WHERE "userId" = $1`,
      [r.userId, retiredShadowEmail(r.userId)]);
    await invalidate({ userId: r.userId, email: r.email });
  }
  return rows.length;
}
