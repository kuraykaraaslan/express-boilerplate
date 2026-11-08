# Organisation Module

The shape of the **tenant itself**: who it is (legal entities), where it
operates (sites) and how it slices itself for analysis (cost centers).

## Three words that are not the same thing

| Concept | Table | What it means |
|---|---|---|
| **tenant** | `tenants` | The SaaS **account** — the customer who pays us, the boundary every query is scoped to. |
| **contact.Company** | `contact_companies` | An **external counterparty** — a customer, a supplier, the other side of a document. See [contact_companies.entity.ts](../contact/server/entities/contact_companies.entity.ts). |
| **organization** | `organization_*` | The **internal structure of that account** — the tenant's own legal persons, its own buildings, its own analytic dimensions. |

Getting these three confused is how a repo ends up storing the company's tax id
in three unrelated settings families and its branch list in three unrelated
tables. This module exists to be the one place each of those lives.

`organization` is the **base of the ERP graph**: `dependencies.requires` is
empty and it imports only ambient infrastructure. Everything it needs to know
about its consumers arrives through the `organization:reference_check`
extension point instead.

## Entities

| Class | Table | Notes |
|---|---|---|
| `LegalEntity` | `organization_legal_entities` | `code`, `legalName`, `tradeName?`, `legalForm?`, `countryCode` (2), `taxId?`, `taxOffice?`, `vatNumber?`, `registrationNumber?` (MERSİS), `addressJson?`, `email?`, `phone?`, `website?`, `iban?`, `bankName?`, `logoStorageKey?`, `isDefault`, `isActive` |
| `Site` | `organization_sites` | `code`, `name`, `kind` (OFFICE\|BRANCH\|WAREHOUSE\|PLANT\|STORE\|REMOTE — free-form), `legalEntityId?` (bare uuid), `addressJson?`, `countryCode?`, `city?`, `timezone?`, `isHeadquarters`, `isActive` |
| `CostCenter` | `organization_cost_centers` | `code`, `name`, `parentId?`, `path` (materialised `/GY/SAT/IST`), `glAccountId?` (bare uuid — `accounting` is not a dependency), `isActive` |

All three soft-delete and carry a partial unique index on
`(tenantId, code) WHERE "deletedAt" IS NULL`, so a retired row releases its code.
`LegalEntity` additionally carries a partial unique index on
`(tenantId) WHERE "isDefault" AND "deletedAt" IS NULL` — the database, not a
racy service, is what guarantees a single default.

### Nothing here is ever hard-deleted

`SiteService.delete` and `CostCenterService.delete` set `isActive = false` and
soft-remove. `OrganizationLookupService.resolveLabels` reads soft-deleted rows
(`withDeleted: true`) on purpose, so a five-year-old journal line, payslip or
shipment still renders `SAT — Satış` instead of a raw uuid, while every picker
(`options`) offers only live rows. That pairing is the contract: **history stays
readable, choices stay current.**

### Cost center paths

`CostCenterService` is the only writer of `path`. On create it is
`<parent.path>/<code>` (or `/<code>` for a root); on update, changing either the
code or the parent re-materialises the node's path and rewrites every
descendant's prefix in the same call. Re-parenting a node under itself or under
one of its own descendants is rejected with a 400 before anything is written.
`subtree()` / `subtreeIds()` are one `LIKE '<path>/%'` scan — the `/%` matters,
since `'<path>%'` would also match a sibling whose code merely starts with the
same letters.

## Legal-entity deduplication — write-through, not read-through

Before this module, the tenant's own legal identity lived in **three** settings
families:

| Consumer | Keys | Read by |
|---|---|---|
| `invoice` | 13 × `company*` | `InvoicePdfService.loadSeller()` |
| `terms_consent` | 7 × `legalSeller*` | distance-selling / pre-information documents |
| `payment` | `taxId`, `vatNumber`, `billingName`, `billingAddress` | tenant billing profile |

`organization` becomes the **editor**. On every create/update of the `isDefault`
legal entity, `LegalEntityService.projectToSettings` writes all 24 keys through
`SettingService.updateMany` and then locks them, so the old panels render
read-only. `LegalEntityService.importFromSettings` runs the inverse exactly once:
on first enable it materialises the first legal entity out of whatever those keys
already held, so nothing is lost.

