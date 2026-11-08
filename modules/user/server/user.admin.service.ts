import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from './entities/user.entity';
import { SafeUser } from './user.types';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { invalidate, emitAuditLog } from './user.helpers';
import { getById } from './user.read.service';

// MS-24 (2026-10-27): `enforcePasswordPolicy` and `deactivateInactiveUsers` were removed. Neither had a caller, and
// both duplicated a policy auth owns and enforces: the password rules are auth's (`AuthPolicyLoaderService.getPasswordPolicy`,
// `passwordMinLength` / `passwordRequireUppercase` / `passwordRequireDigit` / `passwordRequireSpecial`, applied by every
// password path), and dormant accounts are auth's daily job (`auth.dormant.job.ts`, `dormantAccountDays` /
// `dormantAccountAutoDisable`). The removed policy read `passwordRequireSpecialChar`, a key nothing writes, so wiring it
// would have added a second, weaker password rule beside auth's.

/**
 * Merge two user accounts — `sourceUserId` is absorbed into `targetUserId`.
 * Transfers tenant memberships and soft-deletes the source.
 * Only safe to call after verifying both accounts belong to the same person.
 */
export async function merge(targetUserId: string, sourceUserId: string, actorId?: string): Promise<SafeUser> {
  if (targetUserId === sourceUserId) {
    throw new AppError('Cannot merge a user with itself', 400, ErrorCode.VALIDATION_ERROR);
  }
  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);
  const [target, source] = await Promise.all([
    repo.findOne({ where: { userId: targetUserId } }),
    repo.findOne({ where: { userId: sourceUserId } }),
  ]);
  if (!target) throw new AppError('Target user not found', 404, ErrorCode.NOT_FOUND);
  if (!source) throw new AppError('Source user not found', 404, ErrorCode.NOT_FOUND);

  // Re-assign tenant memberships from source to target (skip conflicts)
  await ds.query(`
    UPDATE tenant_members SET "userId" = $1
    WHERE "userId" = $2
      AND "tenantId" NOT IN (
        SELECT "tenantId" FROM tenant_members WHERE "userId" = $1
      )
  `, [targetUserId, sourceUserId]);

  // Soft-delete source
  await repo.update({ userId: sourceUserId }, { userStatus: 'DELETED', deletedAt: new Date() } as any);
  await invalidate({ userId: sourceUserId, email: source.email });

  await emitAuditLog(null, 'user.merged', targetUserId, actorId);
  return getById(targetUserId);
}
