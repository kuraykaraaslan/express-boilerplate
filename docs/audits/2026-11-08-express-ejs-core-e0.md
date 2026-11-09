# 2026-11-08 — Core modules to Express + kui-ejs: E0 gap analysis

Read-only analysis of the 58 `edition: core` modules in next-boilerplate (NB). Decisions D1–D5 (services copied from NB, `next/server` shim + generated router, express adapters, no non-core changes, no edition gating) are in the plan; the owner confirmed shared JWT httpOnly cookies and tables.

## Totals

| Item | Count |
|---|---|
| Core modules | 58 (30 already exist in express-boilerplate, 28 missing) |
| Route handlers to expose | 466 |
| Non-route server files importing `next*` | 85 (28 are `*.next.ts` adapters) |
| NB pages (`*.page.tsx`) | 123 |
| Modules with no server code | `app_shell`, `tour` (UI only), `automation_integrations` (contract only) |

## Shim surface (small)

Route handlers import only `next/server`. Usage across core: `NextResponse.json` (1015), `request.nextUrl.searchParams` (~60), `request.cookies.get` (23+11), `request.nextUrl.pathname` (7), `headers()`/`cookies()` from `next/headers` (7 each), `NextResponse.redirect`/`next` (1 each). The shim needs: `NextRequest` (extends web `Request`, adds `nextUrl`, `cookies`), `NextResponse` (`json`, `redirect`, `next`), `cookies()`, `headers()` via AsyncLocalStorage. Cheap.

## Per module (server files / routes / next-coupled non-route / adapters / pages)

| Module | Tier | In Express | Server | Routes | Coupled | Adapters | Pages |
|---|---|---|---|---|---|---|---|
| account | identity | N | 17 | 14 | 0 | 0 | 1 |
| ai_firewall | platform | N | 117 | 9 | 0 | 0 | 4 |
| announcement | notifications | N | 27 | 9 | 1 | 0 | 0 |
| api_key | platform | Y | 42 | 11 | 1 | 1 | 4 |
| app_shell | infrastructure | N | 0 | 0 | 0 | 0 | 0 |
| approval | platform | N | 34 | 6 | 0 | 0 | 5 |
| audit_log | platform | Y | 49 | 7 | 1 | 1 | 2 |
| auth | identity | Y | 80 | 32 | 3 | 2 | 13 |
| auth_abac | identity | N | 47 | 4 | 10 | 11 | 6 |
| automation_integrations | platform | N | 0 | 0 | 0 | 0 | 0 |
| common | infrastructure | Y | 431 | 0 | 7 | 1 | 0 |
| dashboard | platform | N | 221 | 62 | 21 | 0 | 7 |
| db | infrastructure | Y | 63 | 3 | 0 | 0 | 0 |
| env | infrastructure | Y | 8 | 0 | 0 | 0 | 0 |
| feature_gate | platform | N | 25 | 1 | 0 | 0 | 0 |
| fleet_protocol | infrastructure | N | 49 | 0 | 0 | 0 | 0 |
| i18n | infrastructure | N | 3 | 0 | 0 | 0 | 0 |
| ip_subnet | infrastructure | N | 7 | 0 | 0 | 0 | 0 |
| limiter | infrastructure | Y | 30 | 1 | 2 | 1 | 1 |
| localization | infrastructure | N | 10 | 0 | 0 | 0 | 0 |
| logger | infrastructure | Y | 4 | 0 | 0 | 0 | 0 |
| mcp_server | platform | N | 38 | 10 | 3 | 0 | 3 |
| module_lifecycle | platform | N | 38 | 11 | 0 | 0 | 3 |
| notification | platform | N | 10 | 0 | 0 | 0 | 0 |
| notification_inapp | notifications | Y | 9 | 1 | 0 | 0 | 1 |
| notification_log | notifications | N | 16 | 2 | 0 | 0 | 0 |
| notification_mail | notifications | Y | 19 | 0 | 0 | 0 | 2 |
| notification_push | notifications | Y | 25 | 3 | 0 | 0 | 1 |
| notification_sms | notifications | Y | 13 | 1 | 0 | 0 | 1 |
| observability | platform | N | 505 | 146 | 12 | 1 | 18 |
| organization | platform | N | 34 | 9 | 0 | 0 | 4 |
| plugin_local | platform | N | 21 | 7 | 1 | 0 | 2 |
| plugin_runtime | platform | N | 41 | 0 | 1 | 0 | 2 |
| process_host | infrastructure | N | 27 | 0 | 0 | 0 | 0 |
| redis | infrastructure | Y | 11 | 0 | 0 | 0 | 0 |
| redis_idempotency | infrastructure | Y | 9 | 0 | 1 | 0 | 1 |
| session_end | infrastructure | N | 9 | 1 | 0 | 0 | 0 |
| shell_menu | platform | N | 29 | 11 | 0 | 0 | 1 |
| storage | platform | Y | 54 | 7 | 2 | 0 | 1 |
| telemetry | platform | N | 72 | 4 | 0 | 0 | 2 |
| tenant | tenancy | Y | 64 | 13 | 3 | 0 | 4 |
| tenant_branding | tenancy | Y | 19 | 5 | 1 | 0 | 1 |
| tenant_domain | tenancy | Y | 80 | 16 | 3 | 0 | 5 |
| tenant_invitation | tenancy | Y | 30 | 9 | 1 | 0 | 5 |
| tenant_member | tenancy | Y | 49 | 11 | 0 | 0 | 5 |
| tenant_session | tenancy | Y | 18 | 0 | 4 | 4 | 1 |
| tenant_setting | platform | Y | 47 | 5 | 2 | 3 | 5 |
| tenant_usage | tenancy | Y | 27 | 3 | 0 | 0 | 2 |
| tour | platform | N | 0 | 0 | 0 | 0 | 0 |
| translation | platform | N | 24 | 6 | 0 | 0 | 1 |
| user | identity | Y | 36 | 13 | 1 | 0 | 2 |
| user_preferences | identity | Y | 10 | 0 | 0 | 0 | 1 |
| user_profile | identity | Y | 15 | 0 | 0 | 0 | 1 |
| user_security | identity | Y | 18 | 0 | 0 | 0 | 1 |
| user_session | identity | Y | 35 | 0 | 4 | 3 | 1 |
| user_social_account | identity | Y | 18 | 0 | 0 | 0 | 0 |
| webhook | platform | Y | 46 | 13 | 0 | 0 | 3 |
| websocket | infrastructure | N | 23 | 0 | 0 | 0 | 0 |

