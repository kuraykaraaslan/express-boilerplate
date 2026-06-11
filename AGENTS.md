# AGENTS.md — AI Agent Orientation Guide

> **Read this first.** This file is the AI-readable map of the entire project: what lives where, what the rules are, and which file to open for any given task. It is the canonical entry point for any AI coding assistant (Claude Code, Cursor, Copilot, Aider, OpenCode, etc.) working in this repo.

## 0. Machine-readable catalog + MCP server

Before grepping or guessing — fetch the catalog. Static snapshots live under `public/` (rebuild with `npm run registry:snapshot`):

| Surface | Path | What's in it |
|---|---|---|
| Full registry | [`public/registry/registry.json`](public/registry/registry.json) | Modules + routes + entities + middlewares + conventions |
| Slim index | [`public/registry/registry.index.json`](public/registry/registry.index.json) | Same shape, no inlined READMEs |
| Modules | [`public/registry/modules.json`](public/registry/modules.json) | ~43 modules with dependencies, exports, READMEs |
| Routes | [`public/registry/routes.json`](public/registry/routes.json) | All Express routes (scope, method, urlPath, owning module) |
| Entities | [`public/registry/entities.json`](public/registry/entities.json) | TypeORM entities (columns, relations, schema) |
| Middlewares | [`public/registry/components.json`](public/registry/components.json) | `modules_express/` surface entries |
| Per-module | `public/modules/<id>.md` | One markdown file per module — README + dependency map + owned routes/entities/middleware |
| Module index | [`public/modules/_index.json`](public/modules/_index.json) | `{ id → { tier, hasExpressLayer, routeCount, … } }` |
| Schema | [`public/schemas/registry-v1.json`](public/schemas/registry-v1.json) | JSON Schema for the registry shape |
| llms.txt | [`public/llms.txt`](public/llms.txt) | llms.txt-convention summary for AI agents |

**MCP server** in [`.mcp.json`](.mcp.json) (script: [`scripts/mcp-server.mjs`](scripts/mcp-server.mjs)). Tools: `list_modules`, `get_module`, `search_modules`, `list_routes`, `search_routes`, `list_entities`, `get_entity`, `list_middlewares`, `get_conventions`, `get_module_readme`, `read_file`. Zero-dependency, stdio JSON-RPC, works with Claude Desktop / Cursor / Cline / Windsurf / Zed.

**Editor-native rule mirrors** of this file: [`.cursor/rules/express-boilerplate.mdc`](.cursor/rules/express-boilerplate.mdc), [`.cursorrules`](.cursorrules), [`.windsurfrules`](.windsurfrules), [`.github/copilot-instructions.md`](.github/copilot-instructions.md), [`.clinerules`](.clinerules).

> ⚠️ **Keep the catalog in sync (REQUIRED).** Any time you **add, rename, or remove** a module, router file, route handler, TypeORM entity, `modules_express/` middleware / service extension, provider, or BullMQ job, you **must** rebuild the catalog before committing:
>
> ```bash
> npm run registry:snapshot
> ```
>
> This regenerates `public/registry/*.json` and `public/modules/*.md` from filesystem state. The script also runs automatically via the `prebuild` npm hook before `npm run build`, but commit the regenerated files so the catalog stays in lockstep with the code. A stale catalog is worse than no catalog — it misleads every AI agent that reads it.

## 1. What this project is

