# Tenant Member Module

Tenant membership management with role-based access control. Maintains the per-tenant join table linking a user to a tenant with a role and status, enforces a role hierarchy, prevents demoting/removing the last owner, supports search by email, and soft-deletes members. Membership changes dispatch `member.*` webhooks.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `TenantMember` | `tenant_members` | Membership record linking a `userId` to a `tenantId` with `memberRole`, `memberStatus`, optional SCIM `externalId`, and `sessionVersion`. Unique on `(tenantId, userId)`; soft-deleted via `deletedAt`. |

Lives in the **tenant DB** (resolved via `tenantDataSourceFor(tenantId)`). User records it joins to live in the **system DB**.

---

## Roles

| Role | Permissions |
|---|---|
| `OWNER` | Full control, can manage admins |
| `ADMIN` | Manage members, settings, billing |
| `USER` | Standard access |

Role changes are restricted by hierarchy (`ROLE_HIERARCHY = ['OWNER','ADMIN','USER']`) — you cannot promote someone to a role equal to or above your own. The route layer also forbids non-owners from modifying or removing owners.

## Member Status

| Status | Meaning |
|---|---|
| `ACTIVE` | Normal access |
| `INACTIVE` | Disabled by admin |
| `SUSPENDED` | Policy violation |
| `PENDING` | Invited but not yet accepted |

Enums are defined in `tenant_member.enums.ts` (`TenantMemberRoleEnum`, `TenantMemberStatusEnum`).

---

## Files

| File | Purpose |
|---|---|
| `tenant_member.service.ts` | Core service: list/get, create, update, delete (soft), permission checks |
| `tenant_member.types.ts` | `TenantMemberSchema` / `SafeTenantMemberSchema` (Zod) and inferred types |
| `tenant_member.dto.ts` | Zod DTOs for create/update/get/list inputs |
| `tenant_member.enums.ts` | `TenantMemberRoleEnum`, `TenantMemberStatusEnum` |
| `tenant_member.messages.ts` | Error/success message strings |
| `tenant_member.settings.fields.ts` | UI field metadata for the Members settings page |
| `tenant_member.seed.ts` | Demo seed data |
| `entities/tenant_member.entity.ts` | TypeORM entity |
| `tenant_member.member-lookup.ts` | The `common:member_lookup` contribution: find members by name / e-mail and name bare user ids (see below) |

---

## Service (`TenantMemberService`)

All methods are `static`. Tenant-scoped reads/writes resolve the per-tenant DataSource via `tenantDataSourceFor(tenantId)`; user lookups use the system `getDataSource()`.

| Method | Responsibility |
|---|---|
| `getByTenantId({ tenantId, page, pageSize, search, memberRole, memberStatus })` | Paginated, filtered list of a tenant's members. `search` matches user email (ILIKE) against the system user table, then filters member rows by the matching `userId`s. Hydrates each member with its `user`. Returns `{ members, total }`. |
| `getById(tenantMemberId)` | Fetch a single member by id from the system DataSource; throws `MEMBER_NOT_FOUND` if missing. |
| `getByTenantAndUser({ tenantMemberId, tenantId, userId })` | Resolve a member by id (validated against tenant/user) or by `(tenantId, userId)`; returns `null` if not found. |
| `create(data)` | Enforces the unique `(tenantId, userId)` membership (throws `MEMBER_ALREADY_EXISTS`), persists, and dispatches the `member.created` webhook to the member's tenant. |
| `update(tenantMemberId, data)` | Updates role/status (skips `null` fields). Guards against demoting the last `OWNER` (`CANNOT_DEMOTE_OWNER`), increments `sessionVersion`, busts the Redis cache `tenant:member:<userId>:<tenantId>`, and dispatches `member.updated`. |
| `delete(tenantMemberId)` | Soft-deletes (`deletedAt`). Guards against removing the last `OWNER` (`LAST_OWNER`) and dispatches `member.deleted`. |
| `getUserTenants(userId)` | Lists a user's `ACTIVE`, non-deleted memberships across all tenants. |
| `hasRole(member, requiredRole)` | Pure hierarchy check against `ROLE_HIERARCHY`. |
| `checkPermission(tenantId, userId, requiredRole)` | Looks up the caller's `ACTIVE` member row in the tenant's own DataSource and gates by `hasRole`. Returns `false` if no membership. |