## Key finding: one dispatcher, not 466 routes

NB serves every module API through ONE catch-all (`app/tenant/[tenantId]/api/[...slug]/route.ts`). The path resolves through `moduleRegistry.findApiRoute` (from each `module.json` `apiRoutes`) to a verbatim handler in the generated `apiHandlers` map, after the CSRF gate, the module-enabled check and the tenant/observability contexts. Only 12 file routes exist outside it (cron, health, streaming). So the Express work is one dispatcher that reproduces this chain, fed by the same registry and generated handler map, plus the shim. This replaces the "generated router file per route" idea in the plan (D2 amended).

## Sync inputs (found while starting E1)

- Each NB `module.json` has `apiRoutes: [{ path, handler }]`, for example `/api/auth/me/profile` -> `account/server/me-profile.route`. The sync script reads these for the 58 core modules, so no route table has to be written by hand.
- NB handlers and services import each other as `@kuraykaraaslan-labs/<module>/server/<file>` (per-module `package.json` exports). Express must resolve the same specifiers (npm workspaces or tsconfig paths), otherwise copied files would need rewriting. Decision D6: resolve the same specifiers; never rewrite imports in copied files.
- NB's generated map lives at `modules/common/server/generated/api-handlers.ts` (1023 lines, all editions). Express needs its own generated map, limited to core handlers.

## Findings

1. **Heaviest next-coupled modules** (need real adapters, not just the shim): `auth_abac` (10 files, 11 adapters), `dashboard` (21), `observability` (12), `common` (7), `tenant_session` (4), `user_session` (4), `tenant_setting` (3).
2. **Biggest route surfaces:** `observability` 146, `dashboard` 62, `auth` 32. These land in E3 and are the riskiest for endpoint parity.
3. **Every core module's `requires` stays inside core** (the dependency check found no module that needs a non-core module), so core can ship alone.
4. **Pages:** 123 NB pages. Observability (18), auth (13), dashboard (7), auth_abac (6) are the largest groups. The kui-ejs gap list per page is the next step (E0b).
5. **kui-ejs today** has the app shell and generic partials plus `domain/{common, api-doc, invoice, modem, ups, scada}`; theme views for auth, user, notification, payment, subscription exist as showcase pages, but no real account/tenant/org/approval/audit/webhook pages.

## Next

E1 first deliverable: the dispatcher + shim, proven on `auth/login` and `me/profile`.

E0b: per page, list the kui-react components used and mark each as present or missing in kui-ejs (and in kui-react).

