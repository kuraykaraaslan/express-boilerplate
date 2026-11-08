import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { isPlaceholderEmail } from './user_social_account.placeholder-email';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { UserSocialAccount as UserSocialAccountEntity } from './entities/user_social_account.entity';
import { TenantMember as TenantMemberEntity } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import UserSocialAccountMessages from './user_social_account.messages';
import { openToken, sealToken } from './user_social_account.token-crypto';
import { userKeys } from '@kuraykaraaslan-labs/db/server/db.user-keys.service';

/**
 * Merges a synthetic (placeholder-email) federated account INTO a real target
 * account. Used by the no-email completion flow: a user who just logged in via a
 * provider that returns no email (national identity / e-Devlet, Twitter, WeChat …)
 * chooses "I already have an account" and proves ownership of the target.
 *
 * SECURITY: this is account-takeover sensitive. The CALLER MUST have verified
 * ownership of `targetUserId` (e.g. via AuthCredentialService.login) before
 * calling. As a second guardrail we refuse to merge unless the SOURCE account is
 * a synthetic placeholder — so a real account can never be silently absorbed.
 *
 * Crypto-shredding (decision F27): once the merge has committed, the placeholder's per-user data keys are destroyed for good (`USER_MERGED`, final:
 * the retired placeholder never gets a key again). The moved tokens were re-sealed under the target's key inside the merge, so what is left under
 * the placeholder's keys (the duplicate rows the merge deleted, and every copy in a replica or, with a provider that keeps its slots outside the
 * database, in a backup taken before) no longer opens. A failed destroy never undoes the merge: it is logged and audited, and stays owed on the
 * final erasure record, which the user-key retry (db module) reruns.
 */
export default class SocialIdentityMergeService {
  static async mergeInto(
    targetUserId: string,
    placeholderUserId: string,
    ctx: { tenantId?: string | null; ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<void> {
    if (targetUserId === placeholderUserId) {
      throw new AppError(UserSocialAccountMessages.MERGE_SAME_USER, 400, ErrorCode.VALIDATION_ERROR);
    }

    const ds = await getDataSource();
    const placeholder = await ds.getRepository(UserEntity).findOne({ where: { userId: placeholderUserId } });
    const target = await ds.getRepository(UserEntity).findOne({ where: { userId: targetUserId } });
    if (!placeholder || !target) {
      throw new AppError(UserSocialAccountMessages.MERGE_USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    // Guardrail: only a synthetic placeholder may be the merge SOURCE.
    if (!isPlaceholderEmail(placeholder.email)) {
      throw new AppError(UserSocialAccountMessages.MERGE_SOURCE_NOT_PLACEHOLDER, 400, ErrorCode.VALIDATION_ERROR);
    }

    await ds.transaction(async (mgr) => {
      const socialRepo = mgr.getRepository(UserSocialAccountEntity);
      // Not moved to withTenantRepositoryFor (docs/phases/10-db Faz 3), on purpose: a
      // merge reassigns TenantMember rows across EVERY tenant the placeholder
      // belongs to in one transaction, not one tenant's rows — the chokepoint
      // takes a single tenantId and can't express that. This call stays a
      // permanent, documented exception (same shape as auth's nullable-tenant
      // UserConsent write; see modules/db/scripts/gen-tenant-repository-inventory.mts).
      const memberRepo = mgr.getRepository(TenantMemberEntity);

      // ── Social accounts — move, dropping duplicates the target already has ──
      const [srcAccounts, dstAccounts] = await Promise.all([
        socialRepo.find({ where: { userId: placeholderUserId } }),
        socialRepo.find({ where: { userId: targetUserId } }),
      ]);
      const dstKey = new Set(dstAccounts.map((a) => `${a.provider}:${a.providerId}`));
      for (const acc of srcAccounts) {
        if (dstKey.has(`${acc.provider}:${acc.providerId}`)) {
          await socialRepo.delete({ userSocialAccountId: acc.userSocialAccountId });
        } else {
          // The tokens are sealed under the placeholder's per-user key (F27): opened in its context and sealed again under the target's, or they
          // would never open for their new owner. A token that does not open is dropped (re-authorisation), never carried as an unreadable value.
          const patch: Record<string, string | null> = { userId: targetUserId };
          for (const column of ['accessToken', 'refreshToken'] as const) {
            if (acc[column]) patch[column] = await sealToken(targetUserId, await openToken(placeholderUserId, acc[column]));
          }
          await socialRepo.update({ userSocialAccountId: acc.userSocialAccountId }, patch);
        }
      }

      // ── Tenant memberships — reassign, dropping tenants the target already has ─
      const [srcMembers, dstMembers] = await Promise.all([
        memberRepo.find({ where: { userId: placeholderUserId } }),
        memberRepo.find({ where: { userId: targetUserId } }),
      ]);
      const dstTenants = new Set(dstMembers.map((m) => m.tenantId));
      for (const m of srcMembers) {
        if (dstTenants.has(m.tenantId)) {
          await memberRepo.delete({ tenantMemberId: m.tenantMemberId });
        } else {
          await memberRepo.update({ tenantMemberId: m.tenantMemberId }, { userId: targetUserId });
        }
      }

      // ── Retire the placeholder user ─────────────────────────────────────────
      await mgr.getRepository(UserEntity).softDelete({ userId: placeholderUserId });
    });

    // Invalidate caches touched by the move.
    await Promise.all([
      redis.del(`user:id:${targetUserId}`),
      redis.del(`user:id:${placeholderUserId}`),
      redis.del(`user_social_account:user:${targetUserId}`),
      redis.del(`user_social_account:user:${placeholderUserId}`),
      redis.del(`user:email:${placeholder.email.toLowerCase()}`),
    ].map((p) => p.catch(() => {})));

    await AuditLogService.log({
      tenantId: ctx.tenantId ?? null, actorType: 'USER', actorId: targetUserId,
      action: 'social_identity.merged', resourceType: 'user', resourceId: targetUserId,
      metadata: { mergedFrom: placeholderUserId, mergedFromEmail: placeholder.email },
      ipAddress: ctx.ipAddress ?? undefined, userAgent: ctx.userAgent ?? undefined,
    }).catch((err) => Logger.warn(`social merge audit failed: ${err instanceof Error ? err.message : String(err)}`));

    await SocialIdentityMergeService.shredPlaceholderKeys(placeholderUserId, ctx.tenantId ?? null);
  }

  /** After the merge committed: the final record first (no provider needed), then the destroy. Counts only in the audit, never a key. */
  private static async shredPlaceholderKeys(placeholderUserId: string, tenantId: string | null): Promise<void> {
    const audit = (action: string, metadata: Record<string, unknown>) => AuditLogService.log({
      tenantId, actorType: 'SYSTEM', actorId: null, action, resourceType: 'user', resourceId: placeholderUserId, metadata,
    }).catch(() => { /* an audit outage never undoes a destroyed key */ });
    try {
      await userKeys.recordErasure(placeholderUserId, 'USER_MERGED');
      const report = await userKeys.destroy(placeholderUserId, 'USER_MERGED');
      await audit('user.keys_destroyed', {
        reason: 'USER_MERGED', provider: report.provider, destroyed: report.destroyed.length, pendingSlots: report.pendingSlots.length,
        unshredded: report.unshredded.length,
      });
    } catch (err) {
      Logger.error(`[social_identity.merge][user:${placeholderUserId}] placeholder data keys NOT destroyed (the user-key retry finishes it): ${err instanceof Error ? err.message : String(err)}`);
      await audit('user.keys_destroy_failed', { reason: 'USER_MERGED' });
    }
  }
}
