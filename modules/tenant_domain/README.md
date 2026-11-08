Done afterwards: the proxy also refuses the other non-serving custom statuses (`PENDING`, `INACTIVE`, `DNS_FAILED`) and
reserved platform names; see the next section. (Open until 2026-10-18: "the proxy still routes custom domains in other
non-serving statuses", risk-register `tenant_domain.01`.)

## 2026-10-18: only a host that serves routes (risk-register `tenant_domain.01`, fixed)

Before, the proxy and the TLS ask routed any registered host whatever its `domainStatus` (only `SUSPENDED` was refused), so
a `PENDING` custom domain (DNS not proven) captured traffic for a host later pointed at the platform, and a tenant could
register `admin.` / `www.` / `api.` / `auth.` / `app.` under the platform wildcard. One predicate now decides, in
`server/tenant_domain.serving.ts` (pure, so the proxy can import it), used by the proxy's host resolution
(`proxy/tenancy.ts`), the TLS ask (`SSLProvisioningService.isProvisioningAllowed`, so `caddy-ask`) and the origin resolver
(`tenant_domain.url`), so the three cannot drift:

| Name | Serves (`isServingDomain`) | May get a certificate (`isCertEligibleDomain`, the ask) |
|---|---|---|
| Custom domain | `ACTIVE`, or `VERIFIED` with `verifiedAt` and a certificate seen serving (`sslStatus` `ACTIVE` / `EXPIRING`) | `ACTIVE`, or `VERIFIED` with `verifiedAt` (it has no certificate yet) |
| Custom `PENDING` / `INACTIVE` / `DNS_FAILED` / `SUSPENDED` | no: an unknown host at the proxy, refused by the ask | no |
| Platform subdomain (`<label>.<TENANT_WILDCARD_DOMAIN>`) | yes whatever its status: it lives under the platform wildcard certificate and needs no DNS proof, so the free subdomain never stops serving on a status flip | yes |
| Platform subdomain, `SUSPENDED` or a reserved name held by a customer tenant | no | no |

- **Reserved names** (`RESERVED_SUBDOMAIN_LABELS` in `common/server/tenant-constants`: admin, www, api, auth, app, sso,
  mail, status, system, root, ... ) are judged on every label left of the wildcard, case-insensitively. The reserved
  platform tenants (root, fleet) are exempt. The environment words (dev, e2e, staging ...) are judged on the leftmost
  label only: a deeper label is the operator's zone (the demo's `<slug>.dev.<wildcard>`). The same list is enforced at three entry points: tenant slug validation
  (`SlugSchema`, `tenant.create`, `tenant.update`, and `provisionPersonal` suffixes an `admin@...` prefix), `POST /domains`
  for a wildcard subdomain (422 `DOMAIN_RESERVED`), and `ensureFreeSubdomain` (a customer tenant whose slug is reserved
  gets no free subdomain; it stays reachable on the platform host, `/tenant/{id}`). Since 2026-11-04 (owner) the list also
  holds the common words of environments and infrastructure (dev, test, e2e, qa, uat, staging, prod, preview, sandbox, demo,
  grafana, minio, mqtt, lns ...), and those words with a number after them (`dev2`, `e2e-3`, `staging01`). Business words
  (shop, store, blog) stay a customer's to take.
- **New labels** (owner 2026-11-04, `tenantLabelProblem` in `common/server/tenant-constants`): a slug chosen or changed and a
  wildcard subdomain added are ONE DNS label of 5 to 63 lowercase letters, digits and hyphens: no dot, no hyphen at either end
  (`SlugSchema` 400, `tenant.create` / `tenant.update` 422, the onboarding availability check `invalid`, `POST /domains` 422
  `SUBDOMAIN_LABEL_INVALID`). A tenant that already holds a shorter slug keeps it and keeps serving (the sweep judges only the
  reserved words); a tenant moved in by the fleet directory keeps its slug; `provisionPersonal` suffixes a prefix under 5 characters.
- **Existing offenders** found by the reconcile sweep are not deleted: the row is `SUSPENDED` (visible in the domains
  UI, audited with a webhook through `recordStatusTransition`, `statusBeforeSuspension` kept, no plan notice), its primary
  flag is handed on, and the sweep counts it (`reservedSuspended`, logged with the DNS recheck). A slug change to a free
  name renames the row back to `ACTIVE` and clears the suspension (`ensureFreeSubdomain`).
