# tenant

- **id:** `tenant`
- **tier:** tenancy
- **dir:** `modules/tenant/`
- **hasExpressLayer:** false

Multi-tenant organization management. Creates, updates, deletes tenants. Auto-provisions a personal tenant for every new user.

## Services

- `tenant.deletion.service.ts`
- `tenant.service.ts`

## DTOs

- `tenant.dto.ts`

## Entities

- `tenant.entity.ts`

## Enums

- `tenant.enums.ts`

## Message keys

- `tenant.messages.ts`

## Setting keys

- `tenant.setting.keys.ts`

## Owned routes

- `system` GET `/system/tenants`
- `system` POST `/system/tenants`
- `system` DELETE `/system/tenants/:tenantId`
- `system` GET `/system/tenants/:tenantId`
- `system` PUT `/system/tenants/:tenantId`

## TypeORM entities

- `Tenant` (tenant) — `modules/tenant/entities/tenant.entity.ts`

## README

# tenant module

Multi-tenant organization management. Creates, updates, deletes tenants. Auto-provisions a personal tenant for every new user.

---

## Files

| File | Purpose |
|---|---|
| `tenant.service.ts` | Core: CRUD operations, personal tenant provisioning |
| `tenant.types.ts` | `Tenant`, `CreateTenantInput`, `UpdateTenantInput` |
| `tenant.dto.ts` | Zod DTOs |
| `tenant.enums.ts` | `TenantStatus` enum |
| `tenant.messages.ts` | Error/success message strings |
| `tenant.setting.keys.ts` | Setting key constants |
| `entities/tenant.entity.ts` | TypeORM entity |
| `dictionaries/` | Localization (EN, ES, TR) |
| `ui/` | Tenant switcher and management UI components |

---

## Tenant Status

| Status | Meaning |
|---|---|
| `ACTIVE` | Fully operational |
| `INACTIVE` | Disabled, members cannot access |
| `SUSPENDED` | Admin-suspended, same as inactive |

---

## Usage

```typescript
import TenantService from '@/modules/tenant/tenant.service';

// Create a tenant
const tenant = await TenantService.create({
  name: 'Acme Corp',
  description: 'Our main workspace',
}, creatorUserId);

// Get by ID
const tenant = await TenantService.getById(tenantId);

// Update
await TenantService.update(tenantId, { name: 'Acme Inc' });

// Delete
await TenantService.delete(tenantId);

// List tenants for a user
const tenants = await TenantService.getByUserId(userId);
```

---

## Personal Tenant

When a new user registers, a personal tenant is automatically created for them. This tenant cannot be deleted.

---

## API Routes

```
GET    /api/tenants
POST   /api/tenants
GET    /tenant/[tenantId]/api/info
PUT    /tenant/[tenantId]/api/info
DELETE /tenant/[tenantId]/api/info
```