Why this direction:

- **Zero code change** in `invoice`, `terms_consent` and `payment`. `loadSeller()`
  is untouched, so this refactor has no way to break an invoice PDF.
- **Zero new `requires` edges.** Read-through would force `organization` on every
  tenant that issues an invoice, and business modules default to OFF per tenant.
  `tenant_setting` is ambient, so the projection adds no edge at all.
- Disabling `organization` again leaves the settings at their last projected
  value, and everything downstream keeps working.

Two implementation details that are load-bearing:

1. `SettingService.updateMany` **silently skips locked keys**. Locking after the
   first projection would therefore make every later projection a silent no-op —
   exactly the drift the design exists to prevent. `projectToSettings` unlocks,
   writes, and re-locks.
2. `companyLogoUrl` is a **URL** in invoice's renderer while `logoStorageKey` may
   be an opaque storage key, so it is projected only when it is an absolute
   `http(s)` URL. Everything else projects unconditionally, including as `''`,
   because clearing a field in the editor must clear it downstream.

The escape hatch is `organizationProjectLegalEntityToSettings = 'false'`.

## Public API

Import from the barrel `@kuraykaraaslan-labs/organization`:

| Export | Type | Use |
|---|---|---|
| `LegalEntityService` | class | Legal entity CRUD + `getDefault` / `setDefault` / `projectToSettings` / `importFromSettings` |
| `SiteService` | class | Site CRUD, single-headquarters invariant |
| `CostCenterService` | class | Cost center CRUD + `subtree()` / `subtreeIds()`, materialised-path maintenance |
| `OrganizationLookupService` | class | `resolveLabels()` batch label map + `options()` picker feed |
| `assertNotReferenced` / `collectReferences` | fn | `organization:reference_check` resolver used by every delete |
| `OrganizationRefKindEnum` / `OrganizationRefKind` | Zod / type | `LEGAL_ENTITY` · `SITE` · `COST_CENTER` |
| `buildProjection` / `legalEntityFromSettings` | fn | The two directions of the settings deduplication |
| `Create*DTO` / `Update*DTO` / `Get*Query` | Zod | Input validation |
| `*Schema` / `Safe*Schema` | Zod | Row shapes; `Safe*` omits `deletedAt` |
| `ORGANIZATION_MESSAGES` / `stillReferencedMessage` | object / fn | Error and message constants |
| `ORGANIZATION_KEYS` / `ORGANIZATION_SETTING_DEFAULTS` | const | Setting keys owned by this module |
| `seedOrganization` | fn | Turkish SME demo data (`@kuraykaraaslan-labs/organization/server/organization.seed`) |

### Lookup contract

```ts
OrganizationLookupService.resolveLabels(tenantId, [{ kind: 'COST_CENTER', ids }])
// → { 'COST_CENTER:<uuid>': 'SAT — Satış', … }   (resolves retired rows too)

OrganizationLookupService.options(tenantId, 'SITE')
// → [{ id, code, name }, …]  (active, non-deleted rows only, ordered by code)
```

`resolveLabels` omits ids it cannot resolve instead of inventing a label, and a
failed lookup is logged and degrades to the raw id — a label is decoration and
must never fail the page that asked for it.

## Extension points

| Point | Kind | Contract |
|---|---|---|
| `organization:reference_check` | hook | `(tenantId, { kind, id }) => Promise<{ moduleId, count, label } \| null>` |

Before any row is retired, its service asks **every** contribution whether the id
is still referenced. A non-zero `count` turns the delete into a 409 naming the
module and the count (`Cannot delete: 12 employees in module "hr" still
reference this record`). Contributions run concurrently; a contribution that
throws is logged and skipped, because a broken satellite must not make the
master data undeletable.

`hr` contributes the employee/department usage check from its own side. See
[`organization.reference-check.ts`](server/organization.reference-check.ts).

## Settings

