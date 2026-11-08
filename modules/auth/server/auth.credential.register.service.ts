import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { recordConsent } from './auth.consent-sink';
import bcrypt from 'bcrypt';
import Logger from '@kuraykaraaslan-labs/logger';
import UserService from '@kuraykaraaslan-labs/user/server/user.service';
import TenantInvitationService from '@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { SafeUser, SafeUserSchema } from '@kuraykaraaslan-labs/user/server/user.types';
import AuthMessages from './auth.messages';
import AuthPolicyService from './auth.policy.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { requireE164 } from '@kuraykaraaslan-labs/common/server/common.phone';
import { resolveTenantCountry } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.country';
import { hashPassword } from './auth.credential.helpers';
import { checkPasswordBreach } from './auth.breach-check';
import { assertLocalCredentialsAllowed } from './auth.local-credentials';

export async function register({ email, password, phone, tenantId, consentVersion }: {
  email: string; password: string; phone?: string; tenantId?: string; consentVersion?: string;
}): Promise<{ user: SafeUser }> {
  // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
  await assertLocalCredentialsAllowed();
  // GTH-1 / GTH-12: honour the tenant's self-registration posture. Invite-only
  // tenants set `allowRegistration=false`; the only path in is an invitation.
  const accessPolicy = await AuthPolicyService.getAccessPolicy(tenantId);
  if (!accessPolicy.allowRegistration) {
    throw new AppError(AuthMessages.REGISTRATION_DISABLED, 403, ErrorCode.FORBIDDEN);
  }

  const existingUser = await UserService.getByEmail(email);
  if (existingUser) throw new AppError(AuthMessages.EMAIL_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);

  const policy = await AuthPolicyService.getPasswordPolicy(tenantId);
  const policyError = AuthPolicyService.validatePassword(password, policy, { email });
  if (policyError) throw new AppError(policyError, 422, ErrorCode.VALIDATION_ERROR);

  // Backlog F10 §0: a password already on a public breach list is refused when
  // the tenant asked for the check. It fails OPEN — a breach-list outage must
  // not stop somebody registering (see `auth.breach-check`).
  const breach = await checkPasswordBreach(password, { enabled: policy.breachCheck });
  if (breach.breached) throw new AppError(AuthMessages.PASSWORD_BREACHED, 422, ErrorCode.VALIDATION_ERROR);

  // Canonicalize to E.164 before the row is written. Signup is the one place a
  // person types a phone number without an admin UI in front of them, so the
  // tenant's own country is what makes `0532 123 45 67` storable — the platform
  // `users` table has no tenant of its own to ask (see `normalizeUserPhone`).
  const normalizedPhone = requireE164(
    phone,
    tenantId ? await resolveTenantCountry(tenantId) : undefined,
    'Phone number',
  ) ?? undefined;

  const ds = await getDataSource();
  const hashed = await hashPassword(password, tenantId);
  const parsedUser = await ds.transaction(async (manager) => {
    const now = new Date();
    const newUser = manager.getRepository(UserEntity).create({
      phone: normalizedPhone,
      email: email.toLowerCase(),
      password: hashed,
      ...(consentVersion ? { consentVersion, consentAcceptedAt: now } : {}),
    });
    const saved = await manager.getRepository(UserEntity).save(newUser);
    return SafeUserSchema.parse(saved);
  });

  // GTH-7: persist a verifiable, versioned consent record (GDPR Art. 7 / KVKK /
  // LGPD). Append-only — one row per consent event. Routed through the sink
  // since DUP-03 so it lands in terms_consent's ledger when that module is
  // installed, and in auth's own table when it is not.
  //
  // Moved OUT of the transaction with the same change: the sink may write to a
  // different datasource entirely (the ledger is tenant-scoped, this manager is
  // not), and it is best-effort by contract — a consent-write failure must
  // never roll back an account that was otherwise created successfully.
  if (consentVersion) {
    await recordConsent({
      kind: 'DOCUMENT',
      userId: parsedUser.userId,
      documentType: 'terms_of_service',
      documentVersion: consentVersion,
      context: { tenantId: tenantId ?? null, source: 'registration' },
    });
  }

  await UserSecurityService.pushPasswordHistory(parsedUser.userId, hashed, policy.historyCount).catch(
    (err: unknown) => Logger.warn(`AuthCredentialService.register: seed history failed: ${err instanceof Error ? err.message : String(err)}`),
  );
  // No tenant is created here any more: a platform sign-up opens its organization in the onboarding (auth.registration.ts),
  // and a sign-up on a tenant joins that tenant. The automatic `<email>` personal tenant made every sign-up, including
  // one into an existing tenant, own a second workspace nobody asked for.
  await TenantInvitationService.autoAcceptForEmail(parsedUser.userId, parsedUser.email);
  // Phase 55 00.4: `auth.register` was written by the SSO sign-up only; a password sign-up left no row. Best-effort, like every
  // other row this service writes: an account that was created is never undone by its audit.
  AuditLogService.log({
    tenantId: tenantId ?? null, actorId: parsedUser.userId, actorType: 'USER',
    action: AuditActions.AUTH_REGISTER, resourceType: 'user', resourceId: parsedUser.userId,
    metadata: { method: 'password', consent: Boolean(consentVersion) },
  }).catch(() => {});
  return { user: parsedUser };
}

