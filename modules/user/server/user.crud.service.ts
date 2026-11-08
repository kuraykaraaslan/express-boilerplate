import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import { User as UserEntity } from './entities/user.entity';
import { SafeUser, UpdateUser, SafeUserSchema } from './user.types';
import type { UserRole, UserStatus } from './user.enums';
import bcrypt from 'bcrypt';
import UserMessages from './user.messages';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { requireE164 } from '@kuraykaraaslan-labs/common/server/common.phone';
import { randomUUID } from 'node:crypto';
import { invalidate, isPasswordBreached, emitAuditLog } from './user.helpers';
import Logger from '@kuraykaraaslan-labs/logger';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { UserRefusalCode, UserRefusalError } from './user.admin-guard';

/**
 * No default region, deliberately.
 *
 * `users` is a PLATFORM table — `getDataSource()`, not `tenantDataSourceFor` —
 * so there is no tenant here whose country could disambiguate a bare
 * `0532 123 45 67`. Guessing one would file the same person under a different
 * key depending on which admin happened to create them.
 *
 * Callers that DO have a tenant normalize before they get here:
 * `auth.credential.register.service` resolves the tenant's region so a person
 * signing up can still type their number the way they say it out loud. Everyone
 * else must present international form — which the shared `PhoneInput` always
 * emits, so this only ever bites a hand-rolled API client.
 */
function normalizeUserPhone(phone: string | null | undefined): string | null {
  return requireE164(phone, undefined, 'Phone number');
}

/** The critical audit row for a platform admin minted or granted, then the notice to the other platform admins. */
async function announcePlatformAdmin(user: { userId: string; email: string }, actorId?: string | null): Promise<void> {
  await emitAuditLog(null, AuditActions.USER_ADMIN_GRANTED, user.userId, actorId ?? null, { email: user.email });
  const { notifyPlatformAdminGranted } = await import('./user.admin-notice');
  await notifyPlatformAdminGranted(user, actorId);
}

