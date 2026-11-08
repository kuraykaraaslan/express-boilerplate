import 'reflect-metadata';
import { In } from 'typeorm';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { UserSocialAccount as UserSocialAccountEntity } from './entities/user_social_account.entity';
import { openToken, sealToken } from './user_social_account.token-crypto';

export async function updateTokens(
  userSocialAccountId: string,
  accessToken: string,
  refreshToken?: string,
  opts?: { expiresAt?: Date | null; scopes?: string[] },
): Promise<void> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSocialAccountEntity);
  // The tokens are sealed under the row user's key (F27), so the owner is read first; an account that is gone has nothing to update.
  const owner = await repo.findOne({ where: { userSocialAccountId }, select: ['userSocialAccountId', 'userId'] });
  if (!owner) return;
  await repo.update(
    { userSocialAccountId },
    {
      accessToken: await sealToken(owner.userId, accessToken),
      refreshToken: await sealToken(owner.userId, refreshToken),
      ...(opts?.expiresAt !== undefined ? { accessTokenExpiresAt: opts.expiresAt } : {}),
      ...(opts?.scopes !== undefined ? { scopes: opts.scopes } : {}),
      lastRefreshedAt: new Date(),
    }
  );
}

/** Whether an access token is expired or within `skewSeconds` of expiry. */
export function isTokenExpired(account: { accessTokenExpiresAt?: Date | null }, skewSeconds = 120): boolean {
  if (!account.accessTokenExpiresAt) return false;
  return new Date(account.accessTokenExpiresAt).getTime() - Date.now() <= skewSeconds * 1000;
}

/**
 * Proactively refresh a token when near expiry using a caller-supplied OAuth
 * refresh function (the provider call lives in the auth layer — no mock here).
 * Persists the new tokens + expiry/scopes and returns the fresh access token.
 */
export async function refreshIfNeeded(
  userSocialAccountId: string,
  refreshFn: (refreshToken: string) => Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date | null; scopes?: string[] } | null>,
  skewSeconds = 120,
): Promise<string | null> {
  const ds = await getDataSource();
  const row = await ds.getRepository(UserSocialAccountEntity).findOne({ where: { userSocialAccountId } });
  if (!row) return null;
  if (!isTokenExpired(row, skewSeconds)) {
    return openToken(row.userId, row.accessToken);
  }
  const refreshToken = await openToken(row.userId, row.refreshToken);
  if (!refreshToken) return null;
  const refreshed = await refreshFn(refreshToken).catch(() => null);
  if (!refreshed?.accessToken) return null;
  await updateTokens(userSocialAccountId, refreshed.accessToken, refreshed.refreshToken, {
    expiresAt: refreshed.expiresAt ?? null, scopes: refreshed.scopes,
  });
  return refreshed.accessToken;
}

/** Return raw (decrypted) tokens for internal OAuth flows (token refresh, revocation), opened only under the row user's key. */
export async function getRawTokens(
  userSocialAccountId: string,
): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const ds = await getDataSource();
  const row = await ds.getRepository(UserSocialAccountEntity).findOne({
    where: { userSocialAccountId },
    select: ['userSocialAccountId', 'userId', 'accessToken', 'refreshToken'],
  });
  if (!row) return { accessToken: null, refreshToken: null };
  return {
    accessToken: await openToken(row.userId, row.accessToken),
    refreshToken: await openToken(row.userId, row.refreshToken),
  };
}

/**
 * Batch OAuth-token health check across accounts (proactive refresh planning):
 * which accounts are expired / expiring soon.
 */
export async function batchTokenHealth(userSocialAccountIds: string[]): Promise<Array<{ userSocialAccountId: string; provider: string; expired: boolean; expiresAt: Date | null }>> {
  if (userSocialAccountIds.length === 0) return [];
  const ds = await getDataSource();
  const rows = await ds.getRepository(UserSocialAccountEntity).find({ where: { userSocialAccountId: In(userSocialAccountIds) } });
  return rows.map((r) => ({
    userSocialAccountId: r.userSocialAccountId, provider: r.provider,
    expired: isTokenExpired(r), expiresAt: r.accessTokenExpiresAt ?? null,
  }));
}
