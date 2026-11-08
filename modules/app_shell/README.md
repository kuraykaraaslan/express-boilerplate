# app_shell — the persistent admin chrome

## Why this is a module and not part of `common`

The shell — sidebar, top bar, workspace switcher, the header widget row — used
to live in `common`, which meant the dependency-free primitives leaf
transitively dragged `notification_inapp`, `tenant_branding`, `telephony` and
`user` into every bundle that wanted a `Button`. MIS-02 extracted it: `common`
keeps the dumb pieces (Drawer, Badge, NotificationMenu, ThemeToggle), and this
module is the one place allowed to compose them with real domain data.

The rule that keeps the boundary honest:

> **`app_shell` composes; it owns nothing it shows.** Every widget in the
> header and every item in the sidebar belongs to another module. If a data
> fetch or a domain component appears here that no other module exports, the
> extraction has failed in reverse.

It is UI-only — **no server directory, no entities, no routes, no settings, no
permissions, no cache, no audit or webhook events**. It is also `PROTECTED` in
the registry's ambient set: the shell is always on and cannot be disabled per
tenant, because it is the thing that renders the enable/disable UI itself.

## What is in the box

| File | What it is |
|---|---|
| `app-shell.component.tsx` | The generic frame: desktop sidebar, sticky top bar, `main#main-content`, and a mobile drawer behind a hamburger. Knows nothing about tenants. |
| `app-sidebar.component.tsx` | kui-react's `AppSidebar` with this repo's i18n, `next/link` and import paths (change it in kui-react first): grouped nav, collapsible groups, icon-only collapse (desktop only), a search filter (`searchable`, on by default), count or node badges, header/footer slots that receive `{ collapsed }`. |
| `app-top-bar.component.tsx` | A flex row. Deliberately nothing more. |
| `admin-shell.component.tsx` | The composed product: branding, nav, workspace switcher and the header widget cluster, wired to their owner modules. |
| `admin-shell.hooks.ts` | `useAdminShellUser` — current user's email/name from `/api/auth/session` + `/api/auth/me/profile`. |
| `admin-shell.nav.helpers.tsx` | Nav-group construction and active-item resolution (pure-ish, tested). |
| `workspaces.config.ts` | The workspace catalog: 23 workspaces + a synthetic "More" catch-all, display metadata only. |
| `shell-profile.ts` | The overrides over the defaults (rename, hide, regroup, reorder, group order, single workspace, custom links) the shell applies; since docs/phases/54-menu-editor they come from the menu published in Platform → Menu ([shell_menu](../shell_menu/README.md)), resolved per viewer by the admin layout. |
| `workspace.context.tsx` | `WorkspaceProvider` / `useWorkspace` — the shared active-workspace state. |
| `workspace-switcher.component.tsx` | The dropdown that changes it. Portal-rendered; icon-only when the sidebar is collapsed. |
| `font-awesome-config.component.tsx` | Sets `autoAddCss = false` once, in the root layout. |

Mounted from exactly two layouts: `app/layout.tsx` (FontAwesomeConfig) and the
admin catch-all layout (`WorkspaceProvider` + `AdminShell`). One page outside
the module consumes `useWorkspace`: `common`'s admin dashboard, which renders
the active workspace's widgets and re-renders when the switcher changes.

## The sidebar is registry-driven

`buildAdminNavGroups` hardcodes only what activation can never gate: Overview
(Dashboard), Account (My Profile), and — for the root tenant — Platform System
(Health, Fleet). Everything else comes from `moduleRegistry.getMenuItems`:
each enabled module's manifest-declared menu items, deduped by href, grouped
by their manifest `group`, and sorted into `GROUP_ORDER`'s canonical section
order. Disabling a module drops its items; there is no per-module nav code in
the shell.

Two shapes ride on every item, and the distinction is load-bearing:
`appHref` is the tenant-relative path (`/admin/me`) and `href` is what gets
rendered, which depends on the tenancy mode. **Matching runs on `appHref`**:
`resolveActiveNavId` normalizes `usePathname()` through `splitTenantBase` so
domain mode (`/admin/x`), path mode (`/t/{id}/admin/x`) and stale
`/tenant/{id}` links all resolve the same item — the longest match wins, so
the Dashboard (a prefix of everything) only lights on the index. This is the
one mismatch that fails *silently* (nothing highlights), which is why it is
the thing the module's only test file guards.

Group labels are **identity keys** — they are matched against `GROUP_ORDER`,
`GROUP_WORKSPACE`, `ALWAYS_ON_GROUPS` and manifest `group` strings, always in
English. Only the text shown is translated:

| Shown | Key | Helper (`workspaces.config.ts`) |
|---|---|---|
| a menu item | `<module>.menu.<item id>` (the item's own module) | the nav helper |
| a group heading (sidebar, dashboard launcher) | `app_shell.group.<slug>`, `Platform System` → `platform-system` | `groupLabel(group, t)` |
| a workspace name (switcher, dashboard titles) | `app_shell.workspace.<id>` | `workspaceLabel(w, t)` |

The keys live in this module's `dictionaries/` (always sent to the admin, the
module being protected). `scripts/i18n/extract.mjs` writes the workspace keys
from the anchor list in `workspaces.config.ts` and a group key for every menu
`group` any manifest declares; `--menus` adds the missing ones only. A test
checks that every catalogued workspace and every manifest group has an English
and a Turkish entry.

## Workspaces

Eighty-plus modules in one flat menu is unusable, so sidebar groups roll up
into switchable workspaces (the Odoo app-launcher model, bundle-aligned —
see phases/monetization/4.md). The moving parts:

