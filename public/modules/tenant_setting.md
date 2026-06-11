# tenant_setting

- **id:** `tenant_setting`
- **tier:** tenancy
- **dir:** `modules/tenant_setting/`
- **hasExpressLayer:** false

Per-tenant key-value settings mirroring the system settings structure. Redis-cached with 10-min TTL. Falls back to global system settings when a tenant-specific value is not set.

## Services

- `tenant_setting.service.ts`

## Entities

- `tenant_setting.entity.ts`

## Owned routes

- `tenant` GET `/tenant/:tenantId/settings`
- `tenant` PUT `/tenant/:tenantId/settings`
- `tenant` DELETE `/tenant/:tenantId/settings/:key`
- `tenant` GET `/tenant/:tenantId/settings/:key`
- `tenant` GET `/tenant/:tenantId/settings/public`

## TypeORM entities

- `TenantSetting` (tenant) — `modules/tenant_setting/entities/tenant_setting.entity.ts`

## README

# tenant_setting module

Per-tenant key-value settings mirroring the system settings structure. Redis-cached with 10-min TTL. Falls back to global system settings when a tenant-specific value is not set.

---

## Files

| File | Purpose |
|---|---|
| `tenant_setting.service.ts` | Core: get, set, bulk update, fallback to global |
| `tenant_setting.types.ts` | `TenantSetting` type |
| `entities/tenant_setting.entity.ts` | TypeORM entity |

---

## Usage

```typescript
import TenantSettingService from '@/modules/tenant_setting/tenant_setting.service';

// Read a value (falls back to global setting if not overridden)
const value = await TenantSettingService.get(tenantId, 'MAIL_FROM_ADDRESS');

// Write a tenant-specific override
await TenantSettingService.set(tenantId, 'MAIL_FROM_ADDRESS', 'hello@acme.com');

// Bulk update
await TenantSettingService.bulkUpdate(tenantId, [
  { key: 'MAIL_FROM_ADDRESS', value: 'hello@acme.com' },
  { key: 'MAIL_FROM_NAME', value: 'Acme Support' },
]);

// Remove tenant override (revert to global)
await TenantSettingService.delete(tenantId, 'MAIL_FROM_ADDRESS');
```

---

## Fallback Behavior

`get(tenantId, key)` checks tenant-specific settings first. If the key is not set at the tenant level, it reads from the global system settings. This allows platform-wide defaults with per-tenant overrides.

---

## Caching

Settings are cached in Redis under `tenant:settings:{tenantId}:{key}` with a 10-minute TTL. Writes invalidate the cache immediately.