## E1 notes (2026-11-08)

Owner decisions: copy straight over (no workspaces, no package.json per module); no tests, no runtime started; fix first, push after.

- `@kuraykaraaslan-labs/<id>[/...]` resolves through one tsconfig wildcard path (`modules/*`, then `modules/*/server/index`); 16 package.json exports that rename a file (process_host `supervisor/*`, common `config`, ...) get explicit paths, written by the sync script. `next/server`, `next/headers` and `next` map to `shims/next/*`.
- The git-ignored generated registry in NB lists every module (the snapshot keeps protected modules and every entity). Core-only copy: export an enterprise copy of NB to a scratch folder, run the snapshot there with `NB_DISABLED_MODULES` = every non-core id and `new Set()` in place of PROTECTED at `build-registry-snapshot.mjs:107`, then pass that folder as `--generated`. Result: 58 modules, 467 API routes, no import of a non-core module. `db.entities.generated.ts` is filtered to core entities by the sync script (480 dropped).
- NB finding: a Core export does not pass its own snapshot (`plugin_runtime` page route `/admin/plugins/[listingId]` names permission `marketplace.plugins.invoke`, which only a non-core module declares).
- Server files import some `ui/` files (shell_menu -> app_shell/ui/shell-profile, common/ui/icon-map, tenant_branding hook); the sync script pulls those 11 in by import closure.
- 18 npm packages the core server code imports were missing in Express (socket.io, yaml, prom-client, isolated-vm, jspdf, ...); added to package.json at NB's versions, `npm install` is the owner's step.
- Replaced: `router/*`, `modules_express/*` and `server.ts` (they imported the old module layout) by `router/dispatch.ts` (the NB catch-all, ported), `boot.ts` (NB instrumentation) and `index.ts`.
- Not yet done: a type check, any run. Non-core Express modules (payment, coupon, auth_saml, ...) still import the old layout and do not compile until they are ported or removed. NB's 12 file routes (health, cron, streaming) are not mounted.

## E0b: pages and components (2026-11-08)

Method: for each of the 123 core `*.page.tsx`, the components it imports from `common/ui` (the generic kit, taken from kui-react) and from module-owned `ui/` folders. Generic names were matched against kui-ejs partials by name; types (DataTable*, PageHeaderAction, DateRange, FieldSchema, TreeNode, TreeMoveTarget) are not components and were ignored.

| Result | Count |
|---|---|
| Pages | 123 |
| Generic component uses | 544 |
| Generic components with no kui-ejs partial | 5 (below) |
| Module-owned components (forms, panels, tables) | 202 distinct, 276 uses |

**Generic gaps in kui-ejs** (build in kui-react first where absent there, per the design rule):

| Component | Used by | In kui-react | In kui-ejs | Action |
|---|---|---|---|---|
| SchemaForm | 1 page | yes (`modules/app/SchemaForm`) | no | port to kui-ejs |
| LineChart | 1 page | not found by name | `Chart`, `DayBarChart` exist; check coverage | verify, then port or reuse |
| AvatarUpload | 1 page | not found | `Avatar` only | build in kui-react, then kui-ejs |
| ModuleIcon | 1 page | not found | no | build in kui-react, then kui-ejs (small) |
| EntityPanels | 1 page | not found | no | build in kui-react, then kui-ejs |

The generic kit is therefore almost complete in kui-ejs. The real work is the 202 module-owned components (for example `UserProfileForm`, `ActiveSessionsPanel`, `TrustedDevicesTable`): each needs an EJS partial plus a small client script that calls the module API through the dispatcher.

| Module | Pages | Generic uses | Module-owned components |
|---|---|---|---|
| account | 1 | 6 | 11 |
| ai_firewall | 4 | 35 | 12 |
| api_key | 4 | 31 | 6 |
| approval | 5 | 27 | 8 |
| audit_log | 2 | 7 | 5 |
| auth | 13 | 46 | 14 |
| auth_abac | 6 | 27 | 5 |
| dashboard | 7 | 30 | 12 |
| limiter | 1 | 0 | 1 |
| mcp_server | 3 | 11 | 1 |
| module_lifecycle | 3 | 4 | 3 |
| notification_inapp | 1 | 0 | 1 |
| notification_mail | 2 | 0 | 3 |
| notification_push | 1 | 0 | 1 |
| notification_sms | 1 | 0 | 2 |
| observability | 18 | 96 | 52 |
| organization | 4 | 30 | 2 |
| plugin_local | 2 | 0 | 2 |
| plugin_runtime | 2 | 1 | 2 |
| redis_idempotency | 1 | 0 | 1 |
| shell_menu | 1 | 11 | 18 |
| storage | 1 | 0 | 2 |
| telemetry | 2 | 6 | 1 |
| tenant | 4 | 23 | 12 |
| tenant_branding | 1 | 8 | 2 |
| tenant_domain | 5 | 45 | 5 |
| tenant_invitation | 5 | 22 | 4 |
| tenant_member | 5 | 31 | 10 |
| tenant_session | 1 | 0 | 2 |
| tenant_setting | 5 | 6 | 5 |
| tenant_usage | 2 | 1 | 2 |
| translation | 1 | 6 | 5 |
| user | 2 | 19 | 8 |
| user_preferences | 1 | 0 | 1 |
| user_profile | 1 | 0 | 1 |
| user_security | 1 | 0 | 1 |
| user_session | 1 | 0 | 1 |
| webhook | 3 | 15 | 9 |