---

## Concurrency & invariants

- **Re-adding a removed member restores the row.** The `(tenantId, userId)` unique index covers soft-deleted
  rows, so a fresh insert (an accepted invitation, a manual re-add) used to fail with a 500. The row is now
  restored with the requested role and a clean suspension/groups state, and `sessionVersion` is bumped so
  the old membership's sessions do not come back. Creation is serialised per (tenant, user); a lost race is 409.
- **A tenant always keeps an active owner.** Every write that can take an ACTIVE owner away runs under one
  tenant-wide lock (`tenant:owners:<tenantId>`, shared with scim's group→role recompute), then counts the
  *other* active owners:
  - demotion, and **deactivation**, which used to bypass the check entirely;
  - removal;
  - ownership transfer.

  Before, two concurrent demotions of a tenant's two owners each saw the other and left the tenant ownerless.
- `unsuspend` lifts only a **SUSPENDED** membership (409 otherwise). It used to set ACTIVE unconditionally and
  reactivated members an IdP had deprovisioned (INACTIVE).
- **Role-set writes serialise on one lock** (`tenant_role:set:<tenantId>`):
  - the matrix Save runs in one transaction; its per-role read-modify-write used to lose a concurrent Save,
    so a revoked sensitive permission could come back;
  - built-in seeding, role create/update/delete;
  - a member's `roleKeys` assignment is checked under the same lock, so a group deleted concurrently cannot
    be attached after its holders were cleared.

  `updateRole` writes only the edited columns.
- `getUserTenants` lists a user's memberships across tenants, a deliberate `withSystemRLS` read. Everything
  else goes through the tenant chokepoint.

## API Routes

Tenant-scoped under `/tenant/[tenantId]/api/members`. All routes rate-limit and authenticate via `TenantSessionNextService.authenticateTenantByRequest`.

| Method | Path | Min role | Description |
|---|---|---|---|
| GET | `/tenant/[tenantId]/api/members` | USER | List members (`?page=&pageSize=&search=&memberRole=&memberStatus=`) |
| POST | `/tenant/[tenantId]/api/members` | ADMIN | Add a member (after `assertFeatureAccess` on `MAX_MEMBERS`) |
| GET | `/tenant/[tenantId]/api/members/[memberId]` | USER | Get one member (404 if not in this tenant) |
| PUT | `/tenant/[tenantId]/api/members/[memberId]` | ADMIN | Update role/status; non-owners cannot modify owners |
| DELETE | `/tenant/[tenantId]/api/members/[memberId]` | ADMIN | Soft-remove; non-owners cannot remove owners; an owner cannot remove themselves |
| GET | `/tenant/[ROOT]/api/tenants/[targetTenantId]/members` | platform operator (`tenant.tenants.read`, GLOBAL) | Read-only: any tenant's members for the operator's tenant page, on the same list contract (`?page=&pageSize=&search=&memberRole=&memberStatus=&createdFrom=&createdTo=&sort=`, `{ data, total }`); each row is an allow-list (role, status, joined, e-mail, profile name). 400 for a malformed id, 404 for an unknown tenant (41-ui-fixes/09 A2.1) |

The POST handler enforces the member limit via `tenant_subscription` feature `MAX_MEMBERS` (`assertFeatureAccess`). PUT/DELETE clear the session cache via `TenantSessionNextService.clearTenantCache`.

Self-registration into a tenant is handled by `POST /tenant/[tenantId]/api/auth/register`, which calls `TenantMemberService.create` for the new user (see *Settings* and *Tenant Variability*).

---

## Usage

```typescript
import TenantMemberService from '@/modules/tenant_member/tenant_member.service';

// List members
const { members, total } = await TenantMemberService.getByTenantId({
  tenantId,
  page: 1,
  pageSize: 20,
  search: 'alice',
  memberRole: 'ADMIN',
  memberStatus: 'ACTIVE',
});

// Change role
await TenantMemberService.update(memberId, { memberRole: 'ADMIN', memberStatus: null });

// Soft-remove member
await TenantMemberService.delete(memberId);

// Gate an action by role
const ok = await TenantMemberService.checkPermission(tenantId, userId, 'ADMIN');
```

---

## Settings

Surfaced at `/tenant/[tenantId]/admin/members/settings` (gear button in the Members page header) via the shared `ModuleSettingsPage` scaffold. UI field metadata: `tenant_member.settings.fields.ts`.

| Key | Type | Default | Notes |
|---|---|---|---|
| `defaultMemberRole` | select (`USER` \| `ADMIN`) | `USER` | Role given to an invited member when the invitation names no role, and to a member an admin adds without one; `OWNER` is excluded. **Owner-only** setting (with `tenantMemberDualControl`). Self-registration ignores it and always creates a `USER` (41-ui-fixes 05-tenant-member 3.1).

Read/written via `GET/PUT /tenant/[tenantId]/api/admin-settings`. See `docs/ROADMAP_SETTINGS.md`.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

Manages per-tenant membership records (linking a user to a tenant with a role and status), with a per-tenant default-member-role setting and role-hierarchy permission checks resolved against each tenant's own member rows.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `defaultMemberRole` | string | `USER` | tenant | Role given to an invited member when the invitation names no role, and to a member an admin adds without one; `OWNER` is excluded. **Owner-only** setting (with `tenantMemberDualControl`). Self-registration ignores it and always creates a `USER` (41-ui-fixes 05-tenant-member 3.1). | `route.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `TenantMember` | `tenant_members` | memberRole, memberStatus, externalId |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `tenant_member.service.ts:checkPermission` — Resolves the caller's role from the per-tenant member row via tenantDataSourceFor(tenantId), then gates by ROLE_HIERARCHY (OWNER>ADMIN>USER) — so the same user can hold different roles/permissions in different tenants.
- `tenant_member.service.ts:getByTenantId` — Lists/paginates members scoped to one tenant via tenantDataSourceFor(tenantId); each tenant sees only its own membership rows.
- `tenant_member.service.ts:create` — Enforces a per-tenant unique (tenantId,userId) membership and dispatches the 'member.created' webhook to that tenant's subscribers (WebhookService.dispatchEvent(saved.tenantId, ...)); update/delete likewise scope owner-count guards and webhooks to member.tenantId.
- `route.ts:register POST` — Self-registration is gated per tenant by the allowSelfRegistration setting; the joining member is always a `USER`, whatever `defaultMemberRole` says (41-ui-fixes 05-tenant-member 3.1).

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| ROLE_HIERARCHY (['OWNER','ADMIN','USER']) and thus the entire permission model is a hardcoded static constant in the service, identical for every tenant. | `tenant_member.service.ts (TenantMemberService.ROLE_HIERARCHY, hasRole/checkPermission)` | Likely intentionally global since role semantics are a core invariant of the auth model; only worth surfacing if custom per-tenant roles/RBAC ever become a product requirement. | — |

---

## Seats and the `max_members` ceiling

`tenant_member.seats` owns the answer to "is there room for one more?", and both
the invite path and the direct-add path go through it.

It counts ACTIVE members **plus unclaimed seats**. Before that, both checks
counted members alone: a pending invitation reserved nothing and `accept()`
never consulted the plan, so a tenant one seat below a 5-seat plan could send
fifty invitations — each passing a check that saw four members — and every
acceptance walked in. The paid ceiling was not a ceiling.

Unclaimed seats arrive through the **`tenant_member:seat_reservation`**
extension point rather than an import. This module is the tenancy primitive
`tenant_invitation` is built on; importing invitations back from here would
invert that and cycle. A contributor that throws is counted as zero — an
unrelated module's outage must not present itself to an admin as "your plan is
full".

Two deliberate limits:

- **The check is at ISSUE time, never at acceptance.** Refusing an invitee at
  the moment they click their link punishes the one person in the story who did
  nothing wrong and cannot act on the refusal. A downgrade can therefore leave a
  tenant briefly over its ceiling; that is the cheaper failure.
- **An undeclared limit is not a limit of zero.** Only a plan that states
  `max_members` refuses, and a feature-gate error fails open.

The **paid seat allowance** (`tenant_member:seat_allowance`, `seatAllowance`: the
seats the tenant's entitlements include, or the operator's override) is the second
ceiling, and `assertSeatAllowance` checks it the same way on both paths: ACTIVE
members plus unclaimed seats. Before 36-tenant-subscription 03-ui-fixes 2.1 only the
direct add-member POST checked it, against members alone, so invitations were the
way past a full allowance. No allowance (no seller, monetization off) means no
ceiling; unlike `max_members`, a seller that cannot answer refuses (503).

## Custom role groups

`tenant_roles` holds the tenant's own groups (`content.editor`, `finance.viewer`)
with their own permission sets, edited through the Access Rights matrix. Until
migration `118` **no member could be put in one**: `memberRole` is a three-value
enum, so a group existed only in the screen that created it.

`tenant_members.roleKeys` closes that. `memberRole` is untouched and remains the
**primary built-in role** — every guard, webhook payload and "cannot demote the
last OWNER" rule still reads it; `roleKeys` is read alongside.

**Groups are additive only.** A group can add a permission on top of the
built-in matrix; it can never take one away. That keeps the removal story in one
place — the matrix — instead of two that can disagree, and it makes the
migration free: an existing member starts `[]` and gains nothing until somebody
assigns them a group.

Assignment validates every key against an ACTIVE, non-builtin group in the same
tenant. A dangling key is a grant nobody can see in the roles screen — it would
sit on the member forever, granting whatever a future group of that name
happens to grant.

**A group lifts an ADMIN floor, never an OWNER one.** A permission's `minRole` is a floor on the built-in role, checked
before the policy engine. Until the group-floor change a USER member in a group that granted an ADMIN-floor permission was
refused 403 at that floor, so a group could only grant what a USER could hold anyway. Now `authorizeTenant` authenticates a
catalog-floored route at USER (membership, status, 2FA and IP checks unchanged), then requires the built-in role to meet
the floor **or** one of the member's groups to grant that exact permission over an ADMIN floor
(`auth_abac/server/auth_abac.guard.group-floor.next.ts`). Limits: an OWNER-floor permission (ownership transfer, deleting
the tenant) is never grantable by a group; a route that names its own `requiredTenantRole` stays strict; global admins,
impersonation and delegates behave as before; a failed role lookup grants nothing. Any other outcome authenticates again at
the real floor, so a refusal and its audit row are what they always were. The sidebar's `grantedPermissions` counts a group
grant the same way, so the menu and the API agree. The exception is a permission only system-scope menu entries name: its
page is served by a ROOT/GLOBAL route, which never lifts, so the layout passes it as `noGroupLift` and the menu does not
offer it to a group member (`permissionsExemptFromGroupLift`). ABAC deny policies still apply to a lifted member.

`auth_abac` reads both: `subject.roles` is the built-in role plus the keys, and
`subject.permissions` is the union of the groups' permission sets, resolved once
per request. See `modules/auth_abac/README.md`.


### The role-set cache holds at once on every node (D253)

`tenant_roles:<tenant>` (the set the PDP reads) is a guarded cache (session_end.cache-guard.ts): every role-set write (`roleSetWrite`:
matrix save, group create / update / delete) records a cache drop in its transaction (`recordRoleSetDrop`: the set deleted,
`tenant_roles:ver:<tenant>` bumped), delivered after the commit or by the session_end relay; a write whose drop cannot be recorded rolls
back. The set is believed only when sealed with the stamp of the read (Redis instance and that version) and no drop is pending for the
tenant; the bump also retires every cached ABAC decision of the tenant (auth_abac README, D253). `TenantRoleService.invalidate` drops
best-effort (delete and bump).

### Role templates (`tenant_member:role_template`)

`tenant_role.templates.ts` plus `GET/POST /api/access-control/role-templates` (`members.settings`), with a **From template…** picker on the Groups tab. A template is a ready-made custom group; once created it is an ordinary group the tenant can edit, assign and delete.

- **Merging:** contributions with the same key merge, and each module lists only its **own** permissions. `commerce_order`, `commerce_fulfillment`, `commerce_return` and `commerce_review` together make `store_operator`: read and ship orders, receive returns, moderate reviews. It has no catalogue, pricing, refunds or settings.
- **Filtering:** permissions are filtered to the tenant's enabled modules, and an empty template is not offered.
- **Why templates, not a lower `minRole`:** a storefront sign-up makes the shopper a **USER** member. Lowering an operator permission to USER would grant it to every customer; a group grants it only to the staff it is assigned to. A test pins that no `store_operator` permission has `minRole` USER or GUEST. That test found `commerce_review.reviews.reply` at USER, meaning any shopper could post the shop's public reply. It is now ADMIN, and migration 149 removes the grant from already-seeded built-in USER rows.

## Session-ending orders in the membership's transaction (D249)

`remove`, `suspend` and `update` (a status off ACTIVE; a role or custom-role change of an ACTIVE member) record the member's
session-ending orders INSIDE their own transaction (`recordSessionEndInTx`, point `session_end:order_source`: `websocket_session`'s
socket drops), deliver them after the member cache is dropped, and tell `tenant_member:membership_ended` / `access_changed`
`sessionEndOrderedBy` (the modules whose orders are recorded; their hooks skip). A broken order source never blocks the change: its
hook records after the commit as before. The firewall's review hold (`holdForReview`) records the drop in its transaction as well, and
tells no hook. docs/audits/2026-11-03-redis-outage.md §3.2.

## AI firewall: the review of a new membership (phase 55 02.6)

`tenant_member.signup_review` (`server/tenant_member.firewall-actions.ts`, observed on install) queues a membership that joined in the last
7 days (a self sign-up or an accepted invitation, any role but OWNER) for an administrator's review: `holdForReview` makes it PENDING (the
guard and the session refresh admit only ACTIVE members, its sessions stop through `sessionVersion`) with the run named in
`suspensionReason` (`firewall_review:<proposalId>`), audited `tenant_member.review_held`, the person told. An administrator approves by
setting the member ACTIVE on the members page. The undo (and the TTL's end) is `releaseReview`: back to ACTIVE only while it is still
PENDING with the run's marker (`tenant_member.review_released`). Tenant scope only.
### Member lookup (`common:member_lookup`)

`tenant_member.member-lookup.ts` is tenant_member's contribution to common's `common:member_lookup` point, for modules that store bare user
ids without owning people (first consumer: loyalty's accounts list, docs/phases/17-loyalty/06-ui-fixes 3.5). They read it through
`common/server/common.member-lookup` (`searchMembers`, `resolveMembers`), never by importing this module.

- `search(tenantId, text, { limit })` matches the account e-mail and the profile name (display name, name, given + family name in either
  order), case-insensitive with LIKE wildcards literal, at most 25. With `match: 'name'` the e-mail is not matched (and
  without `user_profile` nobody matches). `resolve(tenantId, userIds)` takes at most 200 ids (non-uuids dropped).
- Only the tenant's **ACTIVE**, not deleted members whose account still exists, read through the tenant repository with
  `tenantId` in the query: never another tenant's people, never an invited, suspended or removed member.
- The name is the profile's (same rule as the peer view's `displayName`). `user_profile` is an **optional** dependency, read through
  `ifActive`: while it is off for the tenant a member has no name and a search matches e-mails only.
- The answer carries e-mails, so consumers show it only behind an admin-level permission. Contributing is not depending (EXT-14):
  tenant_member does not list its consumers, and they do not list tenant_member.

## Dependencies

- `session_end` — `recordSessionEndInTx` (the in-transaction session-ending orders, D249)
- `db` — system + per-tenant DataSources (`getDataSource`, `tenantDataSourceFor`)
- `tenant`, `user` — tenants joined and users hydrated into member rows
- `user_profile` (optional) — profile names for the `common:member_lookup` contribution, only while active for the tenant
- `redis` — busts the `tenant:member:<userId>:<tenantId>` cache on update
- `webhook` — dispatches `member.created/updated/deleted` to the tenant's subscribers
- `tenant_subscription` — `MAX_MEMBERS` feature gate enforced on the add-member route

## Shared rank and label helpers

- `@kuraykaraaslan-labs/tenant_member/server/tenant_member.rank` — pure, DB-free: `ROLE_RANK`, `assignableRoles(callerRole)`
  (strictly below the caller, never `OWNER`: ownership moves only through transfer-ownership) and
  `mayActOn(callerRole, targetRole, isSelf)`. The routes and the UI use the same rule, so the UI never offers what the
  server refuses (41-ui-fixes 05-tenant-member 2.1).
- `@kuraykaraaslan-labs/tenant_member/ui/tenant_member.labels` — translated member role and status labels for every
  surface (list, detail, access control, report, widget), with the raw value only for an unknown one.
- Group assignment goes through `PUT /members/[id]` with `roleKeys`; an update that changes nothing writes nothing and
  does not bump `sessionVersion`. Members who do not manage members get an allow-listed projection from the list and
  detail routes (no global user fields, no suspension or SCIM data).

