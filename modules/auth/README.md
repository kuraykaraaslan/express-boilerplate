# Auth Module

Core credential authentication: login, passwordless magic-link login, registration, email verification, password management (change/forgot/reset), OTP (email/SMS), TOTP/2FA, CAPTCHA brute-force gating, and dormant-account sweeps. Operates against the **global `User` table** and is tenant-aware via `AuthPolicyService`, which resolves password / lockout / session / dormant / admin / access policies per request tenant (system ROOT value wins, tenant value applied as fallback). Uses bcrypt for hashing and Redis for token TTLs and rate limiting.

---

## Entities

The auth module owns **one** table — `user_consents` (GTH-7) — and reads/mutates entities owned by sibling modules, all in the **system (global) DB**:

| Entity | Table | Owner module | Used for |
|---|---|---|---|
| `UserConsent` | `user_consents` | **auth** | GTH-7: append-only ToS/Privacy consent records (document type + version + timestamp) captured at registration. Migration `006_auth_consent.sql`; registered in `@/modules/db`. |
| `User` | `users` | `user` | Identity, password hash, `userStatus`, `emailVerifiedAt`, `consentVersion`/`consentAcceptedAt` |
| `UserSecurity` | `user_securities` | `user_security` | Lockout state, login attempts, password history, OTP/TOTP secrets, backup codes, `lastLoginAt` |
| `UserSession` | `user_sessions` | `user_session` | Sessions issued after authentication |

Settings are read via the `setting` module; transactional mail/SMS via `notification_mail` / `notification_sms`.

---

## Services / Responsibilities

| Service | File | Responsibility |
|---|---|---|
| `AuthService` | `auth.service.ts` | Orchestrator: `login`, `register`, `changePassword`, `sendEmailVerification` / `verifyEmail`, `disableDormantAccounts`, `checkIfUserHasRole`, password hashing. Wires in policy, captcha, lockout, audit logging. |
| `AuthPolicyService` | `auth.policy.service.ts` | Resolves per-tenant policies (`getPasswordPolicy`, `getLockoutPolicy`, `getSessionPolicy`, `getDormantPolicy`, `getAdminPolicy`, `getAccessPolicy`) with sysadmin > tenant precedence and code defaults. Also `validatePassword` (complexity, identity-substring, sequential/repeated runs) and `isAdminIpAllowed` (exact IP + IPv4 CIDR). |
| `PasswordService` | `auth.password.service.ts` | `forgotPassword` (rate-limited reset token), `resetPassword` (policy + history enforced), `validateResetToken`, `invalidateResetToken`. |
| `OTPService` | `auth.otp.service.ts` | One-time codes over EMAIL/SMS: `requestOTP`, `verifyOTP`, `invalidateSessionOTPs`. Redis-backed TTL, rate limit, and attempt caps. |
| `TOTPService` | `auth.totp.service.ts` | Authenticator-app 2FA via `otplib`: `requestSetup`, `verifyAndEnable`, `verifyAuthenticate`, `verifyAuthenticateOrBackup`, `disable`, `generateBackupCodes`, `consumeBackupCode`. |
| `CaptchaService` | `auth.captcha.service.ts` | KD-19 brute-force gate: per-identity failure counter (30 min rolling window) and reCAPTCHA token verification (fail-closed when `recaptchaServerKey` unset). |

Supporting files: `auth.dto.ts` (Zod DTOs for every flow), `auth.messages.ts` (error/success message keys), `auth.setting.keys.ts` (`AUTH_KEYS` / `AuthSettingKeySchema`), `auth.dormant.job.ts` (BullMQ scheduled sweep), `dictionaries/{en,es,tr}.json` (localization).

---

## Auth Flows

### Login
```typescript
import AuthService from '@/modules/auth/auth.service';

const { user, mustChangePassword } = await AuthService.login({
  email, password, captchaToken, tenantId, ipAddress, userAgent,
});
// Throws AuthMessages.CAPTCHA_REQUIRED/INVALID, ACCOUNT_LOCKED/DISABLED,
// INVALID_EMAIL_OR_PASSWORD, or MFA_ENROLLMENT_REQUIRED depending on policy.
```
Login short-circuits in policy order: CAPTCHA gate (before bcrypt), unknown identity, non-`ACTIVE` status, lockout, password compare, password-age forced-change flag, then `externalRequireMfa` enrolment check. All failure/success paths are audit-logged.

