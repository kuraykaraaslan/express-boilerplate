import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { UserRole, UserStatus } from './user.enums';

/**
 * Who may do what to a platform account (06-user 2.1 / 2.2), shared by POST /users, PUT and DELETE /users/{id}.
 *
 * `user.users.*` has an ADMIN floor, so a root-tenant ADMIN passes the permission check. These rules are the ranks on top of it:
 *  - S9: the platform role (`userRole: 'ADMIN'`, a virtual OWNER of every tenant) is granted or removed only by an ACTIVE OWNER of the
 *    root tenant, never by the account itself;
 *  - an account that outranks a root ADMIN (a root OWNER, or a platform admin) keeps its email, phone and status, and is not deleted,
 *    unless an ACTIVE root OWNER asks. The phone is a login identifier (SMS OTP, the mobile-signature login fallback), so re-pointing or
 *    clearing it is as much a takeover or lock-out as an email change;
 *  - nobody deletes, suspends or deactivates their own account here.
 */

/** Stable refusal codes (06-user 2.3): the UI translates these, never the English message. */
export const UserRefusalCode = {
  PLATFORM_ROLE_OWNER_ONLY: 'PLATFORM_ROLE_OWNER_ONLY',
  TARGET_OUTRANKS_ACTOR: 'TARGET_OUTRANKS_ACTOR',
  SELF_ACTION_REFUSED: 'SELF_ACTION_REFUSED',
  USER_ERASED: 'USER_ERASED',
  EMAIL_REQUIRED: 'EMAIL_REQUIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // Phase 55 00.6: the account has no local password to change (a shadow user of a Fleet ID node).
  NO_LOCAL_PASSWORD: 'NO_LOCAL_PASSWORD',
  // Phase 55 00.6: the person has no factor that can confirm a step-up: the session would only be signed out.
  STEP_UP_UNAVAILABLE_FOR_USER: 'STEP_UP_UNAVAILABLE_FOR_USER',
} as const;
export type UserRefusalCode = typeof UserRefusalCode[keyof typeof UserRefusalCode];

/**
 * An AppError whose `code` is one of the user module's own codes: `normalizeError` answers `{ message, code }` with it. `ErrorCode` is
 * common's closed set; these codes are a module-level superset of it, hence the one cast.
 */
export class UserRefusalError extends AppError {
  constructor(code: UserRefusalCode, message: string, statusCode: number) {
    super(message, statusCode, code as unknown as ErrorCode);
    this.name = 'UserRefusalError';
  }
}

type RootMembership = { memberRole?: string | null; memberStatus?: string | null } | null;

/** The account's membership of the root tenant, any status; `undefined` when it could not be read. GET /users/{id} reads it too. */
export async function rootMembership(userId: string): Promise<RootMembership | undefined> {
  try {
    // Dynamic: tenant_member requires user, so a static import here would be a cycle.
    const { default: TenantMemberService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.service');
    const { ROOT_TENANT_ID } = await import('@kuraykaraaslan-labs/common/server/tenant-constants');
    return await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId: ROOT_TENANT_ID, userId });
  } catch {
    return undefined;
  }
}

/** An ACTIVE OWNER of the root tenant. A lookup that fails is "no" (fail closed). */
export async function isActiveRootOwner(actorId: string | null | undefined): Promise<boolean> {
  if (!actorId) return false;
  const m = await rootMembership(actorId);
  return m?.memberRole === 'OWNER' && m?.memberStatus === 'ACTIVE';
}

/** A root OWNER or a platform admin. A membership lookup that fails counts as privileged (fail closed). */
async function isPrivilegedTarget(target: { userId: string; userRole?: UserRole | string | null }): Promise<boolean> {
  if (target.userRole === 'ADMIN') return true;
  // undefined = the lookup failed; null = no root membership.
  const m = await rootMembership(target.userId);
  return m === undefined || m?.memberRole === 'OWNER';
}

const ownerOnly = () => new UserRefusalError(
  UserRefusalCode.PLATFORM_ROLE_OWNER_ONLY,
  'Only an owner of the platform tenant may change the platform admin role of another account.',
  403,
);
const outranked = () => new UserRefusalError(
  UserRefusalCode.TARGET_OUTRANKS_ACTOR,
  'Only an owner of the platform tenant may change or delete a platform owner or platform admin.',
  403,
);
const selfRefused = (what: string) => new UserRefusalError(UserRefusalCode.SELF_ACTION_REFUSED, `You cannot ${what} your own account here.`, 403);

/** POST /users: a new platform admin is minted only by an ACTIVE root OWNER (06-user 2.2). */
export async function assertMayCreateUser({ actorId, userRole }: { actorId?: string | null; userRole?: UserRole | null }): Promise<void> {
  if (userRole === 'ADMIN' && !(await isActiveRootOwner(actorId))) throw ownerOnly();
}