| Key | Type | Default | Read by |
|---|---|---|---|
| `organizationLegalEntityCodePrefix` | text | `LE-` | `LegalEntityService.create` when the caller omits `code` |
| `organizationSiteCodePrefix` | text | `SITE-` | `SiteService.create` when the caller omits `code` |
| `organizationCostCenterCodePrefix` | text | `CC-` | `CostCenterService.create` when the caller omits `code` |
| `organizationProjectLegalEntityToSettings` | boolean | `true` | `LegalEntityService.projectToSettings` — the write-through kill switch |

## API

All under the tenant API base, e.g. `/api/organization/sites`.

| Method | Path | Permission |
|---|---|---|
| GET / POST | `/api/organization/legal-entities` | `organization.legal_entities.read` / `.create` |
| GET / PATCH / DELETE | `/api/organization/legal-entities/[legalEntityId]` | `organization.legal_entities.*` |
| GET / POST | `/api/organization/sites` | `organization.sites.read` / `.create` |
| GET / PATCH / DELETE | `/api/organization/sites/[siteId]` | `organization.sites.*` |
| GET / POST | `/api/organization/cost-centers` | `organization.cost_centers.read` / `.create` |
| GET / PATCH / DELETE | `/api/organization/cost-centers/[costCenterId]` | `organization.cost_centers.*` |
| GET | `/api/organization/cost-centers/[costCenterId]/subtree` | `organization.cost_centers.read` |
| GET | `/api/organization/lookup/options?kind=…` | `organization.lookup.read` |
| POST | `/api/organization/lookup/labels` | `organization.lookup.read` |

Responses follow the house shape: list `{ data, total }`, single `{ item }`,
create `{ item }` + 201, delete `{ success: true }`. `lookup/labels` is a POST
that answers `{ labels }` with 200 — it is a read whose id list is too long for
a query string, not a create.

Every administrative permission is `minRole: ADMIN`. `organization.lookup.read`
is `minRole: USER` on purpose: an ESS or manager surface must be able to render
a site picker without being able to administer the organisation.

## Menu

**Organisation** → `/admin/organization/legal-entities`, group `Organisation`,
workspace `erp`, order 5. This is deliberately **not** an HR module — accounting,
procurement, inventory and project all reference it, and none of them should
have to install HR to book a cost center.

Sites, cost centers and settings are reached from that page. Settings live
behind a `PageHeader` gear action on every list page.

## Dependencies

`dependencies.requires` is **empty**. `organization` imports only ambient
infrastructure (`db`, `logger`, `tenant_setting`, `audit_log`, `limiter`,
`auth_abac`, `common`, `localization`), and edges into the ambient set are
excluded from the activation graph in both directions — see `AMBIENT` in
[scripts/registry/imports.mjs](../../scripts/registry/imports.mjs).

Deliberately **not** dependencies:

- `hr` / `accounting` / `inventory` / `procurement` — would cycle; every one of
  them requires (or bare-uuid-references) `organization`. Usage arrives via
  `organization:reference_check`.
- `invoice` / `terms_consent` / `payment` — the settings projection goes through
  ambient `tenant_setting`, never through those modules' code.
- `seed` — `SeedContext` is imported as a **type only**; type imports are erased
  and `*.seed.*` files are excluded from the import graph outright.

## Seed

`seedOrganization(ctx)` builds a plausible Turkish SME: one default legal
entity, one HQ site, and a `Genel Yönetim` cost center with `Satış` / `Üretim` /
`Ar-Ge` beneath it. The legal entity uses the same precedence as
`importFromSettings` — existing `invoice` / `terms_consent` / `payment` identity
keys win, and the demo values only fill the gaps, so seeding a configured tenant
never renames the company on its invoices. Every row goes through `ctx.foc` on
the `{ tenantId, code }` natural key, so re-running is idempotent. It publishes
`refs.organizationLegalEntityId`, `refs.organizationSiteId` and
`refs.organizationCostCenterId` for downstream seeds.

## Tests

`npx vitest run modules/organization` — the invariants that matter: single
default legal entity (including demote-then-promote), the three-family
projection, the `importFromSettings` round trip, path materialisation / subtree /
cycle rejection, the reference-check 409, and label resolution for a retired row.
