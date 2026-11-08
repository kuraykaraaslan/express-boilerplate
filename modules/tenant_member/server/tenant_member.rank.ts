/**
 * The member-rank rule, in one DB-free place (05-tenant-member 2.1): the server helpers and routes use it, and the UI
 * imports it to offer only what the server accepts. Keep this file free of DB, Next and React imports.
 */
import type { TenantMemberRole } from './tenant_member.enums';

/** Rank of a member role. */
export const ROLE_RANK: Readonly<Record<string, number>> = Object.freeze({ OWNER: 3, ADMIN: 2, USER: 1 });

/** Own keys only: `__proto__` or `constructor` must not read the prototype. */
const lookup = (role: string | null | undefined): number | undefined => {
  const key = String(role ?? '');
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, key) ? ROLE_RANK[key] : undefined;
};

/** Rank of a member role; an unknown role ranks above everything (so it is never assignable or actionable by accident). */
export const rankOf = (role: string | null | undefined): number => lookup(role) ?? Infinity;

/** The caller's own rank; an unknown or missing role ranks 0 (it may act on nothing). */
const callerRankOf = (role: string | null | undefined): number => lookup(role) ?? 0;

/**
 * The roles a caller may give an existing member (PUT /members/[id]): strictly below their own, so never OWNER
 * (ownership moves only through transfer-ownership). Highest first.
 */
export function assignableRoles(callerRole: string | null | undefined): TenantMemberRole[] {
  const own = callerRankOf(callerRole);
  return (['ADMIN', 'USER'] as const).filter((r) => ROLE_RANK[r]! < own);
}

/**
 * Whether a caller of `callerRole` may act on (suspend, deactivate, demote, remove) a member of `targetRole`
 * (tenant_member.03): an OWNER may act on anyone (the last-owner rules live in the service); anyone else only on a member
 * strictly below their own rank. `isSelf`: a member never suspends, demotes or removes their own membership through these
 * actions, whatever their role (ownership is handed over through transfer-ownership instead).
 */
export function mayActOn(callerRole: string | null | undefined, targetRole: string | null | undefined, isSelf = false): boolean {
  if (isSelf) return false;
  if (callerRole === 'OWNER') return true;
  return rankOf(targetRole) < callerRankOf(callerRole);
}