A person the app sent to sign in because their session ended (expired, revoked, or a refused refresh: `common/server/axios/axios.client.ts`
`sendToLogin`) arrives with `?redirect=<page>&reason=session_ended` (`LOGIN_REASON_SESSION_ENDED`). The login page then shows the
`SessionExpiredBanner` ("Your session ended. Sign in again to go back to the page you were on."; run 3 #99, D544). It never says that
unsaved changes were kept: nothing unsaved survives a forced sign-in (no autosave, D-UI2-3), and a kept-draft claim waits for the owner.

### Magic link (passwordless email login)
```typescript
import AuthMagicLinkService from '@/modules/auth/auth.magic-link.service';

// "email me a link" — returns void, and says the same nothing whether the
// address has an account, is a member, is suspended, or the feature is off.
await AuthMagicLinkService.request({ email, tenantId, ipAddress, userAgent, locale });

// The consume route trades the token for a session. Single-use (the token is
// deleted before anything else), short TTL, rate-limited per address, and NOT
// an MFA bypass — the route hands `consume()`'s SafeUser to the same
// `createSession` the password login uses, so a TOTP-required tenant still
// gets the OTP step.
const user = await AuthMagicLinkService.consume({ token, tenantId });
```
Gated by the `magicLinkEnabled` tenant setting (on by default). `magicLinkTtlSeconds`
(default 900) and `magicLinkRateLimitSeconds` (default 60) tune it. HTTP:
`POST /api/auth/magic-link` and `POST /api/auth/magic-link/consume`.

### Register
```typescript
const { user } = await AuthService.register({ email, password, phone, tenantId });
// Enforces password policy, seeds password history, provisions a personal
// tenant, and auto-accepts any pending invitations for the email.
```

### Change password
```typescript
await AuthService.changePassword({ userId, newPassword, tenantId });
// Enforces complexity + rejects reuse of current password or history hashes.
// Caller must verify the current password first.
```

### OTP (email/SMS one-time code)
```typescript
import OTPService from '@/modules/auth/auth.otp.service';

await OTPService.requestOTP({ user, userSession, method: 'EMAIL', action: 'authenticate' });
await OTPService.verifyOTP({ user, userSession, method: 'EMAIL', action: 'authenticate', otpToken });
```

### TOTP (authenticator app)
```typescript
import TOTPService from '@/modules/auth/auth.totp.service';

const { secret, otpauthUrl } = await TOTPService.requestSetup({ user, userSession });
const { enabled, backupCodes } = await TOTPService.verifyAndEnable({ user, userSession, otpToken });
await TOTPService.verifyAuthenticateOrBackup({ user, otpToken }); // TOTP, falls back to a backup code
```

### Forgot / reset password
```typescript
import PasswordService from '@/modules/auth/auth.password.service';

const { resetToken } = await PasswordService.forgotPassword({ email });
await PasswordService.resetPassword({ email, resetToken, newPassword, tenantId });
```

---

## API Routes

All auth routes are **tenant-scoped** under `/tenant/[tenantId]/api/auth/...` (the route layer derives the tenant context).

| Method | Path | Purpose |
|---|---|---|
| POST | `/tenant/[tenantId]/api/auth/login` | Credential login (`LoginDTO`; optional `rememberMe` widens the session window + cap and the cookie `maxAge`) |
| POST | `/tenant/[tenantId]/api/auth/register` | Self-registration |
| POST | `/tenant/[tenantId]/api/auth/logout` | End session |
| POST | `/tenant/[tenantId]/api/auth/refresh` | Refresh tokens |
| POST | `/tenant/[tenantId]/api/auth/change-password` | Change password (authenticated) |
| POST | `/tenant/[tenantId]/api/auth/forgot-password` | Request reset token |
| POST | `/tenant/[tenantId]/api/auth/reset-password` | Reset password with token |
| POST | `/tenant/[tenantId]/api/auth/verify-email/send` · `/verify` | Send / consume email-verification token |
| POST | `/tenant/[tenantId]/api/auth/otp/send` · `/verify` | Request / verify OTP code |
| POST | `/tenant/[tenantId]/api/auth/totp/setup` · `/enable` · `/disable` | TOTP lifecycle |
| GET | `/tenant/[tenantId]/api/auth/me/*` | Current-user profile, sessions, security, social accounts, notifications, preferences |
| — | `auth:session_extension` | Extension point: satellites add named sections to `GET /auth/session` and the device login body (`auth.session-extension.ts`, best-effort, cannot overwrite `user`/`tenant`/tokens). `terms_consent` contributes `compliance.pendingAgreements`. |
| — | `/tenant/[tenantId]/api/auth/{sso,saml,callback,csrf,session,impersonate,e-signature}/*` | Provider/SSO, SAML, OAuth callback, CSRF, session, impersonation, e-signature surfaces |

---

## Request-bound step-up (P9-19)

A route that must not run on a session alone calls `requireStepUp(request, session, { tenantId, purpose, target? })` from
`server/auth.step-up.service` after its own authorization and before any effect. The caller first gets a single-use challenge
(`POST /api/auth/step-up/options`, permission `auth.session.step_up`, USER floor) bound to user, session, tenant, purpose and
target, then proves a factor (`POST /api/auth/step-up/verify`): a user-verified WebAuthn assertion through the
`auth:step_up_method` extension point (`auth_passkey` contributes `webauthn`) or an unused TOTP code. The answer is an opaque
grant sent once in `x-step-up-token`; it is single use and lives five minutes. One attempt per challenge, backup codes and
impersonation sessions refused, Redis faults fail closed (503). A guarded route without a grant answers 401 with
`details.stepUp = { purpose, target?, windowSeconds }`; the UI hook `useStepUp` (`ui/step-up.dialog`) reads it, shows the dialog and
repeats the request once. Users today: `fleet_release` publish, revoke and the key routes, and the `fleet` trust bundle publish.

## Local credentials on a Fleet ID node (FID-07)

`auth:local_credentials_policy` (guard point, `auth.local-credentials.ts`) asks whether PEOPLE may hold and use credentials of this deployment.
Only on a fleet node (`FLEET_ROLE=node`) is it consulted; there `fleet_agent` answers it from the installed trust bundle: refused when the bundle
names the Fleet ID issuer and the node's region is `required` (or does not say), allowed for an `optional` or `forbidden` region or without Fleet
ID (decision F15, 12-fleet-identity.md section 3). A refusal, or a contribution that throws, times out or is paused (fail closed), makes the
password login, registration, password change, forgot and reset, magic link request and consume, TOTP setup and enable, and passkey login and
registration (`auth_passkey`) answer 403 `LOCAL_CREDENTIALS_DISABLED` before an account, token or code is read (no enumeration, nothing
created). The verdict is cached for 30 seconds per process. Break-glass shadow operators do not pass through it. The login page shows the
`fleet_id_*` error codes of the node's Fleet ID callback.

The node-local external identity providers are people's sign-in too, so the same verdict closes them (2026-10-19): social SSO (`auth_sso`),
tenant SAML (`auth_saml`), national identity (`auth_national_id`) and e-signature login (`auth_e_signature`), each at its start, its callback,
its JIT registration and its Connected Accounts linking (a linked provider identity would be a second people credential). JSON routes answer
403 `LOCAL_CREDENTIALS_DISABLED`; browser callbacks redirect with the closed code `local_credentials_disabled`
(`LOCAL_CREDENTIALS_DISABLED_CODE`), which the login page (`?error=`) and the Connected Accounts panel (`?linkError=`) translate.
`localCredentialsRefused()` is the non-throwing form those routes use (fail closed: a verdict that cannot be computed is a refusal).
Machine credentials (API keys, service principals, SCIM tokens) and the tenant-switch session exchange of an existing session are not people's
first factors and are not gated.

## Dormant-account sweep

`AuthService.disableDormantAccounts(tenantId?)` marks `ACTIVE` accounts `INACTIVE` when last activity (`user_securities.lastLoginAt`, falling back to `users.createdAt`) predates the dormant cutoff. With `dormantAccountAutoDisable=false` it becomes a dry-run (scans, disables nothing). Returns `{ scanned, disabled, erased }`. When `dormantDeleteAfterDays > 0` (GTH-8), accounts dormant beyond that window are additionally anonymised via `eraseUserData` (right-to-erasure).

`auth.dormant.job.ts` exposes the BullMQ queue/worker (`auth-dormant-sweep`). Two trigger paths:
- **Self-hosted:** call `scheduleDormantSweepJob()` once at startup (default cron `0 3 * * *`).
- **Serverless:** `POST /api/cron/dormant-sweep` on the root tenant with the `CRON_SECRET` bearer token.

---

## Settings

Setting keys are declared in `auth.setting.keys.ts` (`AUTH_KEYS` / `AuthSettingKeySchema`). Policy-bearing keys are resolved at request time by `AuthPolicyService` with **system ROOT value > tenant value > code default** precedence. See the Tenant Variability section below for the full per-tenant list and defaults, and the platform/root-only credential keys.

---

## Security

- **Password hashing:** bcrypt, cost 10. Password complexity (length, char classes), identity-substring rejection, and sequential/repeated-run detection live in `AuthPolicyService.validatePassword`; reuse is blocked against the current hash and the rotation history (`passwordHistoryCount`).
- **Lockout (KD-9):** failed attempts are recorded via `UserSecurityService`; the lock is checked **before** bcrypt to avoid a timing oracle. Thresholds from `lockoutMaxAttempts` / `lockoutDurationMinutes`.
- **CAPTCHA (KD-19):** consecutive failures per identity (including unknown identities, to stop username probing) trigger a required reCAPTCHA after `captchaTriggerAttempts`; verification is **fail-closed** when `recaptchaServerKey` is unset.
- **Tokens:** email-verification, OTP, and reset tokens are random (`crypto.randomInt` / `randomBytes`), stored **hashed** (SHA-256) in Redis with TTLs and per-identity rate limits; only the hash is persisted.
- **Generic errors:** dormant/suspended/locked accounts return generic messages so account liveness isn't leaked; failed logins for unknown identities are still audited (actorId null) and counted toward the CAPTCHA threshold.
- **Admin hardening (KD-13):** `AuthPolicyService.isAdminIpAllowed` gates admin surfaces against the tenant's `adminPanelIpAllowlist` (exact IP + IPv4 CIDR); `adminRequireMfa` forces MFA for admin access.
- **Transactional auth mail/SMS** now route through the **request tenant's** own provider config + branding (`tenantId ?? ROOT_TENANT_ID`), so white-label tenants surface their own `From:` and DKIM/DMARC alignment (GTH-5).

---

## GOODTOHAVE features (implemented)

### Security
- **FID-09 — the register page carries a same-origin `redirect`.** `/auth/register?redirect=<path>` (a same-origin path only: no `//host`, backslash or control character) passes it to the "Sign in" links, so a Fleet ID newcomer sent here by `prompt=create` signs in after creating the account and the sign-in continues at the hub's authorize request.
- **FID-09 — the tenant switcher links to the hub's "my workspaces".** On a Fleet ID node, `select-tenant` lists this node's memberships and shows "All my Fleet ID workspaces" pointing at the `switcherUrl` the node's `/api/auth/fleet-id/status` answers (https only; a 404 off a node renders nothing). The login page reads two more closed codes, `fleet_id_invitation_invalid` and `fleet_id_invitation_mismatch` (a newcomer joining with an invitation through Fleet ID).
- **GTH-1 / GTH-12 — `allowRegistration` & `emailVerificationRequired` enforced.** `register` rejects with `REGISTRATION_DISABLED` when self-registration is off (invite-only). `login` blocks with `EMAIL_VERIFICATION_REQUIRED` when a verified email is required and the user is unverified. Resolved in `AuthPolicyService.getAccessPolicy`.
- **GTH-2 — per-provider SSO allow-list.** `getAccessPolicy` exposes `ssoAllowedProviders`; `AuthPolicyService.isSsoProviderAllowed` / `filterAllowedProviders` narrow the offered provider list (empty list = all allowed; `disableSocialLogin` still denies everything).
- **GTH-3 — per-tenant OTP / reset / email-verify TTLs & limits.** New policies `getOtpPolicy`, `getResetPolicy`, `getEmailVerifyPolicy` read per-tenant settings, falling back to the historical env vars then code defaults. The OTP/password/verification services consume them.
- **GTH-4 — per-tenant TOTP issuer.** `TOTPService.getIssuer(tenantId)` reads the `totpIssuer` setting; falls back to `env.TOTP_ISSUER`.
- **GTH-5 — per-tenant auth email delivery.** OTP, verification, forgot/reset mail is routed through the request tenant's mail provider/branding. Localized subject via the auth dictionaries (GTH-10).
- **GTH-6 — per-tenant bcrypt cost.** `getCredentialPolicy(tenantId)` reads `bcryptCost` (validated 4–15, default 10). `hashPassword(password, tenantId)` and `resetPassword` honour it.

### Compliance
- **GTH-7 — consent-at-registration capture.** `register` writes a `UserConsent` row (document type + version) when `consentVersion` is supplied. Entity + migration `006_auth_consent.sql`.
- **GTH-8 — right-to-erasure in the dormant sweep.** `dormantDeleteAfterDays` (0 = disable-only). When set, `disableDormantAccounts` anonymises PII via `eraseUserData` for accounts dormant beyond the window. Returns `{ scanned, disabled, erased }`.
- **GTH-9 — `passwordMinAgeDays` guard.** `changePassword` rejects with `PASSWORD_CHANGED_TOO_RECENTLY` when the current password is younger than `minAgeDays`.

### i18n
- **GTH-10 — per-locale auth email subjects.** `auth.i18n.ts:authEmailSubject` resolves localized subjects from `dictionaries/{en,tr,es}.json` (`email_subjects`), threaded through the mail templates.
- **GTH-11 — locale-aware error messages.** `auth.i18n.ts:resolveLocale` (Accept-Language → supported locale) + `translateAuthMessage` resolve `AuthMessages` keys against the `errors` namespace of the dictionaries. The route layer passes the header in (modules/ stays framework-free).

### Multi-tenancy
- **GTH-12 — dead setting keys revived.** `allowRegistration`, `emailVerificationRequired`, `ssoAllowedProviders` are now enforced; lockout uses `lockoutMaxAttempts` (the canonical key).
- **GTH-13 — tenant MFA method allow-list.** `mfaAllowedMethods` (TOTP_APP/EMAIL/SMS; empty = all). Enforced in `OTPService.requestOTP` and `TOTPService.requestSetup`; helper `AuthPolicyService.isMfaMethodAllowed`.

### DX
- **GTH-15 — dormant-sweep tests.** Service-level (dry-run, disable, erase) + the `CRON_SECRET`-gated `POST /api/cron/dormant-sweep` path (`tests/auth.dormant.test.ts`, `tests/auth.dormant.cron.test.ts`).
- **GTH-16 — OpenAPI / JSON-Schema export.** `auth.openapi.ts` (Zod v4 `z.toJSONSchema`, no extra dep) exposes every auth DTO at `GET /tenant/[tenantId]/api/auth/openapi`.

### Monitoring
- **GTH-17 — per-tenant login-failure metrics.** Each failure path emits `ObservabilityService.recordTenantUsage({ tenantId, metric: 'auth_login_failure:<reason>' })` (Prometheus counter labelled by tenant).
- **GTH-18 — account-lockout webhook.** When a bad attempt crosses the lockout threshold, `WebhookService.dispatchEvent(tenantId, 'auth.account_locked', { … })` fires (best-effort, never blocks login).

---

## Tasarım notları (eski Final Faz 10 backlog'undan, 2026-09-11)

> Kaynak: `phases/_backlog/10.md` §"Faz 0 — TAMAM (2026-09-09)" (commit `48f5fcbd`). Backlog silindiği için
> kodun neden böyle olduğunu anlatan kararlar burada korunuyor.

**Yeni cihaz/konum girişi bildirimi — `auth.device-recognition.ts`.**
- Mail artık **her girişte değil**, yalnız tanınmayan cihaz/konumda gider: her seferinde gelen güvenlik uyarısı okunmadan silinmeyi öğretir, önemli olan da o yüzden silinir.
- "Burada daha önce bulundu mu" sorusu `user_sessions`'ın zaten tuttuğu satırlara sorulur — **`known_devices` tablosu yok**, aynı gerçeğin ikinci ve zamanla sapan kaydı olurdu.
- Tanıma sırası: parmak izi eşleşmesi (güçlü sinyal) → aynı user-agent **ve** aynı IP → aksi hâlde yeni. Aynı tarayıcı **farklı adresten** bilinmez sayılır (mailin var oluş sebebi bu); mobil şebekenin adres değiştirmesi ara sıra fazladan bir mail demek — yanılınacaksa doğru yön bu.
- Sorgu **oturum yazılmadan önce** yapılır (sonra yapılsa her giriş kendini tanır, uyarı hiç gitmez). Arama başarısız olursa "yeni" denir: kaçırılan uyarı, özelliğin önlemek için var olduğu şeydir.

**Sızmış parola reddi — `auth.breach-check.ts` (HIBP k-anonymity range API).**
- SHA-1 **yerelde** alınır, hash'in yalnız ilk **beş** karakteri gider, eşleşme burada yapılır. Önek uzunluğu **kasten ayar değil** — kimlik yolundan üçüncü tarafa çıkmayı kabul edilebilir kılan tek şey on binlerce parolanın paylaştığı önek. `Add-Padding` istenir; sayısı 0 olan sahte satırlar isabet sayılmaz.
- **Fail-open:** sızıntı listesinin çökmesi kimsenin parola değiştirmesini engellememeli. `skipped` ile `breached: false` **kasten** iki ayrı cevap — onları eşitleyen çağıran, sessizce kontrol etmeyi bırakır.
- Üç yola bağlı: `register`, `changePassword`, `resetPassword` (sonuncusu özellikle — parola sıfırlayan çoğu zaman sızıntı haberini yeni almıştır).
- Ayar **`passwordBreachCheck`** (varsayılan **kapalı**, `Hardening & Compliance` grubu): kayıt yolunda dışarı çağrı yapar; dışarı çıkamayan ya da üçüncü taraf istemeyen kurulum parola politikasının geri kalanını alır.

**Parola süre-sonu uyarısı — `auth.credential.login.service.ts`.**
- `maxAgeDays` sert bloğunun önüne son **7 gün** içinde `passwordExpiresInDays` eklendi; giriş ekranı mesajda söyler. **Yukarı yuvarlanır** — parola hâlâ çalışırken "0 gün" yazan sayaç uyarının yanlış olduğunu öğretir.
- Uyarı penceresi için **ayar yok**: ayarlanmaya değer sayı (`passwordMaxAgeDays`) zaten ayar; ikinci düğme çoğunlukla uyarıyı kapatmanın yolu olurdu.
- Aynı yolda kapanan sessiz hata: servisin hesapladığı `mustChangePassword` route'ta atılıyordu (süre-sonu politikası olan tenant engelliyor, istemci duymuyordu). Artık yanıtta.

**Kasten yapılmayanlar.**
- Her başarısız denemede güvenlik maili yok: aynı gürültü tuzağı + e-postası bilinen herkese istenmeyen posta göndermenin ucu olurdu. Kilitlenmede `user_security.login.service.ts` `notifyCritical` ile gider (tercih toggle'ı susturamaz).
- Parola geçmişi/yaşı için yeni servis yok — `UserSecurityService.getPasswordChangedAt/getPasswordHistory/pushPasswordHistory` zaten var (AGENTS.md §10.0/3: aynı kavram ikinci adla yazılmaz).

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

The auth module handles login, registration, password/OTP/TOTP, captcha, and dormant-account sweeps against the global User table, and is tenant-aware via AuthPolicyService, which resolves password/lockout/session/dormant/admin/access policies per request tenant (system ROOT value wins, tenant value applied as fallback).

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `passwordMinLength` | number | `8` | tenant | Minimum password length enforced at register/change/reset. | `auth.policy.service.ts` |
| `passwordRequireUppercase` | boolean | `true` | tenant | Require an uppercase letter in passwords. | `auth.policy.service.ts` |
| `passwordRequireLowercase` | boolean | `true` | tenant | Require a lowercase letter in passwords. | `auth.policy.service.ts` |
| `passwordRequireDigit` | boolean | `true` | tenant | Require a digit in passwords. | `auth.policy.service.ts` |
| `passwordRequireSpecial` | boolean | `true` | tenant | Require a special character in passwords. | `auth.policy.service.ts` |
| `passwordHistoryCount` | number | `3` | tenant | How many prior password hashes are kept and blocked from reuse. | `auth.policy.service.ts` |
| `passwordMaxAgeDays` | number | `42` | tenant | Password expiry age; on login, older passwords force a change (0 disables). | `auth.policy.service.ts` |
| `lockoutMaxAttempts` | number | `5` | tenant | Failed-login attempts before the account is locked. | `auth.policy.service.ts` |
| `lockoutDurationMinutes` | number | `15` | tenant | How long an account stays locked after exceeding max attempts. | `auth.policy.service.ts` |
| `sessionAbsoluteMaxHours` | number | `8` | tenant | Absolute max session lifetime before forced re-auth. | `auth.policy.service.ts` |
| `sessionRememberMeMaxHours` | number | `720` | tenant | Absolute max lifetime for a session where "remember me" was ticked at login. | `auth.policy.service.ts` |
| `sessionIdleTimeoutMinutes` | number | `30` | tenant | Idle timeout before a session is invalidated. | `auth.policy.service.ts` |
| `dormantAccountDays` | number | `90` | tenant | Inactivity threshold (days) after which accounts are swept as dormant (0 disables). | `auth.policy.service.ts` |
| `dormantAccountAutoDisable` | boolean | `true` | tenant | Whether the dormant sweep actually disables accounts (false = dry-run/report). | `auth.policy.service.ts` |
| `adminPanelIpAllowlist` | text | — | tenant | Comma-separated IP/CIDR allowlist for admin surfaces (empty = open). | `auth.policy.service.ts` |
| `adminRequireMfa` | boolean | `true` | tenant | Require MFA for admin-panel access. | `auth.policy.service.ts` |
| `externalRequireMfa` | boolean | `false` | tenant | Force MFA enrollment/verification for logins originating outside the LAN; login blocked until enrolled. | `auth.policy.service.ts` |
| `disableSocialLogin` | boolean | `false` | tenant | Completely disable social/OAuth login for the tenant. | `auth.policy.service.ts` |
| `captchaTriggerAttempts` | number | `3` | tenant | Consecutive failed-login attempts (per identity) that trigger a CAPTCHA requirement on next attempt (0 disables). | `auth.policy.service.ts` |
| `singleSessionOnly` | boolean | `false` | tenant | When true, a new session ends all other sessions of the same user in this tenant (a session cap of 1, enforced with `maxConcurrentSessions` in one place: user_session `enforceSessionCap`, MS-36). | `auth.policy.service.ts` |
| `allowRegistration` | boolean | `true` | tenant | GTH-1: when false, self-registration is rejected (invite-only). | `auth.credential.service.ts` |
| `emailVerificationRequired` | boolean | `false` | tenant | GTH-1/12: require a verified email before credential login. | `auth.credential.service.ts` |
| `ssoAllowedProviders` | text | — | tenant | GTH-2: CSV/JSON provider allow-list (empty = all). The ONE provider allowlist (MS-38): user_social_account's links read it too. A legacy `socialEnabledProviders` row is folded in read only (intersection when both are set; no overlap = nothing allowed, `disableSocialLogin` on), with a warning to move it here. | `auth.policy.validator.service.ts`, `auth.policy.loader.service.ts` |
| `mfaAllowedMethods` | text | — | tenant | GTH-13: CSV allow-list of MFA methods (TOTP_APP/EMAIL/SMS; empty = all). | `auth.otp.service.ts`, `auth.totp.service.ts` |
| `totpIssuer` | text | env | tenant | GTH-4: authenticator-app brand label; falls back to `env.TOTP_ISSUER`. | `auth.totp.service.ts` |
| `otpLength` | number | env/6 | tenant | GTH-3: OTP digit count. | `auth.otp.service.ts` |
| `otpExpirySeconds` | number | env/600 | tenant | GTH-3: OTP lifetime. | `auth.otp.service.ts` |
| `otpRateLimitSeconds` | number | env/60 | tenant | GTH-3: OTP rate-limit window. | `auth.otp.service.ts` |
| `otpMaxAttempts` | number | env/5 | tenant | GTH-3: OTP attempt cap. | `auth.otp.service.ts` |
| `resetTokenExpirySeconds` | number | env/3600 | tenant | GTH-3: password-reset token lifetime. | `auth.password.service.ts` |
| `resetTokenLength` | number | env/6 | tenant | GTH-3: reset token digit count (min 4). | `auth.password.service.ts` |
| `emailVerifyTtlSeconds` | number | env/86400 | tenant | GTH-3: email-verification token lifetime. | `auth.verification.service.ts` |
| `emailVerifyRateLimitSeconds` | number | env/300 | tenant | GTH-3: verification-email resend interval. | `auth.verification.service.ts` |
| `bcryptCost` | number | `10` | tenant | GTH-6: bcrypt cost factor (validated 4–15). | `auth.credential.service.ts` |
| `passwordMinAgeDays` | number | `0` | tenant | GTH-9: minimum age before a password may be changed again (0 disables). | `auth.credential.service.ts` |
| `dormantDeleteAfterDays` | number | `0` | tenant | GTH-8: anonymise dormant accounts after this many days of inactivity (0 = disable-only). | `auth.credential.service.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant). New GTH keys are surfaced in the Authentication settings page (`app/tenant/[tenantId]/admin/(tenant-scope)/auth/settings`) backed by `auth.settings.fields.ts`.*

### Per-tenant behavior

- `auth.service.ts:login` — CAPTCHA gating (captchaTriggerAttempts), lockout thresholds (lockoutMaxAttempts/lockoutDurationMinutes), password-age forced change (passwordMaxAgeDays), and external-MFA enforcement (externalRequireMfa) are all resolved via AuthPolicyService.get*Policy(tenantId), so login behavior differs per tenant.
- `auth.service.ts:register` — Password complexity and history seeding use getPasswordPolicy(tenantId) (passwordMinLength/require*/passwordHistoryCount), so accepted passwords vary per tenant.
- `auth.service.ts:changePassword` — Password complexity + reuse-history depth resolved from getPasswordPolicy(tenantId).
- `auth.service.ts:disableDormantAccounts` — Dormant cutoff window and whether accounts are actually disabled come from getDormantPolicy(tenantId) (dormantAccountDays/dormantAccountAutoDisable).
- `auth.password.service.ts:resetPassword` — Reset password complexity + history enforced via getPasswordPolicy(tenantId).
- `auth.policy.service.ts:getAdminPolicy / isAdminIpAllowed` — Admin IP allowlist (adminPanelIpAllowlist) and admin MFA requirement (adminRequireMfa) are resolved per tenant; isAdminIpAllowed gates admin access against the tenant CIDR/IP list.
- `user_session.crud.service.ts:createSession/getSession` — Session lifetime/idle timeout (getSessionPolicy(tenantId)) and single-session enforcement (getAccessPolicy(tenantId).singleSessionOnly) vary per tenant; note getSession at line ~201 calls getSessionPolicy() with NO tenantId, falling back to system/defaults.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| allowRegistration is declared in AuthSettingKeySchema and seeded per-tenant ('true') but no auth service reads it; self-registration is unconditionally allowed in AuthService.register. | `auth.service.ts:register (key declared in auth.setting.keys.ts, seeded in setting.seed.ts)` | A tenant that wants invite-only signup cannot turn off open registration; the key exists and is seeded but is never consulted, so the per-tenant toggle is inert. | `allowRegistration` |
| emailVerificationRequired is declared and seeded per-tenant but never read; AuthService never gates login/registration on a verified email. | `auth.service.ts (key declared in auth.setting.keys.ts, seeded in setting.seed.ts)` | Tenants requiring verified email before access have no enforcement path; the setting is dead. | `emailVerificationRequired` |
| maxLoginAttempts is declared and seeded per-tenant ('5') but unused; lockout actually uses the separate lockoutMaxAttempts key, leaving two overlapping knobs where one is inert. | `auth.setting.keys.ts / setting.seed.ts (lockout read in auth.policy.service.ts via lockoutMaxAttempts)` | Redundant/dead per-tenant key that can confuse tenant admins versus the lockoutMaxAttempts key that is actually enforced. | `lockoutMaxAttempts` |
| ssoAllowedProviders is declared and seeded per-tenant as a JSON list but no auth code reads it; disableSocialLogin only toggles all social login on/off. | `auth.setting.keys.ts / setting.seed.ts` | Tenants cannot restrict which specific OAuth providers are offered (e.g. allow Google but not GitHub); the per-tenant provider allowlist is declared but never enforced. | `ssoAllowedProviders` |
| Email-verification token TTL and rate-limit window are hardcoded from env (EMAIL_VERIFY_TTL_SECONDS, EMAIL_VERIFY_RATE_LIMIT_SECONDS), global across all tenants. | `auth.service.ts (EMAIL_VERIFY_TTL_SECONDS / EMAIL_VERIFY_RATE_LIMIT_SECONDS)` | Plausibly per-tenant (different security postures want different verification windows), but currently a single global env value. | `emailVerifyTtlSeconds` |
| Password-reset token TTL/length and forgot-password rate limit are hardcoded from env/constants, global across tenants. | `auth.password.service.ts (RESET_TOKEN_EXPIRY_SECONDS, RESET_TOKEN_LENGTH, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_SECONDS)` | Reset-link lifetime and reset rate limiting are reasonable per-tenant security knobs but are fixed globally. | `resetTokenExpirySeconds` |
| OTP length, expiry, rate-limit window and max attempts are hardcoded from env, global across tenants. | `auth.otp.service.ts (OTP_LENGTH, OTP_EXPIRY_SECONDS, OTP_RATE_LIMIT_SECONDS, OTP_MAX_ATTEMPTS)` | MFA delivery code lifetime/attempt budget could vary per tenant security policy; currently a single global config. | `otpExpirySeconds` |
| TOTP issuer label, step, window and digits are hardcoded from env (issuer defaults to 'Relatia'), global across tenants. | `auth.totp.service.ts (TOTP_ISSUER, TOTP_STEP_SECONDS, TOTP_WINDOW, TOTP_DIGITS)` | Authenticator-app issuer label is brand-facing and would ideally match each tenant's name/branding, but is a single global value. | `totpIssuer` |
| All transactional auth emails/SMS (verify, OTP, forgot/reset) are sent with tenantId: ROOT_TENANT_ID, so they always use platform mail/SMS provider config and branding, never the request tenant's. | `auth.service.ts:sendEmailVerification, auth.otp.service.ts:requestOTP, auth.password.service.ts:forgotPassword/resetPassword` | Tenants with their own mail provider/branding (tenant_branding) won't have it applied to auth emails because delivery is hardcoded to the root tenant context. | — |

### Platform/root-only settings (not per-tenant)

Configured once at the root tenant; identical for all tenants:

- `recaptchaServerKey` — Google reCAPTCHA secret used to verify CAPTCHA tokens; read only at ROOT_TENANT_ID in auth.captcha.service.ts (fail-closed when unset).
- `jwtAccessTokenSecret` — Platform JWT access-token signing secret (declared in auth.setting.keys.ts; platform credential).
- `jwtRefreshTokenSecret` — Platform JWT refresh-token signing secret (platform credential).
- `jwtAccessTokenExpiresIn` — Platform JWT access-token lifetime (declared in auth.setting.keys.ts).
- `jwtRefreshTokenExpiresIn` — Platform JWT refresh-token lifetime (declared in auth.setting.keys.ts).
- `googleClientId` — Google OAuth client id (platform OAuth credential, declared in auth.setting.keys.ts).
- `googleClientSecret` — Google OAuth client secret (platform OAuth credential).
- `githubClientId` — GitHub OAuth client id (platform OAuth credential).
- `githubClientSecret` — GitHub OAuth client secret (platform OAuth credential).
- `appleClientId` — Apple Sign-in client id (platform OAuth credential).
- `appleTeamId` — Apple developer team id (platform OAuth credential).
- `appleKeyId` — Apple key id (platform OAuth credential).
- `applePrivateKey` — Apple private key for Sign-in (platform OAuth credential).
- `metaClientId` — Meta/Facebook OAuth client id (platform OAuth credential).
- `metaClientSecret` — Meta/Facebook OAuth client secret (platform OAuth credential).
- `autodeskClientId` — Autodesk OAuth client id (platform OAuth credential).
- `autodeskClientSecret` — Autodesk OAuth client secret (platform OAuth credential).
- `gitlabToken` — GitLab integration token (platform credential).
- `gitlabUser` — GitLab integration user (platform credential).
- `oauthGoogle` — Enable/disable Google OAuth provider (declared in auth.setting.keys.ts).
- `oauthGitHub` — Enable/disable GitHub OAuth provider (declared in auth.setting.keys.ts).
- `oauthMicrosoft` — Enable/disable Microsoft OAuth provider (declared in auth.setting.keys.ts).
- `oauthLinkedIn` — Enable/disable LinkedIn OAuth provider (declared in auth.setting.keys.ts).
- `oauthApple` — Enable/disable Apple OAuth provider (declared in auth.setting.keys.ts).
- `oauthTwitter` — Enable/disable Twitter OAuth provider (declared in auth.setting.keys.ts).
- `oauthMeta` — Enable/disable Meta OAuth provider (declared in auth.setting.keys.ts).
- `oauthAutodesk` — Enable/disable Autodesk OAuth provider (declared in auth.setting.keys.ts).

---

## AI firewall: sign-up protection and the route signals (phase 55 02.6)

**Sign-up protection** (`server/auth.firewall-actions.ts`, `server/auth.signup-protection.ts`), soft by default and observed on install
like every firewall action (nothing runs them in phase 02; the responder of 05 does, under the tenant's mode):

| Action | What it does | Undo |
|---|---|---|
| `auth.signup_hold` | Holds a NEW (under 7 days), unverified account until its e-mail is verified: user_security's security lock with the sign-up marker (every sign-in method answers `EMAIL_VERIFICATION_REQUIRED`), no lock mail. It sends a fresh verification mail first and ends when that link does (D55-68: never a hold the person cannot lift alone; refused `no_verification_link` without one). Platform only; never over a standing lock; `verifyEmail` lifts it. | lifts its own hold only |
| `auth.signup_captcha` | Asks a CAPTCHA from an address from its first sign-up (38 2.4 asks from the fourth), for the TTL, on the tenant's sign-up (a platform run: every tenant's). Refused (`no_captcha_provider`) while no CAPTCHA provider is installed and configured (38 A-5). | lifts its own mark only |
| `auth.signup_block` | The hard block: refuses an address's sign-ups (403 `SIGNUP_BLOCKED`), only where the tenant opted in (`aiFirewallSignupHardBlock`, Settings -> AI firewall; off on install). Without the opt-in the run is refused and a standing mark has no effect. | lifts its own mark only |

The register route reads the address's marks in ONE bounded MGET (250 ms; none when Redis fails) after its own rate limit. The membership
review of a new member is tenant_member's (`tenant_member.signup_review`).

**Signals of the routes that wrote no row** (`server/auth.firewall-emitters.ts`, TALLIED: one signal per tenant, lane, actor and reason
every 10 s with the count, codes only): `auth.callback_refused` (`/callback`), `auth.refresh_refused` (`/refresh`, `/device/refresh`:
`reused` is about the person, high), `auth.otp_sent` (`/otp/send`), `auth.verify_email_sent` (`/verify-email/send`),
`auth.totp_setup_started` (`/totp/setup`), and `auth.signup_blocked` (a sign-up the hard block refused). Synchronous, never throw, never
change an answer (FWA-7).

## Dependencies

Requires: `user`, `user_session`, `user_security`, `notification_mail`, `notification_sms`, `setting`, `tenant`, `tenant_invitation`, `audit_log`, `webhook` (GTH-18), `observability` (GTH-17), `db`, `env`, `redis`, `common`. Dormant sweep additionally uses BullMQ via `redis/redis.bullmq`. TOTP uses `otplib`; password/token hashing uses `bcrypt` and Node `crypto`. OpenAPI export uses Zod v4's built-in `z.toJSONSchema()`.