Build order for E5: auth (13 pages, login first), account, tenant and members, then the platform modules by page count (observability 18 last, it is the largest).

## E5 start: pages (2026-11-08)

- `kui/` is the vendored kui-ejs view layer (`scripts/sync-kui-ejs.mjs`; partials keep their relative layout, so `kui/modules` and `kui/views` stay siblings). Express's own pages live in `views/`, routes in `pages/`, hand-written browser scripts in `public/js/`.
- The browser uses NB's own API client: `client/api.ts` is bundled by `scripts/build-client.mjs` (esbuild, tsconfig paths) into `public/js/kui-api.js` (`window.Kui`: `api` with CSRF mint/replay and refresh queue, `tenantPath`, `authErrorText`). The server injects `window.__TENANCY__` as NB's `<TenancyScript/>` does.
- First page: `/auth/login` (also `/tenant/{id}/auth/login`, `/t/{id}/auth/login`). Ported: password sign-in, SSO and ACS provider lists, safe redirect, account-only redirect, must-change-password, session-ended and SSO-error banners, sign-up link when registration is open.
- Not ported yet on login: tenant branding (name, logos, sign-in title); the `auth.login.methods` slot (passkey, e-signature); translations (English literals only).
- Build steps the owner runs after `npm install`: `npm run build:css`, `npm run build:client`. Nothing here has been rendered or run.

## E5 auth pages (2026-11-08)

All auth pages of the `auth` module are in except `auth-settings`: login, forgot-password, reset-password, register, change-password, select-tenant, verify-email, logout, callback, complete-profile, onboarding, create-tenant. Same pattern each time: a view in `views/auth/` on kui partials, a hand-written script in `public/js/` on `window.Kui`, one line in the `pages` list of `pages/auth.pages.ts`.

- Shared browser helpers: `public/js/auth-ui.js` (banner, per-field errors, busy state, error-text reader with an English stub for `t`) and `public/js/otp-step.js` (the one-time-code step, a port of `LoginOtpStep`; used by login, callback and complete-profile, with `switchTenantPath` addressing on the callback).
- `window.Kui` now also exposes `switchTenantPath`, `splitTenantBase`, `tenancyMode`, `isRootTenant`, `tenantLabelProblem`, `authErrorCodes`, `isRateLimited`.
- Gotcha found while writing them: kui-ejs `Button` escapes `children` (`<%= %>`), so markup cannot go through it; `hidden` must not share an element with `flex`/`inline-flex` (the winner depends on stylesheet order), so toggled blocks wrap their flex content in a plain `hidden` div.
- Nothing here has been rendered or run (owner instruction).

### E5 admin shell and generic settings page (2026-11-08, built)