/** The account as it is now. `userStatus` / `deletedAt` tell an erased account apart. */
export type GuardTarget = {
  userId: string;
  email?: string | null;
  phone?: string | null;
  userRole?: UserRole | string | null;
  userStatus?: UserStatus | string | null;
  deletedAt?: Date | string | null;
};

/** PUT /users/{id}: the role, email, phone and status rules (06-user 1.7, 2.1, 2.2). `data` is the parsed body (undefined = not sent). */
export async function assertMayUpdateUser({ actorId, target, data }: {
  actorId?: string | null;
  target: GuardTarget;
  data: { email?: string | null; phone?: string | null; userRole?: UserRole | null; userStatus?: UserStatus | string | null };
}): Promise<void> {
  if (target.userStatus === 'DELETED' || target.deletedAt) {
    throw new UserRefusalError(UserRefusalCode.USER_ERASED, 'This account has been erased and cannot be edited.', 409);
  }
  const self = !!actorId && actorId === target.userId;
  const changesRole = data.userRole != null && data.userRole !== (target.userRole ?? 'USER');
  const changesEmail = typeof data.email === 'string' && data.email.toLowerCase() !== (target.email ?? '').toLowerCase();
  // null included: clearing an outranking account's phone is a lock-out (06-user 2.1).
  const changesPhone = data.phone !== undefined && (data.phone ?? null) !== (target.phone ?? null);
  const changesStatus = data.userStatus != null && data.userStatus !== target.userStatus;

  if (changesRole) {
    if (self) throw selfRefused('change the platform role of');
    if (!(await isActiveRootOwner(actorId))) throw ownerOnly();
  }
  if (self && changesStatus && data.userStatus !== 'ACTIVE') throw selfRefused('suspend or deactivate');
  // Self included: a platform admin who is not a root OWNER does not re-point their own email or phone here either.
  if ((changesEmail || changesPhone || changesStatus) && (await isPrivilegedTarget(target)) && !(await isActiveRootOwner(actorId))) {
    throw outranked();
  }
}

/** DELETE /users/{id}: never one's own account, never an outranking one unless an ACTIVE root OWNER asks (06-user 2.1). */
export async function assertMayDeleteUser({ actorId, target }: { actorId?: string | null; target: GuardTarget }): Promise<void> {
  if (actorId && actorId === target.userId) throw selfRefused('delete');
  if ((await isPrivilegedTarget(target)) && !(await isActiveRootOwner(actorId))) throw outranked();
}

/** The body of a 400 for a request that failed its schema: the issues' messages, a code the UI can translate, and the fields. */
export function validationRefusal(issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey>; params?: unknown }>): {
  message: string; code: string; fields: string[];
} {
  const coded = issues.find((i) => typeof (i.params as { code?: unknown } | undefined)?.code === 'string');
  return {
    message: issues.map((i) => i.message).join(', '),
    code: coded ? String((coded.params as { code: string }).code) : UserRefusalCode.VALIDATION_ERROR,
    fields: [...new Set(issues.map((i) => i.path.map(String).join('.')).filter(Boolean))],
  };
}

/**
 * POST / DELETE /users/{id}/security-lock (phase 55 00.1): the security lock is a suspension of every sign-in method, so it follows the
 * suspension rules of PUT: never one's own account (neither set nor lifted), never an erased one, and a root OWNER's or a platform admin's lock is set or lifted
 * only by an ACTIVE root OWNER.
 */
export async function assertMaySecurityLock({ actorId, target, lifting = false }: { actorId?: string | null; target: GuardTarget; lifting?: boolean }): Promise<void> {
  if (target.userStatus === 'DELETED' || target.deletedAt) {
    throw new UserRefusalError(UserRefusalCode.USER_ERASED, 'This account has been erased and cannot be edited.', 409);
  }
  // Lifting one's own lock is refused too (phase 55 00 review): the lock can hold while an old session survives (lockAccount answers
  // 503 when the sessions were not ended), and that session must not undo it. Another operator, or the lock's own end, lifts it.
  if (actorId && actorId === target.userId) throw selfRefused(lifting ? 'unlock' : 'lock');
  if ((await isPrivilegedTarget(target)) && !(await isActiveRootOwner(actorId))) throw outranked();
}

/**
 * Phase 55 00.6: the admin actuators on another person's account (end their sessions, force a step-up on one, revoke their trusted
 * devices, force a password change). The suspension rules again: never one's own account (the account page has its own,
 * self-service actions), never an erased one, and a root OWNER's or a platform admin's only by an ACTIVE root OWNER.
 */
export async function assertMayActOnAccount({ actorId, target, what }: { actorId?: string | null; target: GuardTarget; what: string }): Promise<void> {
  if (target.userStatus === 'DELETED' || target.deletedAt) {
    throw new UserRefusalError(UserRefusalCode.USER_ERASED, 'This account has been erased and cannot be edited.', 409);
  }
  if (actorId && actorId === target.userId) throw selfRefused(what);
  if ((await isPrivilegedTarget(target)) && !(await isActiveRootOwner(actorId))) throw outranked();
}