export async function create({ email, password, phone, userRole, checkBreached = true, actorId }: {
  email: string;
  password: string;
  phone?: string;
  userRole?: UserRole;
  checkBreached?: boolean;
  /** The signed-in operator who asked for it (audit). */
  actorId?: string | null;
}): Promise<SafeUser> {
  if (!email) throw new AppError(UserMessages.INVALID_EMAIL, 400, ErrorCode.VALIDATION_ERROR);

  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);

  const existingUser = await repo.findOne({ where: { email: email.toLowerCase() } });
  if (existingUser) throw new AppError(UserMessages.EMAIL_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
  if (!password) throw new AppError(UserMessages.INVALID_PASSWORD, 400, ErrorCode.VALIDATION_ERROR);

  // Breach detection (HaveIBeenPwned k-anonymity)
  if (checkBreached && await isPasswordBreached(password)) {
    throw new AppError(
      'This password has appeared in a data breach. Please choose a different password.',
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = repo.create({
    email: email.toLowerCase(),
    password: hashedPassword,
    phone: normalizeUserPhone(phone) ?? undefined,
    userRole: userRole ?? 'USER',
    userStatus: 'ACTIVE',
  });
  const saved = await repo.save(user);
  await redis.del(`user:email:${saved.email.toLowerCase()}`).catch(() => {});

  // Audit trail
  await emitAuditLog(null, 'user.created', saved.userId, actorId ?? null, { userRole: saved.userRole });
  // 38-security 5.8: minting a platform admin is a critical audit row and a notice to every other platform admin.
  if (saved.userRole === 'ADMIN') await announcePlatformAdmin(saved, actorId);

  await WebhookService.dispatchPlatformEvent('user.created', {
    userId: saved.userId,
    email: saved.email,
    userRole: saved.userRole,
  });
  return SafeUserSchema.parse(saved);
}

export async function update({ userId, data, actorId }: { userId: string; data: UpdateUser; actorId?: string | null }): Promise<SafeUser> {
  if (!userId) throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);
  const user = await repo.findOne({ where: { userId } });
  if (!user) throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  // 06-user 1.7: an erased account stays erased; nothing edits it back to life.
  if (user.userStatus === 'DELETED' || user.deletedAt) {
    throw new UserRefusalError(UserRefusalCode.USER_ERASED, 'This account has been erased and cannot be edited.', 409);
  }

  // 06-user 1.4: undefined = not sent (kept); `phone: null` clears the phone; an email is never cleared; a null role or status is
  // "no change" (writing it would hit a NOT NULL column).
  if (data.email === null) {
    throw new UserRefusalError(UserRefusalCode.EMAIL_REQUIRED, 'An account must keep an email address.', 400);
  }
  const patch: Record<string, unknown> = {};
  if (data.email !== undefined) {
    const email = data.email.toLowerCase();
    if (email !== user.email.toLowerCase()) {
      patch.email = email;
      // 06-user 2.1: a new address has not been verified; the old verification does not carry over.
      patch.emailVerifiedAt = null;
    }
  }
  if (data.phone !== undefined) patch.phone = normalizeUserPhone(data.phone);
  if (data.userRole != null) patch.userRole = data.userRole as UserRole;
  if (data.userStatus != null) patch.userStatus = data.userStatus as UserStatus;

  if (Object.keys(patch).length > 0) await repo.update({ userId }, patch);
  const updated = await repo.findOne({ where: { userId } });

  // 38-security 1.5: a user who leaves ACTIVE, or whose platform role changes, loses every live session now. Access is also
  // re-checked per request (the row is read fresh), but a refresh token must not outlive the decision either.
  if (updated && ((user.userStatus === 'ACTIVE' && updated.userStatus !== 'ACTIVE') || updated.userRole !== user.userRole)) {
    // Dynamic: user_session requires user, so a static import here would be a cycle.
    const { default: UserSessionService } = await import('@kuraykaraaslan-labs/user_session/server/user_session.service');
    await UserSessionService.deleteAllSessions(userId);
  }

  // 38-security 5.8: a platform role change is always audited (high); becoming a platform admin is critical and tells the other admins.
  if (updated && updated.userRole !== user.userRole) {
    await emitAuditLog(null, AuditActions.USER_ROLE_CHANGED, userId, actorId ?? null, { from: user.userRole, to: updated.userRole });
    if (updated.userRole === 'ADMIN') await announcePlatformAdmin(updated, actorId);
  }

  // Phase 55 00.4: the account's e-mail address (where every reset goes: high) or phone number (medium) changed. One row each, written
  // only when the value really changed. The addresses themselves stay out of the append-only trail: the row says that, when and by whom.
  if (updated && updated.email !== user.email) {
    await emitAuditLog(null, AuditActions.USER_EMAIL_CHANGED, userId, actorId ?? null, {
      by: actorId && actorId !== userId ? 'admin' : actorId === userId ? 'self' : 'system', verificationReset: true,
    });
  }
  if (updated && (updated.phone ?? null) !== (user.phone ?? null)) {
    await emitAuditLog(null, AuditActions.USER_PHONE_CHANGED, userId, actorId ?? null, {
      by: actorId && actorId !== userId ? 'admin' : actorId === userId ? 'self' : 'system', cleared: !updated.phone, added: !user.phone,
    });
  }

  await invalidate({ userId, email: user.email });
  if (updated && updated.email !== user.email) {
    await invalidate({ userId, email: updated.email });
  }

  await WebhookService.dispatchPlatformEvent('user.updated', {
    userId,
    email: updated!.email,
    userRole: updated!.userRole,
    userStatus: updated!.userStatus,
  });
  if (updated!.userStatus === 'SUSPENDED' && user.userStatus !== 'SUSPENDED') {
    await WebhookService.dispatchPlatformEvent('user.suspended', {
      userId,
      email: updated!.email,
    });
  }

  return SafeUserSchema.parse(updated!);
}

/** Hard delete — used for non-GDPR scenarios. For GDPR use `erase()`. */
export async function remove(userId: string): Promise<void> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);
  const user = await repo.findOne({ where: { userId } });
  if (!user) throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  const { userKeys } = await import('@kuraykaraaslan-labs/db/server/db.user-keys.service');
  const legacyValues = await resealUserSecrets(userId);
  // The durable, final record that this person's keys must go, written BEFORE the row: should the destroy below fail, the user-key retry
  // (db-tenant-key-backfill worker) finishes it from this record, and no key is ever created for the id again. A failure here refuses the delete.
  await userKeys.recordErasure(userId, 'USER_ERASURE');
  await repo.delete({ userId });
  await invalidate({ userId, email: user.email });
  await destroyUserKeys(userId, legacyValues);
  await WebhookService.dispatchPlatformEvent('user.deleted', { userId, email: user.email });
}

