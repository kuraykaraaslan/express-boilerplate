# Express Boilerplate

![express](/public/logo.png)

A production-ready, multi-tenant SaaS API boilerplate built with Express.js and TypeScript. Follows Domain-Driven Design (DDD) with a modular architecture that mirrors the [next-boilerplate](https://github.com/kuraykaraaslan/next-boilerplate) project.

## Features

- **Multi-tenancy**: Full tenant isolation with per-tenant settings, branding, domains, members, and subscriptions
- **DDD Modules**: 35+ self-contained domain modules under `modules/`, each with service, DTO, types, and entities
- **Express Adapters**: Express-specific middlewares and services under `modules_express/`
- **Authentication**: JWT sessions, OTP, TOTP (2FA), passkeys (WebAuthn), SSO (OAuth), SAML, and impersonation
- **Authorization**: Session middleware, tenant-member role checks, API key authentication
- **Notifications**: Mail (Nodemailer / SendGrid), SMS (Twilio), push (Web Push), in-app notifications
- **Payments**: Payment processing with webhook support and coupon/discount system
- **Storage**: S3-compatible file storage
- **Caching & Queues**: Redis with BullMQ for background jobs and idempotency
- **Audit Logging**: Structured audit trail for all critical operations
- **Rate Limiting**: Per-tenant plan-aware rate limiting
- **API Documentation**: Built-in API doc module
- **Webhooks**: Outbound webhook system for external integrations
- **Docker**: Docker and docker-compose support
- **TypeScript**: Strict typing throughout the codebase
- **Testing**: Jest with supertest

## Table of Contents

- [Project Structure](#project-structure)
- [Modules](#modules)
- [Installation](#installation)
- [Usage](#usage)
- [API Routes](#api-routes)
- [Development](#development)
- [Dependencies](#dependencies)
- [License](#license)
- [Support](#support)

## Project Structure

```
express-boilerplate/
├── modules/                    # Domain modules (framework-agnostic)
│   ├── ai/                     # AI provider integration
│   ├── api_doc/                # API documentation
│   ├── api_key/                # API key management
│   ├── audit_log/              # Audit logging
│   ├── auth/                   # Core authentication (JWT, OTP, TOTP, password)
│   ├── auth_impersonation/     # Admin user impersonation
│   ├── auth_saml/              # SAML SSO
│   ├── auth_sso/               # OAuth / social SSO
│   ├── common/                 # Shared utilities (AppError)
│   ├── coupon/                 # Coupon & discount codes
│   ├── db/                     # Prisma system & tenant DB clients
│   ├── env/                    # Environment variable service
│   ├── limiter/                # Rate limiting (plan-aware)
│   ├── logger/                 # Winston logger
│   ├── notification_inapp/     # In-app notifications
│   ├── notification_mail/      # Email notifications
│   ├── notification_push/      # Web push notifications
│   ├── notification_sms/       # SMS notifications (Twilio)
│   ├── payment/                # Payment processing & webhooks
│   ├── redis/                  # Redis client + BullMQ
│   ├── redis_idempotency/      # Idempotency key management
│   ├── setting/                # Key-value settings store
│   ├── storage/                # S3-compatible file storage
│   ├── tenant/                 # Tenant CRUD & lifecycle
│   ├── tenant_branding/        # Tenant branding settings
│   ├── tenant_domain/          # Custom domains & DNS verification
│   ├── tenant_export/          # Tenant data export
│   ├── tenant_invitation/      # Tenant member invitations
│   ├── tenant_member/          # Tenant membership & roles
│   ├── tenant_session/         # Tenant-scoped sessions
│   ├── tenant_setting/         # Tenant configuration
│   ├── tenant_subscription/    # Subscription plans & billing
│   ├── tenant_usage/           # Tenant usage tracking
│   ├── user/                   # User CRUD
│   ├── user_agent/             # Device & browser tracking
│   ├── user_preferences/       # User preferences
│   ├── user_profile/           # User profile
│   ├── user_security/          # Security settings & passkeys
│   ├── user_session/           # Session tokens & cache
│   ├── user_social_account/    # Social account linking
│   └── webhook/                # Outbound webhooks
│
├── modules_express/            # Express adapters (middlewares & express services)
│   ├── auth/                   # Auth middleware
│   ├── common/                 # Error handler middleware
│   ├── limiter/                # Rate limiter express adapter
│   ├── logger/                 # Morgan/Winston express adapter
│   ├── tenant_member/          # Tenant member middleware
│   ├── tenant_session/         # Tenant session express service
│   └── user_session/           # User session express service
│
├── router/                     # Express route definitions
│   ├── system/                 # System-level routes (/api/system/*)
│   └── tenant/                 # Tenant-scoped routes (/api/tenant/*)
│
├── scripts/                    # Utility scripts
├── public/                     # Static assets
├── server.ts                   # Express app setup
├── index.ts                    # Entry point
├── Dockerfile
└── docker-compose.yml
```

Each module under `modules/` follows a consistent file convention:

```
modules/<name>/
├── <name>.service.ts           # Business logic
├── <name>.dto.ts               # Request/response DTOs
├── <name>.types.ts             # TypeScript types & interfaces
├── <name>.messages.ts          # Error/success message constants
├── <name>.enums.ts             # Enums
├── <name>.service.test.ts      # Unit tests
├── entities/                   # Prisma entity types
└── README.md
```

## Modules

### Authentication
| Module | Description |
|--------|-------------|
| `auth` | Core auth: login, register, OTP, TOTP (2FA), password reset |
| `auth_impersonation` | Admins can impersonate other users |
| `auth_saml` | SAML 2.0 enterprise SSO |
| `auth_sso` | OAuth 2.0 social login (Google, GitHub, etc.) |

### User
| Module | Description |
|--------|-------------|
| `user` | User CRUD operations |
| `user_agent` | Device & browser fingerprinting |
| `user_preferences` | Language, theme, notification preferences |
| `user_profile` | Profile info (name, avatar, bio) |
| `user_security` | Password, passkeys (WebAuthn), recovery codes |
| `user_session` | JWT session lifecycle with Redis caching |
| `user_social_account` | Linked social OAuth accounts |

### Tenant
| Module | Description |
|--------|-------------|
| `tenant` | Tenant CRUD & soft-delete lifecycle |
| `tenant_branding` | Logo, colors, custom branding |
| `tenant_domain` | Custom domains with DNS TXT verification |
| `tenant_export` | Full tenant data export |
| `tenant_invitation` | Email-based member invitations |
| `tenant_member` | Members, roles, and permissions |
| `tenant_session` | Tenant-context session binding |
| `tenant_setting` | Per-tenant configuration key-value store |
| `tenant_subscription` | Plans, billing cycles, feature flags |
| `tenant_usage` | API usage and quota tracking |

### Notifications
| Module | Description |
|--------|-------------|
| `notification_mail` | Transactional email (Nodemailer / SendGrid) |
| `notification_sms` | SMS via Twilio |
| `notification_push` | Web push notifications |
| `notification_inapp` | In-app notification store |

### Infrastructure
| Module | Description |
|--------|-------------|
| `db` | Prisma system + tenant database clients |
| `env` | Type-safe environment variable access |
| `limiter` | Express rate limiting, plan-aware per tenant |
| `logger` | Winston structured logger |
| `redis` | Redis client + BullMQ job queues |
| `redis_idempotency` | Idempotency keys for safe retries |
| `setting` | Global key-value settings store (DB-backed) |
| `storage` | S3-compatible file upload/download |

### Business
| Module | Description |
|--------|-------------|
| `ai` | AI provider abstraction (completions, embeddings) |
| `api_doc` | Swagger/OpenAPI documentation |
| `api_key` | API key generation and validation |
| `audit_log` | Immutable audit trail |
| `coupon` | Discount codes and redemption |
| `payment` | Payment provider abstraction + webhooks |
| `webhook` | Outbound webhook delivery system |

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/kuraykaraaslan/express-boilerplate.git
   cd express-boilerplate
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy and configure environment variables:

   ```bash
   cp .env.example .env
   ```

4. Run database migrations:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

## Usage

Development mode (with hot reload):

```bash
npm run dev
```

## API Routes

Routes are split into two groups:

### System Routes (`/api/system/`)

| Route | Module |
|-------|--------|
| `/api/system/auth` | Login, register, OTP, TOTP |
| `/api/system/auth/impersonation` | User impersonation |
| `/api/system/auth/sso` | OAuth SSO |
| `/api/system/user` | User management |
| `/api/system/user/session` | Session management |
| `/api/system/user/profile` | Profile |
| `/api/system/user/preferences` | Preferences |
| `/api/system/user/security` | Security settings |
| `/api/system/user/social-account` | Social accounts |
| `/api/system/tenant` | Tenant management |
| `/api/system/setting` | Global settings |
| `/api/system/coupon` | Coupons |
| `/api/system/payment` | Payments |
| `/api/system/storage` | File storage |
| `/api/system/notification/*` | Notifications |

### Tenant Routes (`/api/tenant/`)

| Route | Module |
|-------|--------|
| `/api/tenant/member` | Tenant members |
| `/api/tenant/invitation` | Invitations |
| `/api/tenant/domain` | Custom domains |
| `/api/tenant/setting` | Tenant settings |
| `/api/tenant/branding` | Branding |
| `/api/tenant/subscription` | Subscription & billing |
| `/api/tenant/usage` | Usage stats |
| `/api/tenant/api-key` | API keys |
| `/api/tenant/webhook` | Webhooks |
| `/api/tenant/export` | Data export |
| `/api/tenant/session` | Tenant sessions |
| `/api/tenant/auth/saml` | SAML SSO |

## Development

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Lint:

```bash
npm run lint:check
npm run lint:fix
```

Database commands:

```bash
npm run db:migrate      # Run migrations
npm run db:generate     # Regenerate Prisma client
npm run db:seed         # Seed database
npm run db:reset        # Reset database
```

## Dependencies

### Core
- [Express 5](https://expressjs.com/) — HTTP framework
- [Prisma](https://www.prisma.io/) — ORM (system DB)
- [TypeORM](https://typeorm.io/) — ORM (tenant DB migrations)
- [TypeScript](https://www.typescriptlang.org/)

### Auth & Security
- [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) — JWT
- [bcrypt](https://www.npmjs.com/package/bcrypt) — Password hashing
- [otplib](https://www.npmjs.com/package/otplib) — OTP / TOTP
- [@simplewebauthn/server](https://simplewebauthn.dev/) — Passkeys (WebAuthn)
- [@node-saml/node-saml](https://www.npmjs.com/package/@node-saml/node-saml) — SAML
- [helmet](https://helmetjs.github.io/) — HTTP security headers
- [csurf](https://www.npmjs.com/package/csurf) — CSRF protection

### Infrastructure
- [ioredis](https://www.npmjs.com/package/ioredis) — Redis client
- [bullmq](https://bullmq.io/) — Job queues
- [@aws-sdk/client-s3](https://www.npmjs.com/package/@aws-sdk/client-s3) — S3 storage
- [winston](https://www.npmjs.com/package/winston) — Logging
- [morgan](https://www.npmjs.com/package/morgan) — HTTP request logging
- [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) — Rate limiting

### Notifications
- [nodemailer](https://nodemailer.com/) — Email
- [@sendgrid/mail](https://www.npmjs.com/package/@sendgrid/mail) — SendGrid email
- [twilio](https://www.npmjs.com/package/twilio) — SMS
- [web-push](https://www.npmjs.com/package/web-push) — Push notifications

## Postman Collection

[![Run in Postman](https://run.pstmn.io/button.svg)](/static/V1.postman_collection.json)

## License

Licensed under the ISC license. See [LICENSE](/LICENSE) for more information.

## Support

Questions or feedback? Reach out on [Twitter](https://twitter.com/kuraykaraaslan) or [GitHub](https://github.com/kuraykaraaslan).

<a href="https://www.buymeacoffee.com/kuraykaraaslan" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

<a href="https://www.patreon.com/kuraykaraaslan" target="_blank"><img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Become a Patron!" style="height: 60px !important;width: 217px !important;" ></a>