- **Cache.** `getByDomain` still returns the cached row (5 min, misses 60 s), and the proxy re-judges the row it gets, so a
  stale cached status cannot route a host that no longer serves. Every writer of `domainStatus` drops
  `tenant:domain:name:<host>` (update, verify, delete, reconcile, `ensureFreeSubdomain`, the DNS sweep), and now the SSL
  probes too, because a `VERIFIED` host serves only once `sslStatus` is `ACTIVE` / `EXPIRING`.
- A `VERIFIED` custom domain therefore starts to route when the first probe sees its certificate (the 6-hourly SSL job,
  or "check now" on the domain page; within the 60 s miss cache), not the moment the ask allows issuance.

Not done: the ask still does not look at the owning tenant's status (`tenant_domain.10`, separate row); a platform
subdomain's own `ACTIVE` status is no longer part of routing, so an operator who wants to take one offline suspends the
tenant, not the domain.

# Tenant Domain Module

Custom domain / subdomain management for tenants: DNS-token verification (TXT or CNAME), primary-domain selection, per-tenant domain/subdomain caps, and SSL/TLS observability for certs minted by an external reverse proxy. Domain rows are Redis-cached and live in the per-tenant DB.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `TenantDomain` | `tenant_domains` | One custom domain/subdomain per row, with verification + SSL/TLS observability columns |

Lives in the **tenant DB** (rows isolated by `tenantId` via the per-tenant DataSource). The `domain` column is globally unique; lookups by `tenantDomainId` / `domain` go through `getDataSource()` (system DB) for cross-tenant resolution, while writes use `tenantDataSourceFor(tenantId)`.

Columns of note:

- `domainStatus` — `PENDING` → `VERIFIED` → `ACTIVE` (or `INACTIVE` / `DNS_FAILED`)
- `verificationToken`, `verifiedAt` — DNS-proof bookkeeping (`verificationToken` is stripped from API responses via `SafeTenantDomain`)
- `sslStatus`, `sslIssuedAt`, `sslExpiresAt`, `sslIssuer`, `sslLastCheckedAt` — TLS observability written by the SSL cron

---

## Services

| Service | Responsibility |
|---|---|
| `tenant_domain.service.ts` (`TenantDomainService`) | CRUD + lifecycle: `getByTenantId`, `getById`, `getByDomain`, `getPrimaryByTenantId`, `create`, `update`, `getVerificationInfo`, `initiateVerification`, `verifyDomain`, `delete`. Enforces per-tenant caps, single-primary invariant, and Redis cache invalidation. |
| `dns_verification.service.ts` (`DNSVerificationService`) | Token generation, TXT/CNAME record name/value helpers, Redis storage of the pending token (24h TTL), DNS resolution + verification, and `recheckActiveDomains()` (cron health-check). |
| `ssl_provisioning.service.ts` (`SSLProvisioningService`) | TLS observability. `isProvisioningAllowed(host)` is the Caddy `on_demand_tls.ask` gate; `probeCertificate(host)` opens a TLS handshake and parses the leaf cert; `recheckCertificates()` reconciles the `ssl*` columns (cron). The platform does **not** issue certs itself — a reverse proxy (Caddy/Traefik/cert-manager) does, via ACME/Let's Encrypt. |

---

## Domain Status

| Status | Meaning |
|---|---|
| `PENDING` | Added, awaiting DNS verification |
| `VERIFIED` | DNS check passed |
| `ACTIVE` | Verified and serving traffic |
| `INACTIVE` | Manually disabled |
| `DNS_FAILED` | A periodic recheck found the TXT/CNAME no longer resolves; admin must re-verify |
| `SUSPENDED` | The plan no longer includes this custom domain; it does not serve and comes back with the plan (see the 2026-10-17 section below). Set only by the reconcile |

---

## SSL Status

Lifecycle written by `SSLProvisioningService` (the cert itself is provisioned externally):

`DISABLED` → `PENDING` → `PROVISIONING` → `ACTIVE` → `EXPIRING` → (`EXPIRED` / `FAILED`)

