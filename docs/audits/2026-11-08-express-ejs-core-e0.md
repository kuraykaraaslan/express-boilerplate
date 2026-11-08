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

## Findings

1. **Heaviest next-coupled modules** (need real adapters, not just the shim): `auth_abac` (10 files, 11 adapters), `dashboard` (21), `observability` (12), `common` (7), `tenant_session` (4), `user_session` (4), `tenant_setting` (3).
2. **Biggest route surfaces:** `observability` 146, `dashboard` 62, `auth` 32. These land in E3 and are the riskiest for endpoint parity.
3. **Every core module's `requires` stays inside core** (the dependency check found no module that needs a non-core module), so core can ship alone.
4. **Pages:** 123 NB pages. Observability (18), auth (13), dashboard (7), auth_abac (6) are the largest groups. The kui-ejs gap list per page is the next step (E0b).
5. **kui-ejs today** has the app shell and generic partials plus `domain/{common, api-doc, invoice, modem, ups, scada}`; theme views for auth, user, notification, payment, subscription exist as showcase pages, but no real account/tenant/org/approval/audit/webhook pages.

## Next

E1 first deliverable: the dispatcher + shim, proven on `auth/login` and `me/profile`.

E0b: per page, list the kui-react components used and mark each as present or missing in kui-ejs (and in kui-react).
