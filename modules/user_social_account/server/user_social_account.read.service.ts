import 'reflect-metadata';
import { In } from 'typeorm';
import { getDataSource, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { UserSocialAccount as UserSocialAccountEntity } from './entities/user_social_account.entity';
import { SafeUserSocialAccount, SafeUserSocialAccountSchema, ConnectedAccount } from './user_social_account.types';
import type { SocialAccountProvider } from './user_social_account.enums';
import { SOCIAL_ACCOUNT_CACHE_TTL } from './user_social_account.helpers';
import { describeProvider } from './user_social_account.presentation';
import { batchTokenHealth } from './user_social_account.token.service';

export async function getByUserId(userId: string): Promise<SafeUserSocialAccount[]> {
  const cacheKey = `user_social_account:user:${userId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try { return JSON.parse(cached).map((a: unknown) => SafeUserSocialAccountSchema.parse(a)); }
    catch { await redis.del(cacheKey).catch(() => {}); }
  }

  return singleFlight(cacheKey, async () => {
    const ds = await getDataSource();
    const accounts = await ds.getRepository(UserSocialAccountEntity).find({ where: { userId } });
    const parsed = accounts.map((a) => SafeUserSocialAccountSchema.parse(a));
    await redis.setex(cacheKey, jitter(SOCIAL_ACCOUNT_CACHE_TTL), JSON.stringify(parsed)).catch(() => {});
    return parsed;
  });
}

/**
 * All of a user's linked identities, enriched for display: each row classified
 * via `describeProvider` (kind/group/label/icon) with OAuth token-health folded
 * in. Unifies social (OIDC/SSO), enterprise (SAML) and government (ACS) accounts
 * into one list a single panel can render.
 */
export async function listConnectedAccounts(userId: string): Promise<ConnectedAccount[]> {
  const accounts = await getByUserId(userId);

  // Token health only applies to OAuth accounts (SAML/ACS store no tokens).
  const oauthIds = accounts
    .map((a) => ({ id: a.userSocialAccountId, kind: describeProvider(a.provider).kind }))
    .filter((a) => a.kind === 'oauth')
    .map((a) => a.id);
  const health = oauthIds.length ? await batchTokenHealth(oauthIds) : [];
  const healthById = new Map(health.map((h) => [h.userSocialAccountId, h]));

  return accounts.map((a) => {
    const descriptor = describeProvider(a.provider);
    const h = descriptor.kind === 'oauth' ? healthById.get(a.userSocialAccountId) : undefined;
    return {
      ...a,
      ...descriptor,
      ...(h ? { tokenExpired: h.expired, tokenExpiresAt: h.expiresAt } : {}),
    };
  });
}

export async function getByProviderAndProviderId(
  provider: SocialAccountProvider,
  providerId: string,
): Promise<SafeUserSocialAccount | null> {
  const cacheKey = `user_social_account:provider:${provider}:${providerId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return parsed === null ? null : SafeUserSocialAccountSchema.parse(parsed);
    } catch { await redis.del(cacheKey).catch(() => {}); }
  }

  return singleFlight(cacheKey, async () => {
    const ds = await getDataSource();
    const account = await ds.getRepository(UserSocialAccountEntity).findOne({
      where: { provider, providerId },
    });
    const result = account ? SafeUserSocialAccountSchema.parse(account) : null;
    await redis.setex(cacheKey, jitter(SOCIAL_ACCOUNT_CACHE_TTL), JSON.stringify(result)).catch(() => {});
    return result;
  });
}

export async function findUserIdByProvider(
  provider: SocialAccountProvider,
  providerId: string,
): Promise<string | null> {
  const account = await getByProviderAndProviderId(provider, providerId);
  return account?.userId ?? null;
}

/**
 * The tenant's provider allowlist. MS-38: there is ONE, auth's `ssoAllowedProviders` (with `disableSocialLogin`), read through
 * AuthPolicyService, the same answer the sign-in routes get. The undeclared second list this used to read,
 * `socialEnabledProviders`, is folded into it there (a stored row still narrows the list; the stricter wins). Without a tenant
 * the platform (ROOT) policy applies. When the policy service cannot be loaded or throws, no provider is allowed (it used to
 * answer "allowed"); a settings outage inside it still reads as "no list" (AuthPolicyService's defaults, pinned as
 * user_social_account.02).
 */
export async function isProviderAllowed(tenantId: string | undefined, provider: SocialAccountProvider): Promise<boolean> {
  try {
    const { default: AuthPolicyService } = await import('@kuraykaraaslan-labs/auth/server/auth.policy.service');
    const policy = await AuthPolicyService.getAccessPolicy(tenantId);
    return AuthPolicyService.isSsoProviderAllowed(String(provider), policy);
  } catch { return false; }
}

/**
 * Region-aware, allowlist-filtered providers to offer a user: regional hints
 * for the country intersected with the tenant's enabled-provider allowlist.
 */
export async function availableProviders(tenantId: string | undefined, country: string | null | undefined): Promise<string[]> {
  const { regionalProviderHints } = await import('./user_social_account.enums');
  const hints = regionalProviderHints(country);
  const filtered: string[] = [];
  for (const p of hints) {
    if (await isProviderAllowed(tenantId, p as SocialAccountProvider)) filtered.push(p);
  }
  return filtered;
}

/**
 * Tenant-scoped listing: social accounts for every member of a tenant.
 *
 * The membership lookup runs inside the chokepoint (docs/phases/10-db Faz 3) — it is
 * the module's one TENANT-scoped call site (`TenantMember` carries
 * `tenantId`). `UserSocialAccountEntity` itself has no `tenantId` column (a
 * social identity is owned by the user, not a tenant), so that second lookup
 * stays on `getDataSource()`, outside the chokepoint's transaction, per
 * db.context.ts's own "keep the block short" rule.
 */
export async function listForTenant(tenantId: string): Promise<SafeUserSocialAccount[]> {
  const { TenantMember } = await import('@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity');
  const members = await withTenantRepositoryFor(tenantId, TenantMember, (repo) =>
    repo.find({ where: { tenantId }, select: ['userId'] }));
  const userIds = [...new Set(members.map((m) => m.userId))];
  if (userIds.length === 0) return [];
  const ds = await getDataSource();
  const accounts = await ds.getRepository(UserSocialAccountEntity).find({ where: { userId: In(userIds) } });
  return accounts.map((a) => SafeUserSocialAccountSchema.parse(a));
}