A successful `isProvisioningAllowed` flips `DISABLED → PENDING`; `recheckCertificates` promotes to `ACTIVE`, downgrades to `EXPIRING` within 30 days of expiry, or `FAILED` on handshake error / past expiry.

---

## Verification Methods

| Method | DNS record to add | Resolves to |
|---|---|---|
| `TXT` | `_verification.<domain>` → `TXT` | `verify=<token>` |
| `CNAME` | `_verify-<token>.<domain>` → `CNAME` | `VERIFICATION_DOMAIN` (`env`, defaults to `verify.example.com`) |

The pending token is stored in Redis (`dns_verify:<tenantDomainId>`, 24h TTL) and deleted once verification succeeds.

---

## Usage

```typescript
import TenantDomainService from '@/modules/tenant_domain/tenant_domain.service';

// Add a domain (status starts at PENDING)
const domain = await TenantDomainService.create({
  tenantId,
  domain: 'app.acme.com',
  isPrimary: false,
});

// Get the DNS record the user must add (defaults to TXT)
const info = await TenantDomainService.getVerificationInfo(domain.tenantDomainId);
// info.recordName / info.recordValue — show these to the user

// Re-check DNS and promote to VERIFIED
await TenantDomainService.verifyDomain(domain.tenantDomainId);

// Make it the primary domain (un-sets the previous primary for this tenant)
await TenantDomainService.update(domain.tenantDomainId, { isPrimary: true });
```

---

## API Routes

Tenant-scoped, **ADMIN+** (`requiredTenantRole: "ADMIN"`):

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[tenantId]/api/domains` | List domains (paginated) |
| POST | `/tenant/[tenantId]/api/domains` | Create a domain |
| GET | `/tenant/[tenantId]/api/domains/[domainId]` | Get verification info for a domain |
| DELETE | `/tenant/[tenantId]/api/domains/[domainId]` | Delete a domain (primary cannot be deleted) |
| POST | `/tenant/[tenantId]/api/domains/[domainId]/verify` | Run DNS verification |

Domain/subdomain limits are enforced in `TenantDomainService.create`. Two sources
answer the same question and the order between them matters:

1. **The plan** (`custom_domain`, `max_domains` — `tenant_domain.entitlement.ts`).
   `custom_domain` refuses a domain the tenant owns when the plan **explicitly**
   says no; an UNDECLARED feature is allowed, because treating "no plan mentions
   this" as a refusal would switch custom domains off for every tenant whose plan
   predates the key. `max_domains` sets the ceiling **when the plan states one**.
2. **The per-tenant settings** `maxDomains` / `maxSubdomains` (see *Settings*),
   which apply when the plan says nothing — self-hosted, free mode, root tenant.

The plan wins where both speak, and that ordering is the point: the setting is
editable by the tenant's own admin, so letting it override a paid ceiling would
make the ceiling advisory. Both keys were previously read by **nothing** — the
paid limit existed and the enforced one came from a setting the payer could
raise (`feature_gate/README.md` §Enforcement survey).

**Subdomains of the platform wildcard are never gated.** `acme.example.com` is
the free self-service path every tenant gets; only a domain the tenant owns is a
custom domain. Every entitlement read fails open — a feature-gate outage must
not stop a tenant pointing a domain at their site, and the setting ceiling is
still standing behind it.

Platform operator, **GLOBAL** scope (`tenant.tenants.read`, the permission of the operator's tenant page):

| Method | Path | Description |
|---|---|---|
| GET | `/tenant/[tenantId]/api/tenants/[targetTenantId]/domains` | Any tenant's domains (no verification token), for the domains panel on the operator's tenant page |

### Internal / cron routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/internal/api/caddy-ask` | internal | Caddy `on_demand_tls.ask` gate → `isProvisioningAllowed` |
| POST | `/tenant/[tenantId]/api/cron/dns-recheck` | Bearer `CRON_SECRET` | Run `recheckActiveDomains` |
| POST | `/tenant/[tenantId]/api/cron/ssl-health` | Bearer `CRON_SECRET` | Run `recheckCertificates` |

---

## Jobs

