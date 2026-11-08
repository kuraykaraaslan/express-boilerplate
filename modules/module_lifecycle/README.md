# module_lifecycle

The single door for installing, activating, deactivating and purging a **built-in module** for a tenant
(`docs/phases/25-marketplace/02-audit-fix/05-module-lifecycle.md`). Platform Core, PROTECTED (a tenant can
never switch it off: the storefront, plan changes and provisioning all go through it).

Before it, the install/activate/purge orchestration lived inside the `marketplace` storefront, half of the same
work sat in `tenant_setting`, and the two computed the dependency closure with different rules. The store is now a
pure consumer.

## What it owns

| Piece | File |
|---|---|
| `installs` ledger entity (table `installs`, unchanged) | `server/entities/install.entity.ts` |
| `install`, `setActive`, `purge`, `previewDelete`, `reconcileEntitlements` | `server/module-lifecycle.service.ts` |
| Install-state, installable closure, dependents, table lookups | `server/module-lifecycle.helpers.ts` |
| Read side: every module with this tenant's install/active state | `server/module-lifecycle.catalog.ts` |
| The entitlement seam (`module_lifecycle:entitlement`) | `server/module-lifecycle.entitlement.ts` |
| `/api/marketplace/[moduleId]` and `/install` handlers | `server/module-lifecycle-{item,install}.route.ts` |

**API paths do not move with the module** (MIS-01 precedent): the routes are still
`POST /api/marketplace/[moduleId]/install` and `PUT|DELETE|GET /api/marketplace/[moduleId]`, so the storefront UI and
every client are unchanged. The `marketplace.modules.*` permissions and the `marketplace.*` audit actions keep their
ids for the same reason (role grants and audit history refer to them).

## What it does NOT own

- **Activation state** stays in `tenant_setting` (`module.<id>.enabled`, `getEnabledModuleIds`, `setModuleEnabled`).
  This module writes it, never replaces it; the hot path (Redis-cached setting read) is unchanged.
- **`PROTECTED` / `DEFAULT_ON`** stay in `tenant_setting`: its `setModuleEnabled` guard needs them and it cannot import
  this module (this one requires it). Still mirrored in `scripts/registry/imports.sets.mjs`.
- **Community plugins** (`artifactType: 'plugin'`) are the storefront's; they write the same ledger through
  `marketplace`'s `community-install.service.next`.

## One closure

`moduleRegistry.getRequiresClosure(id, { stopAt })` (in `common`) is the only walk. The activation store calls it with
no cut-off (the full closure makes a disable refusal conservative); this module passes `isProtectedModule` as `stopAt`
because always-on infrastructure is never installed and its own requirements are not the installer's concern. (Walking
*through* protected modules would pull dozens of unrelated modules into every install — measured, not assumed.)

## Entitlement: `module_lifecycle:entitlement`

Both directions between this module and the billing rail would be a hard cycle, so the question is an extension point.
A rail contributes `(tenantId, moduleId) => { entitled, message? }`; `install` and re-activation call it, the first
objection wins and becomes a 403. **Zero contributors = everything allowed** (standalone). **A contributor that throws
denies** (503) — "cannot answer" is not "entitled". Contributions are not filtered by the tenant's enabled modules, so
switching the rail off is not a bypass. `tenant_subscription` contributes (free mode and ROOT are its business).

The other direction, `reconcileEntitlements(tenantId)`, is called by the rail after it takes an entitlement away
(`TenantModuleEntitlementService.revoke` / `cancelFundedBy`, and the hourly `expireLapsedEntitlements` sweep for periods that ran out): it **closes** installed modules the tenant is no longer
entitled to — dependents first — and keeps their data. Re-subscribing then re-activating brings a module straight back.
It also walks modules that are on with **no ledger row** (a `module.<id>.enabled` written before the ledger existed, or
by a seed or script — the runtime gate serves the projection, not the ledger), except a default-on module the tenant
never touched; closing one backfills its ledger row as inactive.