- A menu item's workspace: explicit manifest `workspace` field, else the
  `GROUP_WORKSPACE` label map (for items predating the field), else "More" —
  nothing is ever hidden for lack of an assignment.
- A workspace with no enabled menu items does not appear in the switcher; one
  workspace (or zero) shows no switcher at all. Overview and Account are
  pinned into every workspace via `ALWAYS_ON_GROUPS`.
- The choice persists in localStorage (`admin:workspace:root|tenant`) and
  resolves post-mount only: stored choice → the workspace owning the current
  route → first available. Until then `activeWorkspaceId` is `undefined` and
  **all** groups render, so SSR and the first client paint agree — the
  hydration guard is the reason the value is allowed to be undefined.
- `useWorkspace` outside a provider returns an inert default instead of
  throwing.
- A group is one label in one workspace: two workspaces may each have a
  `Configuration`, and an item joins the one of its own workspace. While one
  workspace is shown, a group heading that only repeats the workspace's name
  (the IoT group in IoT) is dropped (`dropRepeatedGroupHeadings`).

The default order (docs/phases/45-install-config D45-6): **Home** (Dashboards,
My tasks, My approvals, My tickets, My contact methods, the My HR items),
**IoT**, **Automation**, the business workspaces (Content … Partner), then
**Organisation** (members, invitations, domains, plan and billing, branding,
settings, tags, imports, agreements and consent, documents), **Platform** (the
system-scope items and the fleet), **Monitoring** (observability, on-call) and
**System** (AI, insights, security, configuration).

## Customizing per application

> **2026-11-01 (docs/phases/54-menu-editor):** `app/shell.profile.ts` and `config/menu.ts` are not read any more; the menu is set in Platform → Menu ([shell_menu](../shell_menu/README.md)) and reaches the shell as the same profile shape. The paragraph below describes phase 45.

`app/shell.profile.ts` is the application's own file (empty by default): per-item and per-group rename, hide, move and reorder, new, renamed
or hidden workspaces, or `workspaces: 'single'`. The installation's `config/menu.ts` (docs/phases/45-install-config D45-3) lays more layers over
it: one for every role, one per role (sysadmin, owner, admin, user) and one per custom group. `resolveRoleShellProfile` merges them field by
field for the viewer, the layout passes the result to `WorkspaceProvider`, which shares it with the sidebar, and `checkMenuNames` refuses a
workspace no layer defines (the app's `app/install-config.check.ts` runs it at boot and in `npm run config:check`). A profile is applied after
the registry's activation and permission filtering, so it can never reveal an item, and it has no permission field: who may open a page is
`config/access.ts` and the admin page guard. A hidden workspace drops its items with it. Group labels stay identity keys everywhere in the shell;
a profile renames them for display last (`applyGroupLabels`). `PageAccessRecovery` is what the admin page guard renders when it could not work
out the viewer's session: one session check (which refreshes an expired token) and a server re-render. Full guide: `docs/guides/install-config.md`.

## What it deliberately does not own

| Shown in the shell | Owner | What app_shell does |
|---|---|---|
| Notification bell data | `notification_inapp` (`useNotifications`) | passes items into `common`'s dumb `NotificationMenu` |
| Brand name, logos, custom CSS/JS | `tenant_branding` | reads the hook, falls back to a shield glyph until configured |
| User menu, profile/logout | `user` | renders `UserMenu` (kui-react's, in a portal) with My Profile and Sign out hrefs it computes via `tenantPath`; the built-in Settings item is hidden. `extraItems` would carry contributed items once a user-menu point exists |
| The telephone | `telephony` | mounts provider + widget — in the **layout**, so a call survives navigation and there is exactly one phone per seat |
| Language switcher | `localization` | renders it with languages the RSC layout already resolved; the shell does not filter |
| Theme toggle, Drawer, Badge, icon map, module-registry | `common` | imports them |
| Menu item definitions | every module's `module.json` | merges and sorts them |
| Module enable/disable state | `common`'s ModuleEnabled context (fed by `tenant_setting` activation) | consumes the set, never writes it |
| Authorization | `auth_abac` + page/route guards | none of its own — the layout resolves which of the items' declared `permissions[]` the caller holds and the registry drops the rest. An item that declares no `permissions[]` shows to every member of a tenant whose module is enabled (`npm run check:menu-permissions` keeps that list accepted on purpose) |
| Skip-to-content link | the root layout | targets this shell's `main#main-content` |

Declared `requires`: `common`, `notification_inapp`, `telephony`,
`tenant_branding`, `user`. The `i18n`, `localization` and `tenant` imports are
undeclared on purpose — all three sit in the registry's ambient set, where
edges are not counted.

## Known gaps

- **No dictionaries of its own.** Every string still uses `common.*` keys
  living in `modules/common/dictionaries` — a leftover of the MIS-02
  extraction that a rename has not yet followed.
- **The hardcoded base groups are a cutover, not a design.** (A profile can rename or hide Dashboard and My Profile, not move them.) They stay until
  every module's menu is seeded into manifests; the code says so itself.
- **Two lists must be kept in sync by hand:** `GROUP_WORKSPACE` with the
  `workspace` values seeded into manifests, and `ROOT_HARDCODED_GROUPS` in
  `workspace.context.tsx` with the hardcoded groups in the component.
- `useAdminShellUser` swallows fetch errors — an expired session shows a
  shell with no user menu rather than any signal.
- Only the nav helpers are tested; the workspace resolution order
  (stored → route owner → first) has no test.