| Job | Queue | Default cadence | Runs |
|---|---|---|---|
| `tenant_domain.job.ts` | `tenant-domain-dns-recheck` | `0 */6 * * *` (every 6h) | `DNSVerificationService.recheckActiveDomains` — downgrades broken ACTIVE domains to `DNS_FAILED` |
| `ssl_health.job.ts` | `tenant-domain-ssl-health` | `15 5 * * *` (daily 05:15) | `SSLProvisioningService.recheckCertificates` — reconciles `ssl*` columns |

Both run on a single shared BullMQ worker (`concurrency: 1`). Trigger via `scheduleDnsRecheckJob()` / `scheduleSslHealthJob()` at boot (self-hosted) or the `CRON_SECRET`-protected cron routes above (serverless).

---

## Settings

Surfaced at `/tenant/[tenantId]/admin/domains/settings` (gear button in the Domains page header) via the shared `ModuleSettingsPage` scaffold. UI field metadata: `tenant_domain.settings.fields.ts`.

| Key | Type | Default | Notes |
|---|---|---|---|
| `maxDomains` | number | `3` | Max custom (non-wildcard) domains. Read per-tenant via `SettingService.getByKey(tenantId, 'maxDomains')`; hardcoded fallback of 3 when unset. |
| `maxSubdomains` | number | `1` | Max wildcard subdomains (ending in `TENANT_WILDCARD_DOMAIN`). Read per-tenant via `SettingService.getByKey(tenantId, 'maxSubdomains')`; hardcoded fallback of 1 when unset. |

Both are read in `TenantDomainService.create` before insert. Read/written via `GET/PUT /tenant/[tenantId]/api/admin-settings`. See `docs/ROADMAP_SETTINGS.md`.

---

## Security

