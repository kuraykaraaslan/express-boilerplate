# User Preferences Module

Per-user UI/UX preferences: theme, language, timezone, date/time formats, notification opt-ins (email/SMS/push/newsletter), and week start day. One row per user, keyed by `userId`, with sensible defaults applied on creation.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `UserPreferences` | `user_preferences` | One preferences row per user (`userId` is `unique`). System-scoped — **no `tenantId` column**. |

Lives in the **system DB**. Defaults are baked into the entity columns: `theme=SYSTEM`, `language=EN`, `timezone=UTC`, `dateFormat=DD_MM_YYYY`, `timeFormat=H24`, `firstDayOfWeek=MON`, `emailNotifications=true`, `smsNotifications=false`, `pushNotifications=true`, and every marketing consent (`newsletter`, `productUpdates`, `promotionalOffers`) `false`: consent is never granted by default (migration `001_marketing_consent_defaults_off.sql` changes only the column defaults, so existing rows keep their stored values; 41-ui-fixes 06-user 1.3). A user without a row reads as these defaults everywhere, including the notification policy and in-app opt-outs (marketing categories held back).

---

## Files

| File | Purpose |
|---|---|
| `user_preferences.service.ts` | Core CRUD + Redis-cached reads (`getByUserId`, `create`, `update`, `upsert`, `delete`, `getOrCreateDefault`) |
| `user_preferences.types.ts` | `UserPreferences` type, `UserPreferencesSchema` (Zod), `UserPreferencesDefault` |
| `user_preferences.dto.ts` | `UpdatePreferencesRequestSchema` — request DTO for the PUT route |
| `user_preferences.enums.ts` | All preference enums |
| `entities/user_preferences.entity.ts` | TypeORM entity |
| `user_preferences.seed.ts` | Demo seed (3 system-scoped rows, keyed on `userId`) |

---

## Services / Responsibilities

`UserPreferencesService` (default export, static methods):

| Method | Responsibility |
|---|---|
| `getByUserId(userId)` | Read preferences (Redis-cached, single-flighted). Returns `null` if none exist. |
| `create(userId, data?)` | Insert a new row from `UserPreferencesDefault` merged with `data`. Throws if a row already exists. |
| `update(userId, data)` | Patch an existing row. Throws `Preferences not found` if missing. |
| `upsert(userId, data)` | Update if present, otherwise create from schema defaults merged with `data`. |
| `delete(userId)` | Delete the row. Throws `Preferences not found` if missing. |
| `getOrCreateDefault(userId)` | Return the existing row, or create one with defaults if missing. |

Every mutation calls `clearCache(userId)`; all reads/writes validate through `UserPreferencesSchema`.

---

## Preference Options

| Preference | Options | Default |
|---|---|---|
| `theme` | `LIGHT`, `DARK`, `SYSTEM` | `SYSTEM` |
| `language` | `EN`, `ES`, `FR`, `DE`, `CN`, `JP` | `EN` |
| `timezone` | free string (IANA tz, e.g. `Europe/Berlin`) | `UTC` |
| `dateFormat` | `DD_MM_YYYY`, `MM_DD_YYYY` | `DD_MM_YYYY` |
| `timeFormat` | `H24`, `H12` | `H24` |
| `firstDayOfWeek` | `MON`, `SUN` | `MON` |
| `emailNotifications` | `boolean` | `true` |
| `smsNotifications` | `boolean` | `false` |
| `pushNotifications` | `boolean` | `true` |
| `newsletter` | `boolean` | `false` |

---

## Usage

```typescript
import UserPreferencesService from '@/modules/user_preferences/user_preferences.service';

// Read (returns null if the user has no preferences yet)
const prefs = await UserPreferencesService.getByUserId(userId);

// Read-or-create with defaults
const ensured = await UserPreferencesService.getOrCreateDefault(userId);

// Update
await UserPreferencesService.update(userId, {
  theme: 'DARK',
  language: 'DE',
  timeFormat: 'H24',
});
```

---

## API Routes

Tenant-scoped under `/api/auth/me` (preferences are user-global; the tenant is used only to authenticate the session):

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[tenantId]/api/auth/me/preferences` | Read the authenticated user's effective preferences: `{ userPreferences, defaults, persisted }` — stored values over the URL tenant's defaults (the global defaults for a session of another tenant), `persisted: false` when the user has no row yet. `productUpdates` and `promotionalOffers` are writable on PUT like `newsletter`; granting one stamps `marketingConsentAt` and writes one consent-ledger decision, and a consent is stamped only on a false → true change |
| PUT | `/tenant/[tenantId]/api/auth/me/preferences` | Update preferences (body validated by `UpdatePreferencesRequestSchema`) |

Both routes authenticate via `TenantSessionNextService.authenticateTenantByRequest` and are rate-limited via `Limiter.checkRateLimit`. The PUT body accepts either `{ userPreferences: {...} }` or the fields at the top level.

---

## Saving never touches what was not sent (fixed 2026-09-25)

`PUT /me/preferences` accepts any subset of fields. An absent or `null` field is left as it is. The service validates with `patchSchema(UserPreferencesSchema)`.

Before this, the request schema required every field and rewrote `null` to a hard-coded value (`newsletter: null` → `true`). The service parsed with zod 4's `.partial()`, which keeps defaults, so **every save of the Me page**:

- re-granted `productUpdates` marketing consent;
- reset `currency`, `numberFormat` and `measurementSystem`;
- wiped `newsletterConsentAt` / `marketingConsentAt`;
- made `recordMarketingConsent` log a consent change the user never made.

Stored rows are not repaired: history cannot tell a reset from a real choice, and the consent audit trail shows when each flip happened.

## Caching

`getByUserId(userId)` is cached in Redis under `user_preferences:user:{userId}` (TTL = `SESSION_CACHE_TTL`, default 5 min). Null results are cached. Every mutation (`create`, `update`, `upsert`, `delete`) invalidates the key.

TTL is jittered (`jitter`) and reads are wrapped in in-process single-flight (`singleFlight`).

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

No per-tenant variability — Stores per-user UI/UX preferences (theme, language, timezone, notifications) in a system-scoped entity with no tenant variability — all users across all tenants share the same preferences table, keyed by userId only.

**Member preference defaults (page `/admin/settings/member-preferences`, 2026-10-27).** The preferences table is per user, but the defaults a member gets until they save their own are the tenant's (`UserPreferencesService.getTenantDefaults`, used by `getDefaults` / `getEffective` and the first `create`): `defaultTheme`, `defaultDateFormat`, `defaultTimeFormat`, `defaultFirstDayOfWeek`, `defaultNumberFormat`, `defaultMeasurementSystem` (declared in `user_preferences.setting.keys.ts`; the date, time and first-day keys are new). Language, timezone and currency defaults are the tenant's general settings. Unset = the global defaults; a value outside the schema drops the tenant's defaults (the global ones apply). Guarded by `user_preferences.settings.read` + `tenant_setting.config.read` (update: `user_preferences.settings.update`). `disabledNotificationChannels` (read here by `applyChannelRestrictions`) is notification's kill switch, not on this page.

---

## Dependencies

Requires: `db`, `tenant_setting`, `user`. Reads use `redis` (cache + single-flight) and `env` (`SESSION_CACHE_TTL`).
