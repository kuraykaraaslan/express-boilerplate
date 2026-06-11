# auth

- **id:** `auth`
- **tier:** identity
- **dir:** `modules/auth/`
- **hasExpressLayer:** true

Core authentication: login, registration, email verification, password management, OTP, and TOTP/2FA. Uses bcrypt and Redis for token TTLs.

## Services

- `auth.otp.service.ts`
- `auth.password.service.ts`
- `auth.service.ts`
- `auth.totp.service.ts`

## DTOs

- `auth.dto.ts`

## Message keys

- `auth.messages.ts`

## Setting keys

- `auth.setting.keys.ts`

## Owned routes

- `system` POST `/system/auth/email-verification/send`
- `system` POST `/system/auth/email-verification/verify`
- `system` GET `/system/auth/env`
- `system` GET `/system/auth/env`
- `system` GET `/system/auth/env`
- `system` POST `/system/auth/forgot-password`
- `system` POST `/system/auth/login`
- `system` POST `/system/auth/logout`
- `system` POST `/system/auth/otp/send`
- `system` POST `/system/auth/otp/verify`
- `system` POST `/system/auth/register`
- `system` POST `/system/auth/reset-password`
- `system` POST `/system/auth/totp/disable`
- `system` POST `/system/auth/totp/enable`
- `system` POST `/system/auth/totp/setup`

## Express layer (modules_express/) surface

- `auth/auth.middleware` _(middleware)_

## README

# auth module

Core authentication: login, registration, email verification, password management, OTP, and TOTP/2FA. Uses bcrypt and Redis for token TTLs.

---

## Files

| File | Purpose |
|---|---|
| `auth.service.ts` | Main orchestrator: login, register, email verify |
| `auth.otp.service.ts` | OTP generation, sending, and verification |
| `auth.password.service.ts` | Forgot password, reset password flows |
| `auth.totp.service.ts` | TOTP (authenticator app) setup and validation |
| `auth.dto.ts` | Zod DTOs for all auth flows |
| `auth.messages.ts` | Error/success message strings |
| `auth.scopes.ts` | Permission scope constants |
| `auth.setting.keys.ts` | Setting keys (OTP TTL, max attempts, etc.) |
| `dictionaries/en.json` | English localization |
| `dictionaries/es.json` | Spanish localization |
| `dictionaries/tr.json` | Turkish localization |
| `ui/auth.login.tsx` | Login form component |
| `ui/auth.register.tsx` | Registration form component |
| `ui/auth.forgot-password.tsx` | Forgot password form |
| `ui/auth.oauth-buttons.tsx` | SSO provider buttons |
| `ui/auth.session-expired.tsx` | Session expired modal |

---

## Auth Flows

### Login
```typescript
import AuthService from '@/modules/auth/auth.service';

const session = await AuthService.login({ email, password }, { ip, userAgent });
// Returns UserSession with access + refresh tokens
```

### Register
```typescript
const user = await AuthService.register({ email, password, name });
// Sends verification email automatically
```

### OTP (email/SMS one-time code)
```typescript
import AuthOTPService from '@/modules/auth/auth.otp.service';

await AuthOTPService.send(userId, 'LOGIN');
await AuthOTPService.verify(userId, code, 'LOGIN');
```

### TOTP (authenticator app)
```typescript
import AuthTOTPService from '@/modules/auth/auth.totp.service';

const { secret, qrCode } = await AuthTOTPService.setup(userId);
await AuthTOTPService.enable(userId, totpCode);
await AuthTOTPService.verify(userId, totpCode);
```

---

## API Routes

```
POST /api/auth/login
POST /api/auth/register
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/verify-email
POST /api/auth/otp/request
POST /api/auth/otp/verify
POST /api/auth/totp/setup
POST /api/auth/totp/enable
POST /api/auth/totp/verify
```