- `pages/admin.pages.ts` is the port of NB's `admin/(shell)/layout.tsx` plus its catch-all page, as ONE Express route (`/admin{/*rest}`, `/tenant/:id/admin…`, `/{prefix}/:id/admin…`): the session gate (`authenticateTenantPage`, outsiders go to the picker), `getEnabledModuleIds`, the page lookup `moduleRegistry.findPageRoute` + enabled check + placement, the page guard (`pages/admin.viewer.ts`, port of `_access.ts`), the viewer's menu (`getMenuItems` filtered by `grantedPermissions`, failing closed to the ungated items), then the content from `pages/admin.registry.ts`. It runs inside `requestContext.run(request, …)` and `runWithTenant`, so the copied guard files (`*.next.ts`) see their `headers()`/`cookies()`.
- Layout `views/layouts/admin.ejs` draws kui-ejs `AppShell` + `AppSidebar` (the menu items' Font Awesome icon names become `<i class="fa-solid fa-…">`).
- `pages/admin.registry.ts` maps a route's `componentId` to a view. A component with no Express page yet gets `admin/not-ported` that names it, so no menu entry leads to a blank page.
- Settings: `scripts/gen-settings-pages.mjs` reads NB's `ModuleSettingsPage` pages and writes `pages/settings.manifest.ts` (25 core pages: title, subtitle, crumb, the module's `SettingFieldDef[]`, imported from the copied `server/*.settings.fields.ts`). `views/admin/module-settings.ejs` draws the form from it and `public/js/module-settings.js` is the port of `ModuleSettingsPage` (load from `/api/admin-settings`, patch only changed keys, secrets masked with Clear, pending-approval and skipped keys, field errors, platform-provided keys hidden). Skipped by the generator: `dashboard` and `organization` settings (fields not resolvable by the scan). With extras NB wraps around the form (only the form is served): `api_key` (scope-definitions tab), `tenant_member` (owner-only lock).
- Not ported in the shell: the viewer-profile menu (`shell_menu` published spec), i18n (English literals), tenant theme CSS, workspace switcher, slots, contribution-failure banner, `checkInstallConfig`.

### Where the page layer stands

124 page routes in the 58 core modules: 13 auth pages + 25 settings pages + account `/admin/me` + audit log list + member list + API key list done (42), 82 left. Left by module: observability 18, dashboard 7, tenant_invitation 5, auth_abac 5, tenant_setting 4, tenant_member 3, tenant_domain 4, organization 4, approval 4, tenant 3, api_key 2, ai_firewall 3, webhook 2, user 2, plugin_local 2, notification_mail 2, module_lifecycle 2, mcp_server 2, and 1 each for translation, tenant_usage, tenant_session, tenant_branding, telemetry, storage, shell_menu, plugin_runtime, notification_sms.
- Account `/admin/me` built (`views/admin/account-me.ejs` + `views/admin/account/_{profile,security,preferences,connected}.ejs`, `public/js/account-me.js`, a branch in `pages/admin.registry.ts`): profile (avatar upload to `/api/storage`, name, bio, only changed fields sent), security overview, active sessions, trusted devices, preferences (server-drawn selects, tenant's enabled languages), connected accounts (link, unlink inside a ConfirmDialog action, `?linked=` / `?linkError=`). The three lists are a small client-built table in the kui plain-table look (sort, name filter on devices); kui `DataTable` is server-rendered, so a client-fed table is a kui-ejs gap to close in kui-react first.
- Account gaps: the `user.profile.tabs` slot (passkeys, signing certificates) is not drawn; no pagination on the lists; the theme preference is saved but not applied (the shell has no theme cookie yet); the language preference writes `app_locale` but the shell is English only.
- List engine (`public/js/data-list.js`, `views/admin/data-list.ejs`, `pages/admin.lists.ts`): the browser half of `<DataTable mode="server" {...useListFetcher(url)}>`, same phase-43 query contract (page, pageSize, search, `sort=key:dir`, CSV list filters, `<id>From/To` ranges). A list page is a spec in `admin.lists.ts` (title, header links, optional drawer and dialogs partial) plus a script in `public/js/lists/`. Done on it: audit log (drawer, CSV export following the date filter, root tenant filter), members (invite, edit, remove, rank rule, step-up), API keys (create with the permission picker, one-time reveal, activate switch, revoke, scope-review banner). The permission picker (`public/js/permission-picker.js`) is reusable for the key detail page.
- Step-up (`public/js/step-up.js`): `KuiStepUp.run(tenantId, call)` is the port of `useStepUp`; the passkey/TOTP question runs inside the kui ConfirmDialog (`input`, `secondaryLabel`, `action`). It needs `withStepUp`, `isStepUpCancelled` and `startAuthentication` in the client bundle: `client/api.ts` exports them and `package.json` gained `@simplewebauthn/browser`, so `npm install` and `npm run build:client` are needed before it works.
- List gaps: the header buttons that NB gates by capability (webhooks, api keys) are not built yet; the member list has no `members.drawers` slot (Invitations drawer); filters are plain controls, not kui's filter panel; the table is client-built (kui `DataTable` is server-rendered), a kui-ejs gap to close in kui-react first.
- Next in order: the remaining list pages on the engine (api_key, webhook, user, tenant, domains, invitations, approvals, organization), each with its create and detail pages.
- Each remaining page needs its module's own components as EJS partials plus a hand-written script (the 202 module-owned components in the E0b table). No generator covers them: they are read and ported one by one.
