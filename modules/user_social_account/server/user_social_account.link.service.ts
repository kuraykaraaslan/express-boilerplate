import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { UserSocialAccount as UserSocialAccountEntity } from './entities/user_social_account.entity';
import { SafeUserSocialAccount, SafeUserSocialAccountSchema } from './user_social_account.types';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import UserSocialAccountMessages from './user_social_account.messages';
import type { SocialAccountProvider } from './user_social_account.enums';
import { type SocialLinkContext, clearCache, emitLinkEvent, notifyUser } from './user_social_account.helpers';
import { isProviderAllowed } from './user_social_account.read.service';
import { isPlaceholderEmail } from './user_social_account.placeholder-email';
import { sealToken } from './user_social_account.token-crypto';

export async function link(
  userId: string,
  provider: SocialAccountProvider,
  providerId: string,
  accessToken?: string,
  refreshToken?: string,
  profilePicture?: string,
  ctx?: SocialLinkContext,
): Promise<SafeUserSocialAccount> {
  if (ctx?.tenantId && !(await isProviderAllowed(ctx.tenantId, provider))) {
    throw new AppError(UserSocialAccountMessages.PROVIDER_NOT_ALLOWED, 403, ErrorCode.FORBIDDEN);
  }
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSocialAccountEntity);
  const existing = await repo.findOne({ where: { provider, providerId } });

  if (existing && existing.userId !== userId) {
    throw new AppError(UserSocialAccountMessages.ACCOUNT_ALREADY_LINKED, 409, ErrorCode.CONFLICT);
  }

  if (existing) {
    await repo.update({ userSocialAccountId: existing.userSocialAccountId }, {
      accessToken: await sealToken(userId, accessToken),
      refreshToken: await sealToken(userId, refreshToken),
      accessTokenExpiresAt: ctx?.expiresAt ?? existing.accessTokenExpiresAt,
      scopes: ctx?.scopes ?? existing.scopes,
      profilePicture,
    });
    const updated = await repo.findOne({ where: { userSocialAccountId: existing.userSocialAccountId } });
    await clearCache({ userId, provider, providerId });
    return SafeUserSocialAccountSchema.parse(updated!);
  }

  const account = repo.create({
    userId, provider, providerId, profilePicture,
    accessToken: await sealToken(userId, accessToken),
    refreshToken: await sealToken(userId, refreshToken),
    accessTokenExpiresAt: ctx?.expiresAt ?? null,
    scopes: ctx?.scopes ?? null,
  });
  const saved = await repo.save(account);
  await clearCache({ userId, provider, providerId });

  // First-link side effects: audit, webhook, optional user notification.
  await emitLinkEvent('linked', userId, provider, ctx);
  if (ctx?.notify && ctx.tenantId) await notifyUser(userId, provider, 'linked', ctx.tenantId);
  return SafeUserSocialAccountSchema.parse(saved);
}

export async function unlink(userId: string, provider: SocialAccountProvider, ctx?: SocialLinkContext): Promise<void> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSocialAccountEntity);
  const account = await repo.findOne({ where: { userId, provider } });
  if (!account) throw new AppError(UserSocialAccountMessages.ACCOUNT_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  // Safety: never strip a user's last remaining login method.
  if (await isLastLoginMethod(userId, account.userSocialAccountId)) {
    throw new AppError(UserSocialAccountMessages.CANNOT_UNLINK_ONLY_AUTH, 409, ErrorCode.CONFLICT);
  }

  await repo.delete({ userSocialAccountId: account.userSocialAccountId });
  await clearCache({ userId, provider, providerId: account.providerId });
  await emitLinkEvent('unlinked', userId, provider, ctx);
  if (ctx?.notify && ctx.tenantId) await notifyUser(userId, provider, 'unlinked', ctx.tenantId);
}

/**
 * True when removing `exceptAccountId` would leave the user with no way to log
 * in — i.e. they have no usable password and no other linked social account.
 */
export async function isLastLoginMethod(userId: string, exceptAccountId: string): Promise<boolean> {
  void exceptAccountId;
  const ds = await getDataSource();
  const otherSocial = await ds.getRepository(UserSocialAccountEntity).count({ where: { userId } });
  if (otherSocial > 1) return false; // another social account remains
  // No other social account — check for a usable password on the User row.
  try {
    const { User } = await import('@kuraykaraaslan-labs/user/server/entities/user.entity');
    const user = await ds.getRepository(User).findOne({ where: { userId }, select: ['userId', 'password', 'email'] });
    // A placeholder-email account (a provider that gave no verified address) holds a random
    // password nobody knows and no mailbox to reset it through: that password is not a way in.
    const hasPassword = Boolean(user?.password) && user!.password !== 'ERASED' && !isPlaceholderEmail(user?.email);
    return !hasPassword;
  } catch {
    // Conservative: if we can't verify a password, treat social as last method.
    return otherSocial <= 1;
  }
}

/** GDPR: delete all social accounts for a user (called on account deletion). */
export async function eraseForUser(userId: string): Promise<number> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSocialAccountEntity);
  const accounts = await repo.find({ where: { userId } });
  if (accounts.length === 0) return 0;
  await repo.delete({ userId });
  await clearCache({ userId });
  for (const a of accounts) await clearCache({ provider: a.provider as SocialAccountProvider, providerId: a.providerId });
  return accounts.length;
}