Activation is per tenant and is **not inherited from ROOT**: the settings read layer never falls back to the root
tenant for a ledger projection, so the operator installing a module for the platform tenant installs it for nobody
else (see the `tenant_setting` README, "Platform defaults").

A verdict also says **why** it entitles: `source: 'plan'` (something the tenant holds covers it) or `'unrestricted'`
(free mode, the operator, no rail at all). Plan provisioning, the store's "included in your plan" and the
plan-delivered uninstall guard act only on `'plan'`. A contributor that only caps answers `'ceiling'` (fleet_license's
platform edition, fleet step 3b.8): it can object, but its allow is left out when deciding `'plan'`, so a cap never hides a plan.
Install asks the contributors for the module and for every dependency it switches on (one already on is not re-asked).

## Governance: what the platform operator controls

`docs/phases/25-marketplace/03-module-governance` (built 2026-10-17). The reserved tenants (ROOT, Fleet) are the
operator and pass every rule below.

| Rule | Where | What it does |
|---|---|---|
| Operator-only modules (02) | manifest `placement` `root` or `fleet` (fleet family, `seed`, `marketplace_review`, `fleet_agent`; docs/phases/46-module-placement, which replaced `installableBy`) | never in a customer tenant's enabled set, never listed, never installable for one; a module is also refused outside its placement for ROOT and the fleet tenant (`isModulePlacedIn`) |
| Availability (03) | table `module_availability` (ROOT datasource, RLS-exempt), `module-lifecycle.availability.ts` | `available` / `unlisted` (arrives only with a plan, the operator or the default list) / `hidden` (no new installs) / `retired` (closed everywhere, data kept) |
| Per-tenant block (04) | table `module_policies` (tenant RLS), `module-lifecycle.policy.ts` | no install or reactivation for that tenant; setting it closes the module and its dependents |
| The gate | `module-lifecycle.gate.ts` (`assertModuleAllowed`) | asked by `install` (module + every dependency, before writing) and `setActive(…, true)`, before the entitlement seam |
| Install origin (06) | `installs.origin` | `tenant` / `plan` / `operator` / `default`, set when the row is created |
| Close reason (06) | `installs.closedReason` | `entitlement` / `policy` / `retired` when the platform closed it; null when a person did |
| Plan provisioning (06) | `provisionEntitlements` | after a grant, installs the UNLISTED modules a plan covers (or reactivates an `entitlement` close); a per-tenant marker makes the hourly job retry failures |
| Plan-delivered uninstall (MG-7) | `purge(…, { requestedBy })` | a tenant cannot uninstall what its plan installed while the plan covers it (409); the operator can |
| Default modules (01) | ROOT setting `platformDefaultModules`, `tenant:default_modules` | installed into every new tenant after its plan (`origin: 'default'`); refusals reported, never forced |

Operator API (`module_lifecycle.platform.manage` ROOT; `module_lifecycle.tenant_modules.read|manage` GLOBAL):
`/api/module-lifecycle/availability[/moduleId]`, `/api/module-lifecycle/default-modules`,
`/api/module-lifecycle/tenants/[targetTenantId]/{modules, modules/[moduleId], modules/[moduleId]/policy, default-modules}`.
Every action on a tenant is audited in that tenant (actor = the sysadmin) and as `module_lifecycle.operator.*` in ROOT.

Pages: Platform → Modules (`/admin/platform/modules`) and Tenants → *tenant* → Modules
(`/admin/tenants/[targetTenantId]/modules`). The store catalog (`listCatalog`) carries `origin`, `availability`,
`blocked`, `includedInPlan` and `planLocked` for the marketplace UI.

`requires`: `audit_log`, `common`, `db`, `logger`, `tenant_setting` — **not** `tenant_subscription`. It reaches
`tenant` (the active-tenant list for the retire sweep, the `tenant:default_modules` point) without declaring it:
both are protected, so the edge is ambient.