A **production-grade, multi-tenant SaaS API boilerplate** built on Express 5 + TypeScript with a strict two-layer architecture (no React, no Next.js): framework-agnostic business logic in `modules/`, Express-specific bindings in `modules_express/`, and routes wired in `router/`. The module set mirrors the sister project [next-boilerplate](https://github.com/kuraykaraaslan/next-boilerplate) — the goal is full parity for any business-logic surface.

- **Framework**: Express 5 · TypeScript 5 (strict)
- **DB**: PostgreSQL (TypeORM, dual-schema: system + per-tenant) · **Cache/Queue**: Redis + BullMQ
- **Auth**: JWT (httpOnly cookies + Bearer), OTP, TOTP, SAML, OAuth (12+ providers), WebAuthn/Passkeys
- **Payments**: Stripe, PayPal, Iyzico · **Email**: 7 providers · **SMS**: 4 providers · **Storage**: 4 S3-compatible providers
- **Validation**: Zod · **Testing**: Jest + supertest

Tenancy modes: `domain` (subdomain per tenant) or `path` (`/t/{tenantId}/...`). Resolution + URL rewrite happens in [router/index.ts](router/index.ts) (the "proxy router").

## 2. Architecture: the two layers

```
router/  ──→  modules_express/  ──→  modules/
                                       ↑
                                 next-app/ (or any other runtime)
```

Strict **one-way dependency**:

| Layer | What lives here | Imports allowed |
|---|---|---|
| [modules/](modules/) | Framework-agnostic business logic — services, DTOs, entities, types, enums, messages. **No `express`, no `req`/`res`, no `next/*`, no `react`.** | Other `modules/*`, npm packages |
| [modules_express/](modules_express/) | Express binding layer — middlewares (`*.middleware.ts`), service extensions (`*.service.express.ts`) that touch `Request`/`Response`. | `modules/*` + Express |
| [router/](router/) | Express Router wiring — one file per scope/module. Each file builds a `Router()` and attaches `.get/.post/...` handlers. | All of the above |

**Rule**: `modules/` never imports from `modules_express/` or `router/`. Violations break the Next/CLI story and are caught in review.

## 3. Top-level discovery map

```
.
├── AGENTS.md                 ← you are here
├── README.md                 ← human-facing intro
├── SECURITY.md               ← security model & threat scenarios
├── index.ts                  ← Express app: helmet, cors, logger, limiter, mounts router
├── server.ts                 ← bootstraps TypeORM + listens on env.PORT
├── tsconfig.json             ← path alias: @/* → ./*
├── jest.config.ts            ← Jest config
├── eslint.config.mjs         ← lint rules
├── tsup.config.ts            ← bundle config
├── docker-compose.yml        ← local Postgres + Redis
├── Dockerfile                ← production image
├── global.d.ts               ← ambient TS types (e.g. req.user)
│
├── router/                   ← Express routing layer
│   ├── index.ts              ← proxy router: rewrites /system/* and /tenant/:tenantId/*
│   ├── system/               ← system-scope (super-admin, no tenant)
│   │   ├── index.ts          ← mounts each module's router under a path
│   │   └── <module>.ts       ← Router() with method handlers for that module
│   └── tenant/               ← tenant-scope (per-tenant)
│       ├── index.ts          ← mounts each module's router
│       └── <module>.ts       ← Router({ mergeParams: true }) with handlers
│
├── modules/                  ← framework-agnostic business logic (~43 modules)
│   ├── README.md             ← layer rules
│   ├── module.schema.json    ← JSON Schema for any module.json
│   └── <module>/             ← see §5 for module file conventions
│
├── modules_express/          ← Express binding layer
│   └── <module>/             ← *.middleware.ts and/or *.service.express.ts
│
├── scripts/                  ← one-off CLI / build scripts
│   ├── build-registry-snapshot.mjs  ← regenerates public/registry/*
│   ├── mcp-server.mjs                ← MCP server (stdio JSON-RPC)
│   ├── generate-favicon.js
│   ├── generate-og-image.js
│   └── sync-check.ts
│
└── public/                   ← static assets + AI catalog (registry + llms.txt + schemas)
```

## 4. Path alias

There is **one** alias configured in [tsconfig.json](tsconfig.json):

```
"@/*": ["./*"]
```

Everything is root-relative. Examples:

```ts
import { UserService } from "@/modules/user/user.service";
import AuthMiddleware from "@/modules_express/auth/auth.middleware";
import { errorHandler } from "@/modules_express/common/error-handler.middleware";
```

## 5. Module structure conventions

Every module under `modules/<name>/` is self-contained (only files that apply exist):

```
<module>/
├── README.md                          ← describes what the module does
├── <module>.service.ts                ← business logic (one or more)
├── <module>.service.test.ts           ← unit tests
├── <module>.dto.ts                    ← Zod schemas for input validation
├── <module>.types.ts                  ← TypeScript types
├── <module>.enums.ts                  ← enum constants
├── <module>.messages.ts               ← user-facing strings (errors, success)
├── <module>.setting.keys.ts           ← Zod enum of setting keys this module owns
├── entities/                          ← TypeORM @Entity classes
│   └── <name>.entity.ts
├── providers/                         ← pluggable backend implementations
│   └── <provider>.provider.ts         ← concrete impl (stripe, twilio, ses, …)
└── dictionaries/                      ← i18n strings for this module
    ├── en.json
    ├── tr.json
    └── es.json
```

Express extensions live in a parallel `modules_express/<name>/` directory:

```
<module>/
├── <module>.middleware.ts             ← Express middleware (req/res/next)
└── <module>.service.express.ts        ← Express-aware service extension
```

**File-naming convention**: dot-separated suffix tells you the file's role at a glance.

| Suffix | Role |
|---|---|
| `*.service.ts` | Business logic |
| `*.dto.ts` | Zod input schemas |
| `*.types.ts` | TS types |
| `*.enums.ts` | Enums |
| `*.messages.ts` | i18n / user-facing message keys |
| `*.setting.keys.ts` | Setting key Zod enum |
| `*.entity.ts` | TypeORM `@Entity` (under `entities/`) |
| `*.provider.ts` | Pluggable backend implementation |
| `*.job.ts` | BullMQ job processor |
| `*.middleware.ts` | (modules_express/ only) Express middleware |
| `*.service.express.ts` | (modules_express/ only) Express-aware extension |
| `*.test.ts` | Jest tests, colocated |

## 6. Routing: how a request reaches a handler

1. `index.ts` builds the Express app: helmet → CORS → `Logger.useLogger` → `Limiter.useLimiter` → `proxyRouter` → `errorHandler`.
2. `router/index.ts` is the proxy router:
   - Already-rewritten paths (`/system/*` or `/tenant/:tenantId/*`) pass through.
   - Otherwise it resolves the tenant from host or path and rewrites the URL.
   - Mounts `router.use("/system", systemRouter)` and `router.use("/tenant/:tenantId", tenantScopedRouter)`.
3. `router/system/index.ts` (or `router/tenant/index.ts`) mounts each module's router under a stable path (e.g. `/auth → authRouter`, `/users → userRouter`).
4. `router/<scope>/<module>.ts` builds a `Router()` (or `Router({ mergeParams: true })` for tenant) and attaches `.get/.post/.put/.patch/.delete` handlers.

A handler's full URL is therefore: `/<scope>(/:tenantId)/<mount>/<routerPath>`.

## 7. Where to find things — quick index

| I need to… | Open |
|---|---|
| understand the overall architecture | this file + [README.md](README.md) |
| read what a module does | `modules/<name>/README.md` |
| add a new API endpoint | `router/<scope>/<module>.ts` (and mount in `router/<scope>/index.ts`) |
| add a new business-logic module | `modules/<name>/` (see §10) |
| add Express middleware for a module | `modules_express/<name>/<name>.middleware.ts` |
| change tenant routing rules | [router/index.ts](router/index.ts) |
| change the DB schema | `modules/<name>/entities/*.entity.ts` |
| change setting keys | `modules/<name>/<name>.setting.keys.ts` |
| change i18n strings | `modules/<name>/dictionaries/*.json` |
| change email templates | [modules/notification_mail/templates/](modules/notification_mail/templates/) |
| add an OAuth provider | [modules/auth_sso/providers/](modules/auth_sso/providers/) |
| add a payment provider | [modules/payment/providers/](modules/payment/providers/) |
| add a storage provider | [modules/storage/providers/](modules/storage/providers/) |
| add a mail provider | [modules/notification_mail/providers/](modules/notification_mail/providers/) |
| add an SMS provider | [modules/notification_sms/providers/](modules/notification_sms/providers/) |
| see threat model & security defaults | [SECURITY.md](SECURITY.md) |

## 8. Where the most-imported infrastructure lives

These modules sit at the bottom of the dependency graph — almost everything uses them:

| Module | What it gives you | Typical import |
|---|---|---|
| [modules/db](modules/db/) | `SystemDataSource`, `tenantDataSourceFor(id)` | `import { SystemDataSource } from "@/modules/db/db.system";` |
| [modules/env](modules/env/) | Typed env-var access | `import { env } from "@/modules/env";` |
| [modules/logger](modules/logger/) | Winston logger (server-agnostic) | `import { logger } from "@/modules/logger";` |
| [modules/redis](modules/redis/) | Redis client + BullMQ connection | `import redis from "@/modules/redis";` |
| [modules/common](modules/common/) | `AppError` + `ErrorCode` enum | `import { AppError, ErrorCode } from "@/modules/common/app-error";` |
| [modules_express/auth](modules_express/auth/) | `AuthMiddleware(role)` factory | `import AuthMiddleware from "@/modules_express/auth/auth.middleware";` |
| [modules_express/limiter](modules_express/limiter/) | Rate-limit middleware | `import Limiter from "@/modules_express/limiter/limiter.service.express";` |

## 9. Multi-tenant scopes

- **System** (`/system/...`) — super-admin, no tenant context. Routes mounted via `router/system/`.
- **Tenant** (`/tenant/:tenantId/...`) — per-tenant. Routes mounted via `router/tenant/` with `Router({ mergeParams: true })` so `req.params.tenantId` is available.
- Per-tenant data lives in a per-tenant TypeORM `DataSource` via `modules/db`. **Never share a DataSource across scopes.**

## 10. How to add a new module

1. Create `modules/<id>/` with a `README.md` describing purpose, files, key concepts.
2. Implement `*.service.ts`, `*.dto.ts`, `*.types.ts`, `*.enums.ts`, `*.messages.ts` as needed.
3. Entities: `modules/<id>/entities/*.entity.ts` (register with `db/` if it needs a DataSource).
4. If it needs Express bindings: matching `modules_express/<id>/<id>.middleware.ts` and/or `<id>.service.express.ts`.
5. Add the router: `router/<scope>/<id>.ts` and mount in `router/<scope>/index.ts`.
6. Tests: `*.service.test.ts` colocated.
7. Rebuild the AI catalog: `npm run registry:snapshot`.

## 11. Don't

- Don't import `express`, `Request`, `Response`, or `next` from anywhere under `modules/`.
- Don't import from `modules_express/*` or `router/*` from `modules/*` (one-way only).
- Don't introduce new path aliases — `@/* → ./*` is the only one.
- Don't hand-roll a DataSource — go through `modules/db`.
- Don't inline user-facing strings in service code — add a message key to `*.messages.ts`.
- Don't use `console.*` in service code — use `logger`.
- Don't break tenant isolation — never reuse a system DataSource for tenant data.
- Don't put auth strategies outside the `modules/auth*` family — keep them grouped.