/**
 * F27: seals the person's secrets that are still in a legacy shape under their user key before the delete (so the destroy shreds them too), and
 * returns how many there were: a backup taken before holds those in the old shape, so the destroy is then never reported as reaching backups.
 * Null when it could not run (likewise never reported as reaching backups).
 */
async function resealUserSecrets(userId: string): Promise<number | null> {
  try {
    const { resealUserKeyColumns } = await import('@kuraykaraaslan-labs/db/server/db.tenant-key-backfill.job');
    return (await resealUserKeyColumns(userId)).sealed;
  } catch (err) {
    Logger.warn(`[user.remove][user:${userId}] legacy secrets not resealed before the delete: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Crypto-shredding of a deleted person's per-user data keys (decision F27): their user-level secrets (social-login tokens, the TOTP secret) left in
 * a replica, or in a backup when the node's provider keeps its slots outside the database, are unreadable for good. Run after the row is gone (a
 * destroyed key is final, so a delete that failed must not have taken the key with it); a failure is logged and audited, never undoes the delete,
 * and stays owed on the final erasure record (`user_key_erasures.keysDestroyedAt` null), which the user-key retry reruns. `user.keys_destroyed`
 * only when the destruction reaches backups (the provider's slots, every one gone, and no legacy value a backup holds in its old shape).
 * Counts only: never a key.
 */
async function destroyUserKeys(userId: string, legacyValues: number | null): Promise<void> {
  try {
    const { userKeys } = await import('@kuraykaraaslan-labs/db/server/db.user-keys.service');
    const report = await userKeys.destroy(userId, 'USER_ERASURE');
    await emitAuditLog(null, report.shredsBackups && legacyValues === 0 ? 'user.keys_destroyed' : 'user.keys_destroyed_live_only', userId);
  } catch (err) {
    Logger.error(`[user.remove][user:${userId}] data keys NOT destroyed (the user-key retry finishes it): ${err instanceof Error ? err.message : String(err)}`);
    await emitAuditLog(null, 'user.keys_destroy_failed', userId);
  }
}

/**
 * GDPR Art. 17 Right-to-Erasure: anonymize personal data instead of hard-deleting.
 * Replaces email, phone with an irreversible placeholder; password is zeroed.
 * The user row is kept (soft-delete) for referential integrity in audit logs and invoices.
 */
export async function erase(userId: string, requestedByUserId?: string): Promise<void> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);
  const user = await repo.findOne({ where: { userId } });
  if (!user) throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  const anon = `erased-${randomUUID()}@deleted.invalid`;
  await repo.update({ userId }, {
    email: anon,
    phone: null,
    password: 'ERASED',
    // A Fleet ID shadow (FID-07) loses its pairwise subject too: the next login with it starts a new, empty shadow.
    identitySub: null,
    emailReleased: false,
    userStatus: 'DELETED',
    emailVerifiedAt: null,
    consentVersion: null,
    consentAcceptedAt: null,
    deletedAt: new Date(),
  } as never);

  await invalidate({ userId, email: user.email });
  await emitAuditLog(null, 'user.erased', userId, requestedByUserId);
  await WebhookService.dispatchPlatformEvent('user.erased', { userId });
}