export async function changePassword({ userId, newPassword, tenantId }: {
  userId: string; newPassword: string; tenantId?: string;
}): Promise<void> {
  // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
  await assertLocalCredentialsAllowed();
  const ds = await getDataSource();
  const repo = ds.getRepository(UserEntity);
  const user = await repo.findOne({ where: { userId } });
  if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  const policy = await AuthPolicyService.getPasswordPolicy(tenantId);
  const policyError = AuthPolicyService.validatePassword(newPassword, policy, { email: user.email });
  if (policyError) throw new AppError(policyError, 422, ErrorCode.VALIDATION_ERROR);

  // Checked on the way IN, before the reuse and minimum-age rules: being told
  // "that one is breached" is more useful than being told "that one is too old
  // to change yet" about a password somebody is trying to get away from.
  const breach = await checkPasswordBreach(newPassword, { enabled: policy.breachCheck });
  if (breach.breached) throw new AppError(AuthMessages.PASSWORD_BREACHED, 422, ErrorCode.VALIDATION_ERROR);

  // GTH-9: minimum password age — block changing the password again until it
  // has aged `minAgeDays` (prevents history-cycling to revert to a banned one).
  if (policy.minAgeDays > 0) {
    const changedAt = await UserSecurityService.getPasswordChangedAt(userId).catch(() => null);
    if (changedAt) {
      const ageMs = Date.now() - changedAt.getTime();
      if (ageMs < policy.minAgeDays * 24 * 60 * 60 * 1000) {
        throw new AppError(AuthMessages.PASSWORD_CHANGED_TOO_RECENTLY, 422, ErrorCode.VALIDATION_ERROR);
      }
    }
  }

  const history = await UserSecurityService.getPasswordHistory(userId);
  for (const oldHash of history) {
    if (await bcrypt.compare(newPassword, oldHash)) throw new AppError(AuthMessages.PASSWORD_REUSED, 422, ErrorCode.VALIDATION_ERROR);
  }
  if (user.password && await bcrypt.compare(newPassword, user.password)) throw new AppError(AuthMessages.PASSWORD_REUSED, 422, ErrorCode.VALIDATION_ERROR);

  const newHash = await hashPassword(newPassword, tenantId);
  await ds.transaction(async (manager) => {
    await manager.getRepository(UserEntity).update({ userId }, { password: newHash });
    await UserSecurityService.pushPasswordHistory(userId, newHash, policy.historyCount);
  });
  await UserService.invalidate({ userId, email: user.email });
  AuditLogService.log({
    tenantId: tenantId ?? null, actorId: userId, actorType: 'USER',
    action: AuditActions.AUTH_PASSWORD_CHANGED, metadata: { userId },
  }).catch(() => {});
}
