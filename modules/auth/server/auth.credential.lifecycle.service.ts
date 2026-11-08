import 'reflect-metadata';
import crypto from 'crypto';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import bcrypt from 'bcrypt';
import Logger from '@kuraykaraaslan-labs/logger';
import UserService from '@kuraykaraaslan-labs/user/server/user.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import AuthMessages from './auth.messages';
import AuthPolicyService from './auth.policy.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * GDPR Art. 17 / CCPA / KVKK right-to-erasure.
 * Anonymises all PII fields while preserving the row for FK integrity.
 * Clears all active sessions and security data after anonymisation.
 */
export async function eraseUserData(userId: string): Promise<void> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);
  const user = await repo.findOne({ where: { userId } });
  if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  const anonymisedEmail = `erased-${userId}@erased.invalid`;
  await ds.transaction(async (manager) => {
    await manager.getRepository(UserEntity).update({ userId }, {
      email: anonymisedEmail,
      phone: undefined,
      password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
      userStatus: 'INACTIVE',
      emailVerifiedAt: undefined,
      consentVersion: undefined,
      consentAcceptedAt: undefined,
    });
  });

  // GDPR: revoke all sessions so the erased account cannot stay logged in, through the one revocation path (D249, Redis-outage audit
  // §3.2): the delete, the session-ending orders that drop the account's open sockets, the session cache and the revocation hooks.
  // Loaded at call time like auth.second-factor-guard does: a static import would close the auth -> user_session -> auth cycle. The
  // account is INACTIVE with a random password by now, so no new session can appear between the two transactions.
  const { revokeSessions } = await import('@kuraykaraaslan-labs/user_session/server/user_session.revocation-tx');
  await revokeSessions(async (qr) => {
    const found = await qr.query(
      'SELECT "userSessionId", "userId", "tenantId", "accessToken" FROM user_sessions WHERE "userId" = $1 FOR UPDATE', [userId],
    ) as Array<{ userSessionId: string; userId: string; tenantId: string; accessToken: string | null }>;
    if (found.length) await qr.query('DELETE FROM user_sessions WHERE "userId" = $1', [userId]);
    return found;
  });

  await UserService.invalidate({ userId, email: user.email });

  AuditLogService.log({
    tenantId: null, actorId: userId, actorType: 'USER',
    action: AuditActions.AUTH_DORMANT_DISABLED,
    metadata: { reason: 'GDPR_ERASURE', userId },
  }).catch(() => {});

  Logger.info(`AuthCredentialService.eraseUserData: PII erased for user ${userId}`);
}

export async function disableDormantAccounts(tenantId?: string): Promise<{ scanned: number; disabled: number; erased: number }> {
  const policy = await AuthPolicyService.getDormantPolicy(tenantId);
  if (policy.days <= 0) return { scanned: 0, disabled: 0, erased: 0 };

  const cutoff = new Date(Date.now() - policy.days * 24 * 60 * 60 * 1000);
  const ds = await getDataSource();
  const dormantRows: { userId: string }[] = await ds.query(
    `SELECT u."userId" FROM users u
     LEFT JOIN user_securities s ON s."userId" = u."userId"
     WHERE u."userStatus" = 'ACTIVE'
       AND COALESCE(s."lastLoginAt", u."createdAt") < $1`,
    [cutoff],
  );

  if (!policy.autoDisable || dormantRows.length === 0) {
    return { scanned: dormantRows.length, disabled: 0, erased: 0 };
  }

  const ids = dormantRows.map((r) => r.userId);
  const repo = ds.getRepository(UserEntity);
  await repo.createQueryBuilder().update(UserEntity).set({ userStatus: 'INACTIVE' }).whereInIds(ids).execute();
  for (const id of ids) await UserService.invalidate({ userId: id }).catch(() => {});

  AuditLogService.log({
    tenantId: tenantId ?? null, actorType: 'SYSTEM', action: AuditActions.AUTH_DORMANT_DISABLED,
    metadata: { disabled: ids.length, scanned: dormantRows.length, thresholdDays: policy.days },
  }).catch(() => {});

  // GTH-8: right-to-erasure window. Accounts that have been dormant for longer
  // than `dormantDeleteAfterDays` (and >= the disable threshold) get their PII
  // anonymised rather than merely disabled. 0 = never erase (disable-only).
  let erased = 0;
  if (policy.deleteAfterDays > 0) {
    const eraseCutoff = new Date(Date.now() - policy.deleteAfterDays * 24 * 60 * 60 * 1000);
    const eraseRows: { userId: string }[] = await ds.query(
      `SELECT u."userId" FROM users u
       LEFT JOIN user_securities s ON s."userId" = u."userId"
       WHERE u."email" NOT LIKE 'erased-%@erased.invalid'
         AND COALESCE(s."lastLoginAt", u."createdAt") < $1`,
      [eraseCutoff],
    );
    for (const row of eraseRows) {
      await eraseUserData(row.userId).then(() => { erased += 1; }).catch((err: unknown) => {
        Logger.warn(`AuthCredentialService.disableDormantAccounts: erase failed for ${row.userId}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  Logger.info(`AuthCredentialService.disableDormantAccounts: disabled ${ids.length} dormant accounts (>${policy.days}d), erased ${erased} (>${policy.deleteAfterDays}d)`);
  return { scanned: dormantRows.length, disabled: ids.length, erased };
}