- API responses use `SafeTenantDomain`, which **omits `verificationToken`** — the pending DNS token is never returned via the listing/detail endpoints.
- `isProvisioningAllowed` rejects IP literals, `localhost`/`*.localhost`, and any domain that is not `VERIFIED`/`ACTIVE`, keeping ACME (Let's Encrypt) rate-limits safe: a stranger pointing DNS at the platform cannot trigger unbounded cert issuance.
- TLS probes use `rejectUnauthorized: true` — an untrusted/expired cert is reported as `FAILED`, not silently accepted.
- Cron routes are gated by a Bearer token matching `env.CRON_SECRET`; the endpoint is disabled when the secret is unset.

---

## Concurrency & invariants

- **DNS proof gates the status.** `update` moves a domain into `VERIFIED` or `ACTIVE` only when its
  DNS verification succeeded (`verifiedAt`); otherwise 409. `verifyDomain` is conditional, so there
  is one transition, and it clears the spent challenge token with an explicit `NULL`.
- The DNS recheck downgrade is conditional on the domain still being `ACTIVE`, so it is announced
  once, and it really clears `verifiedAt`. Before, `undefined` was never written, and a DNS-failed
  domain kept its stale proof.
- **Create** counts and inserts under the tenant's domain-set lock, so the plan ceiling and the
  single primary hold under concurrency. A domain held by another tenant (not visible from this
  tenant's chokepoint block) is a 409 via the global unique index. **Delete** checks "not primary"
  on the locked row.
- Host lookups are deliberate `withSystemRLS` reads, because the tenant is what they resolve:
  `getByDomain` for the proxy, and `isProvisioningAllowed` for the TLS terminator's ask. The DNS
  and SSL sweeps go tenant by tenant through `listActiveTenants()`.

**Open observations (not changed):**
- The proxy no longer routes every registered host: see "2026-10-18: only a host that serves routes" below
  (risk-register `tenant_domain.01`, fixed).
- The DNS recheck treats any TXT record at the verification name as healthy, not the original token.
  The token is cleared on verification, so there is nothing to compare against.

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

Manages tenant custom domains/subdomains (DNS-token verification, SSL/TLS observability, primary-domain selection); strongly tenant-scoped — each tenant owns its domain rows in its own DB and configures its own domain/subdomain caps.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `maxDomains` | number | `3` | tenant | Maximum number of custom (non-wildcard) domains a tenant may register; enforced in create() before insert. Falls back to hardcoded 3 when unset. | `tenant_domain.service.ts` |
| `maxSubdomains` | number | `1` | tenant | Maximum number of wildcard subdomains (domains ending in TENANT_WILDCARD_DOMAIN) a tenant may register; enforced in create(). Falls back to hardcoded 1 when unset. | `tenant_domain.service.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `TenantDomain` | `tenant_domains` | domain, isPrimary, domainStatus, verificationToken, verifiedAt, sslStatus, sslIssuedAt, sslExpiresAt, sslIssuer, sslLastCheckedAt |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `tenant_domain.service.ts:create` — Domain vs subdomain caps are enforced per tenant: counts existing rows for data.tenantId and rejects if >= the tenant's own maxDomains/maxSubdomains setting (or the 3/1 fallback). Setting a domain isPrimary also unsets the prior primary within that tenant only.
- `ssl_provisioning.service.ts:isProvisioningAllowed` — On-demand TLS issuance is authorized per hostname only when that domain belongs to a tenant and is VERIFIED/ACTIVE; flips that tenant's domain sslStatus DISABLED->PENDING. Effectively gates cert minting per tenant domain state.
- `dns_verification.service.ts:recheckActiveDomains` — Cron re-resolves each ACTIVE domain and, on failure, downgrades that specific tenant's row to DNS_FAILED and writes a per-tenant audit log (tenantId=d.tenantId) via tenantDataSourceFor(d.tenantId).

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Hardcoded fallback caps of 3 custom domains and 1 subdomain when the tenant has no maxDomains/maxSubdomains setting row | `tenant_domain.service.ts:create` | The fallbacks (parseInt fallback to 3 and 1) are global constants applied to every tenant lacking an explicit override. The per-tenant keys already exist, but the DEFAULT itself is hardcoded rather than read from a platform/root default setting, so plans can't change the baseline without code edits. | `defaultMaxDomains` |
| CNAME verification target domain and TXT/CNAME record prefixes (CNAME_TARGET_DOMAIN from env.VERIFICATION_DOMAIN, _verification/_verify prefixes) | `dns_verification.service.ts:CNAME_TARGET_DOMAIN` | Global via env var and module constants — same verification endpoint for all tenants. Intentionally global shared verification infrastructure; would only need to be per-tenant for white-label DNS instructions, which is not a current requirement. | — |
| SSL recheck windows and DNS/SSL cron cadences (EXPIRING_WINDOW_DAYS=30, RECHECK_CONCURRENCY=5, ssl '15 5 * * *', dns '0 */6 * * *') | `ssl_provisioning.service.ts:EXPIRING_WINDOW_DAYS` | Hardcoded platform-wide constants run by a single shared worker (concurrency 1). Intentionally global shared infra/worker pool — not meaningfully a per-tenant concern. | — |

---

## Dependencies

`db`, `tenant`, `env` (declared in `module.json`). Also uses `redis` (caching + token store), `setting` (per-tenant caps), `audit_log` (DNS-failure logging), and `logger`.

## Mail brand source

`server/tenant_domain.mail-brand.ts` contributes the tenant's primary-domain origin (ACTIVE only; `null` in path mode)
to `notification_mail:brand_source`, so mail links point at the tenant's own host. Domain cache clears also delete
`notification_mail:brand:<tenantId>`.

## Contributions (docs/phases/37-extensions/10)

tenant_domain sits above `tenant` and most mailing modules (it requires them), so they never import it. It adds to
their points instead:

| Point | Export | What |
|---|---|---|
| `common:tenant_origin` | `server/tenant_domain.tenant-origin` | The origin for common's `absoluteTenantUrl` (every module's mailed links): the primary domain while it serves (a custom one only while the plan includes it), else the free subdomain. Platform gate since 2026-10-17. |
| `tenant:seed_step` | `server/tenant_domain.seed-step` | Mints a new tenant's `<slug>.<wildcard>` subdomain (platform gate: runs before the tenant's modules are switched on). |
| `tenant:slug_changed` | `server/tenant_domain.slug-listener` | Renames the free subdomain after a slug rename, so exactly one remains (2026-10-17). |
| `feature_gate:entitlement_changed` | `server/tenant_domain.entitlement-listener` | Reconciles custom domains with the plan the moment it changes (2026-10-17). |
| `tenant:onboarding_check` | `server/tenant_domain.onboarding-check` | The `dns_configured` checklist item: a verified custom domain. |
| `common:entity_panel` (slot `common.entity.panels`) | `ui/tenant-domains-entity-panel.component` | The domains of a tenant on the operator's tenant page (entity type `tenant`). |

## 2026-10-17: every tenant keeps a free subdomain; custom domains follow the plan

Owner direction (2026-10-17): "On Free there may be a subdomain service. Use of a full (custom) domain should be tied
to plans, or allowed on Free too — the sysadmin decides — but never let a tenant be left without a domain. The user
always has a free domain."

### The free subdomain is permanent

- Every tenant has `<slug>.<TENANT_WILDCARD_DOMAIN>`, `ACTIVE`, under the platform's own wildcard certificate (no DNS
  proof applies to it). One routine establishes it, `ensureFreeSubdomain` (`server/tenant_domain.free-subdomain.ts`),
  idempotent: it mints it when missing, renames the previous one after a slug change (same row, primary flag and site;
  so exactly one remains), puts a switched-off or DNS-failed one back to `ACTIVE`, and makes it primary when the tenant
  has no primary or a suspended one. It runs from the seed step, from the new `tenant:slug_changed` point (tenant
  announces a rename after the commit) and from the reconcile sweep below, which repairs tenants created before this.
- Delete refuses it with 409 `FREE_SUBDOMAIN_PERMANENT`; so does a status write that would switch it off. The
  protected row is the one named after the slug, or the tenant's only wildcard subdomain (an extra wildcard subdomain a
  tenant added itself can still be deleted). These guards are in the service, so an operator acting through the same
  routes keeps every other ability and the guarantee still holds.
- The primary always has a successor that serves: `update` refuses `isPrimary: false` on the primary (409
  `PRIMARY_REQUIRED`; promote another domain instead) and refuses to promote a domain that does not serve (409
  `PRIMARY_MUST_SERVE`: a free subdomain must be `ACTIVE`, a custom domain `VERIFIED`/`ACTIVE` with its DNS proof).
  Deleting the primary custom domain is allowed now and hands the primary back to the free subdomain in the same
  transaction; without a wildcard domain configured there is no successor and the old 409 stands.
- The DNS recheck no longer probes wildcard subdomains. It looked for a TXT or CNAME record at the free subdomain,
  which the platform's wildcard record never has, so every 6 hours it downgraded every tenant's free subdomain to
  `DNS_FAILED`.
- With `TENANT_WILDCARD_DOMAIN` unset (self-hosted, path routing) there is no subdomain; links use the platform host
  (common's `platformTenantUrl`), which is that installation's free address.

### Links always land on a domain that serves

`common:tenant_origin` is platform-gated now (it was `behaviour`; docs/phases/37-extensions/10): the subdomain is the
platform's routing of the tenant, not a feature the tenant switches on, so the contribution answers for every tenant
unless the platform banned or retired the module or the build does not ship it. The answer (`tenantOriginDomain` in
`server/tenant_domain.url.ts`): the primary domain when it serves (the free subdomain while `ACTIVE`; a custom domain
while `ACTIVE`, or `VERIFIED` with a certificate seen serving, and only while the plan includes custom domains), else
the free subdomain, else null and the platform host. Mail branding (`notification_mail:brand_source`) gives the same
answer.

### Custom domains by plan, the sysadmin decides

`custom_domain` (BOOLEAN) and `max_domains` (LIMIT, -1 = unlimited) are plan features, read by
`server/tenant_domain.entitlement.ts` as before (an undeclared feature is allowed; the `maxDomains` setting is the floor
without a plan). The catalogue plans now carry defaults the sysadmin edits in the platform catalogue (Monetization,
Catalog, Features): Free `custom_domain=false` (subdomain only), Pro `custom_domain=true`, `max_domains=3`, Enterprise
`custom_domain=true`, `max_domains=-1` (`tenant_subscription.catalog-data.ts`; docs/phases/36-tenant-subscription).
The domains page shows the free subdomain as always available, explains a refusal with the entitlement message
("Custom domains are not included in this plan") and hides Add Domain on such a plan. `GET /api/domains` carries
`freeSubdomain`, `wildcardDomain` and `customDomains: { allowed, maxDomains }` for that.

### A lapsed entitlement suspends, never deletes

`server/tenant_domain.reconcile.ts`, per tenant: ensure the free subdomain, then read the entitlement STRICTLY (a
feature-gate outage skips the tenant instead of failing open, which would bring every suspended domain back) and hold
the custom domains to it:

| The plan says | Custom domains |
|---|---|
| `custom_domain` false | all `SUSPENDED` |
| `max_domains` N | all but N `SUSPENDED`, keeping the primary, then the ones that serve, then the oldest |
| includes them again / a higher N | suspended ones come back, same order, to the status they had |

A suspended domain keeps its row, DNS proof and certificate state; `suspendedAt` and `statusBeforeSuspension` record
when and what to restore (migration `server/migrations/001_tenant_domain_suspension.sql`, not run here). An `ACTIVE`
domain comes back `ACTIVE`, so it is back in the DNS and SSL sweeps; one whose proof was lost meanwhile comes back
`PENDING`. A suspended primary hands the primary to the free subdomain in the same transaction. Each transition is
audited with a webhook (`tenant_domain.suspended`, `tenant_domain.reactivated`), and the owner and admins are told
once per suspended set (`notifyDomainsSuspended`, idempotency key over the exact set).

While suspended a domain does not serve: the proxy's host lookup (`getByDomain`) answers it as an unknown host (also
from a cached copy) and the TLS ask (`caddy-ask`) refuses it; no status write, verification or primary switch takes
it out of `SUSPENDED` (only the plan does), and the tenant can still delete it.

Triggers: `feature_gate:entitlement_changed`, which feature_gate announces from `invalidateFeatureCache` (every
subscription write, and since this pass every catalogue entitlement write, already drops that cache after it commits),
so a downgrade, lapse or upgrade is applied at once; and the DNS recheck job (6-hourly, and the `CRON_SECRET` cron
route), which now runs `reconcileAllTenantDomains` first as the safety net. A sysadmin editing a plan's features is not
announced per tenant: new adds see it within the gate's cache TTL (5 min), suspensions and reactivations at the next
sweep.

Not changed: the proxy still routes custom domains in other non-serving statuses (`PENDING`, `INACTIVE`, `DNS_FAILED`;
the open observation above and risk-register `tenant_domain.01`). `SUSPENDED` is the one status it now refuses.

## 2026-11-04: managed base domains and wildcard certificates (phase 56)

`docs/phases/56-managed-base-domains/README.md`, ADR-0020, operator guide `docs/guides/base-domains.md`.

- **Base domains are rows** (`tenant_domain_base_domains`, platform data): the environment's `TENANT_WILDCARD_DOMAIN` is seeded as the
  default at boot, the root tenant adds more on Platform -> Base domains. `baseDomainList()` (`tenant_domain.base-domains.ts`) is the
  cached list; the serving rule (`tenant_domain.serving.ts`) takes it and matches the **longest** base; a `wildcard_only` base (the LNS tree)
  never holds a tenant. A row's base is derived from its name, not stored.
- **Wildcards**: one certificate per ACTIVE base (`<base>`, `*.<base>`), ordered by DNS-01 (`AcmeClient.orderNames`, the Hetzner Cloud
  writer, a CNAME-delegated challenge zone; `ACME_DNS_*`), stored sealed in `tenant_domain_base_domain_certificates`, renewed by the same
  queue and policy as phase 51 (`issue-base` job). `tls-cert` serves the covering wildcard first, then the per-name certificate; covered
  hosts are no longer ordered for, and their per-name rows are retired a day after the probe saw the wildcard.
- **A host no organization serves** under a managed base gets the root 404 page marked "no organization" by the proxy; a failed lookup
  does not. **Moved hosts** (`tenant_domain_host_moves`) redirect for 30 days after a base change or slug rename.
- **Choice**: `baseDomainChoice` (root-only, default `platform`); the sign-up's offer route, the seed hint `baseDomain` through
  `tenant:seed_step`, the owner's and the operator's "Change base domain".

