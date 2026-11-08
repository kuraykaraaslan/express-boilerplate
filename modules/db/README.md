# Db Module

Pure-infrastructure TypeORM `DataSource` factory. A single shared default `DataSource` (`getDataSource()`) backs every entity in the app; `tenantDataSourceFor(tenantId)` optionally routes a tenant to its own physical database when a `TenantDatabase` mapping row exists, otherwise it falls back to the default. No service layer, no settings.

---

## Public API

| Export | Source | Use |
|---|---|---|
| `getDataSource()` | [`db.ts`](db.ts) | Lazily initialized + cached default `DataSource`. For all callsites. Idempotent — first call runs `initialize()`. |
| `tenantDataSourceFor(tenantId)` | [`db.ts`](db.ts) | If a `TenantDatabase` row exists for the tenant, a separate `DataSource` to that DB (LRU cache, max `100`). Otherwise returns `getDataSource()`. |
| `clearTenantDsCache(tenantId)` | [`db.ts`](db.ts) | Evicts and destroys one tenant's per-tenant override `DataSource` from the cache. |
| `TenantDatabase` | [`entities/tenant_database.entity.ts`](entities/tenant_database.entity.ts) | `tenantId → database` mapping row: `databaseUrl` (plaintext, deprecated), `databaseUrlEnc`, `regionId`, `status`, `schemaVersion`. |
| `parseDbUrl(url)` | [`db.utils.ts`](db.utils.ts) | Splits a Postgres URL into `{ url, schema }`, stripping the `?schema=` query param. |

`typeormLogging(nodeEnv)` (also in [`db.utils.ts`](db.utils.ts)) is an internal helper: returns `'all'` when `TYPEORM_LOG_QUERIES=1`, `['error','warn','schema','migration']` in development, and `['error']` otherwise.

---

## Entities

| Entity | Table | DB | Description |
|---|---|---|---|
| `TenantDatabase` | `tenant_databases` | system | `tenantId → database` mapping for per-tenant physical-DB override (DSN, region, lifecycle status, schema version). RLS-exempt (cross-tenant by design). |

`db.ts` also aggregates **every** application entity into a single `ENTITIES` array so one `DataSource` can resolve all repositories. As of the current code these are (owned by their respective modules, not by `db`):

`User`, `UserProfile`, `UserSecurity`, `UserPreferences`, `UserSession`, `UserSocialAccount`, `SigningCertificate`, `TrustListEntry`, `TenantDatabase`, `Tenant`, `TenantDomain`, `TenantMember`, `TenantInvitation`, `TenantSubscription`, `Payment`, `PaymentTransaction`, `AuditLog`, `ApiKey`, `CouponRedemption`, `Webhook`, `WebhookDelivery`, `SamlConfig`, `Setting`, `Coupon`, `SubscriptionPlan`, `PlanFeature`, `PushSubscription`, `Invoice`, `InvoiceLine`, `TenantUsage`, `UploadedFile`, `AiUsageLog`, `NotificationLog`, `StoreCategory`, `StoreCategorySpec`, `StoreProduct`, `StoreProductImage`, `StoreProductSpecValue`, `StoreVariantGroup`, `StoreVariantGroupItem`, `StoreBundle`, `StoreBundleItem`, `StoreVariationType`, `StoreVariationOption`, `StoreProductVariant`, `SeoMeta`, `MediaGallery`, `MediaGalleryItem`, `DynamicPage`, `DynamicPageTranslation`, `DynamicPageBlock`, `Fulfillment`, `FulfillmentItem`, `FulfillmentEvent`, `Cart`, `CartItem`, `ShippingMethod`, `ShippingRate`, `TaxClass`, `TaxRate`, `Wishlist`, `WishlistItem`, `ProductReview`, `ProductReviewVote`, `ReturnRequest`, `ReturnItem`, `ReturnEvent`, `LoyaltyAccount`, `LoyaltyTransaction`, `LoyaltyTier`.

> When a new entity is added anywhere in the app, register it in the `ENTITIES` array in [`db.ts`](db.ts).

---

## Connection URL

Single env var: `DATABASE_URL` (e.g. `postgresql://postgres:postgres@localhost:5432/next_boilerplate?schema=public`). `parseDbUrl` peels off the `?schema=` param into the `DataSource` `schema` option.

To allocate a dedicated DB to a tenant, insert a `{ tenantId, databaseUrl }` row into `tenant_databases` (`TenantDatabaseService.provision` does, and also writes the ciphertext and the region); `tenantDataSourceFor(tenantId)` then connects to that DB (and caches it). Without a row the tenant uses the shared default DB. A row whose `status` is not `ACTIVE` (`PROVISIONING`, `DROPPED`) is refused with an error rather than served from the shared database.

**The DSN is being encrypted (EXPAND phase).** `databaseUrlEnc` holds the DSN under the field encryption of `common` (`SETTINGS_ENCRYPTION_KEY`, AES-GCM). Every reader goes through `resolveTenantDatabaseUrl` ([`db.tenant-database.url.ts`](server/db.tenant-database.url.ts)): ciphertext first, the plaintext `databaseUrl` as the fallback (also when the ciphertext cannot be opened, with a warning that names the tenant and no secret), and an error when neither answers. On the `single` role this release still writes the plaintext, so the previous release keeps working after a rollback; a later `contract` migration drops it. On `FLEET_ROLE=node|fleet` (P9-6, `ciphertextOnlyRole`) only the ciphertext is kept: `TenantDatabaseService.provision` writes `databaseUrl` NULL whenever it could encrypt, and `deployDatabase`, after the backfill, NULLs the plaintext of every row whose ciphertext opens with this deployment's key to exactly that DSN (`clearPlaintextTenantDatabaseUrls`; each UPDATE guarded on both values read; a row whose ciphertext does not open or disagrees keeps its plaintext and is reported). No fleet-role release ever read the plaintext alone, and the column stays, so this is a data step and not the contract migration. The SQL half of the change is [`migrations/001_tenant_databases_expand.sql`](server/migrations/001_tenant_databases_expand.sql) (additive, idempotent, a no-op while the table does not exist; `synchronize` builds the same columns and named CHECKs); the TypeScript half is the backfill ([`db.tenant-database.backfill.ts`](server/db.tenant-database.backfill.ts)) that `deployDatabase` runs under the lock when a key is configured. Without a key nothing is encrypted and nothing changes.

`DataSource` options are environment-derived, not per-tenant: the RUNTIME schema sync runs only in development (`NODE_ENV === 'development'`; the deploy pipeline below is what creates tables everywhere else), `logging` is driven by `typeormLogging`, and the per-tenant override cache is capped at `MAX_CACHED = 100` (oldest entry evicted + destroyed on overflow); a tenant without a dedicated database is remembered as "shared" for 30 s (`SHARED_TTL_MS`), so a database provisioned on another process is picked up here within that window (`clearTenantDsCache` and `provision()` clear it at once on this process).

The development sync ([`db.dev-sync.ts`](server/db.dev-sync.ts)) is not TypeORM's sync-on-initialize: every DataSource is built with `synchronize: false`, and after `initialize()` the sync runs only when a digest of the entity metadata (plus the TypeORM version and the schema) differs from the one recorded in the one-row `_dev_sync_state` table, under an advisory lock with a re-check, and at most once per process and database (the bundle layers of `next dev` share the result through `globalThis`). Drift made by hand is therefore not repaired until an entity changes; `NB_DEV_FORCE_SYNC=true` syncs regardless.

---

## Migrations

`db` owns the runner, not application migration history. A schema change belongs
to the module that owns the table and lives under
`modules/<module-id>/server/migrations/*.sql`. The runner orders modules by
manifest dependencies and records each migration as `<module>:<file>` in
`_sql_migrations`.

### The deploy runner

`npm run db:deploy` (`modules/db/scripts/db-deploy.ts`, also the demo-reset cron and the `migrate` image) runs
`deployDatabase()` from [`db.deploy.ts`](server/db.deploy.ts) over the direct connection, under one
advisory lock per database (`pg_try_advisory_lock`, polled; it logs `waiting for another deploy` and
gives up after `DB_DEPLOY_LOCK_TIMEOUT_MS`, default 10 minutes, instead of blocking forever):
schema step, SQL migrations, time-series, bootstrap seed, fleet tenant row, post-deploy steps.
The bootstrap seed puts its demo customer (Acme Corp) at `SEED_TENANT_ID` = `00000000-0000-4000-a000-000000000001` (common
`tenant-constants.ts`); `00000000-0000-4000-8000-0000000000xx` is the platform tenants' range (root `…00`, fleet `…01`) and no
other tenant is created, seeded or moved into it (phase 46, D46-5). The fleet tenant step refuses a row at the fleet id that is
not the fleet tenant (another name, members or domains; not checked on `FLEET_ROLE=fleet`, where its operators are its members):
the deploy stops with `FleetTenantCollisionError`, which names `tenant:rekey` (below), instead of calling a customer the fleet.
`migrateDatabase(target, opts)` is the per-database, reportable unit (everything but the seed) and returns
`{ database, schemaMode, applied[], skipped[], adopted[], stamped[], failed[], schemaVersion, durationMs }` without credentials;
`deployDatabase` wraps it, backfills `tenant_databases.databaseUrlEnc`, seeds and throws when `failed` is not empty.

**Post-deploy steps (`db:post_deploy`).** After the fleet tenant row, still under the lock and on every deploy of the
control database, `deployDatabase` runs the idempotent upkeep steps other
modules contribute to `db:post_deploy` ([`db.post-deploy.ts`](server/db.post-deploy.ts)), one after another in
extension order; `db` never imports the owner. A step's default export is `{ run(ctx) }`, where `ctx` carries a
DataSource on the deploy target (the application's entities, no synchronize), `withTenantTransaction(tenantId, fn)`
(a transaction with a transaction-local `app.current_tenant`) and `log`. A step reaches the database only through `ctx`,
never through the runtime DataSource, Redis or the env module (the deploy runs at build time and in the `migrate` image,
and an open client keeps the process alive), and must write nothing when there is nothing to do. Best effort: a step
that fails to load or throws is logged and returned in the report's `postDeploy`, the others still run, the deploy does
not fail and the next deploy retries. Today: dashboard publishes its builtin widgets into the root tenant; webhook and auth_saml encrypt the secrets they stored before
their columns were field-encrypted (P9-6, through [`db.encrypted-columns.ts`](server/db.encrypted-columns.ts)). A contribution that declares
`metadata: { tenantDatabases: true }` also runs on every dedicated tenant database of the fan-out, after that database
migrated cleanly (`fanOutDeploy(..., { tenantPostDeploy: true })`, which `db-deploy.ts` passes; its outcomes are in the entry's
`postDeploy` and the log line): the webhook and SAML steps do, because a tenant with a database of its own keeps those rows
there. Only the opted-in steps run on a tenant database, and such a step must not assume control-database tables.

**Bringing a column under field encryption (`db.encrypted-columns.ts`).** The owning module declares the column with
`encryptedColumnTransformer` (common `field-encryption.ts`: every write is encrypted, a row that is not yet an envelope is read
as it is) and contributes a `db:post_deploy` step that calls `encryptPlaintextColumns(systemBatchesOn(ctx.dataSource), { table,
idColumn, columns })`. The pass encrypts in place every stored value that does not have the strict envelope shape
(`isFieldEnvelope`; NULL and '' stay), in keyset batches of 500 rows per transaction with `app.bypass_rls` set locally, each
UPDATE guarded on the value it read, so it is idempotent, online, and never overwrites a value the application changed in
between. Without `SETTINGS_ENCRYPTION_KEY` it does nothing and says so. Counts only reach the log.

**Tenant data keys (P7-TDEK, `db.tenant-keys.service.ts`).** Field-encryption v2 (`v2.<kid>.<iv>.<ct>.<tag>`, the kid bound as
additional data; common `field-encryption.ts`) lets a value be encrypted under a per-tenant data key (TDEK, kid
`tdek-<tenantId>-<generation>`). `tenant_keys` (migration `002_tenant_keys.sql`, control database only, RLS-exempt, excluded from the
migration bundle) holds each key WRAPPED by the node's key provider ([`db.key-provider.ts`](server/db.key-provider.ts),
`TENANT_KEY_PROVIDER`): `node-key` (default) derives the wrapping key from `SETTINGS_ENCRYPTION_KEY`, so destroying a key reaches the
live database but not a backup taken before; `file` keeps one KEK-wrapped slot file per key in `TENANT_KEYSTORE_DIR` (region KEK
file `TENANT_KEYSTORE_KEK_FILE`), outside the database and its backups, so destroying the slot shreds the tenant's columns in every
backup too; `kms` and `vault` are interfaces only. `tenantKeys` creates the ACTIVE key on first use (one per tenant, advisory lock),
caches unwrapped keys for 5 minutes and registers that cache as common's field-key resolver (a warmed key opens synchronously),
reads in dual mode (`decrypt(tenantId, value)`: plaintext, v1 and node-key v2 pass; another tenant's key is refused as
`WRONG_TENANT`), rotates on compromise, destroys (the rows first, then the provider slots; a slot that fails is stamped `slotsPendingAt`, migration
`003_tenant_keys_slots_pending.sql`, and the tenant module's key-shredding sweep reruns the destroy; a purged tenant never gets a new key) and escrows under a
legal hold (`escrow`, `releaseEscrow`). Which columns it protects is declared on `db:tenant_key_columns`
([`db.tenant-key-columns.ts`](server/db.tenant-key-columns.ts)) by the owning module; `db.tenant-key-columns.ratchet.test.ts`
requires every secret- or special-category-patterned text column of a tenant-scoped table to be declared or waived with a reason.
The online backfill (`db.tenant-key-backfill.ts`, job `db-tenant-key-backfill`) pages by the declared `idColumn` in its own type when it
alone is unique (its index serves every page), else by (tenant, id); `resealTenantKeyColumns(tenantId)` runs it for one tenant on the
system database and the tenant's own database, which the purge does right before it destroys the tenant's keys.

**User data keys (decision F27, `db.user-keys.service.ts`).** A person's user-level secrets (the `user_social_accounts` OAuth tokens,
the TOTP secret `user_securities.otpSecret`) belong to no tenant, so they are sealed under a per-user data key, kid
`udek-<userId>-<generation>`, by the same engine ([`db.data-keys.ts`](server/db.data-keys.ts): provider, cache, rotate, destroy, escrow)
on its own table `user_keys` (migration `004_user_keys.sql`, control database only, RLS-exempt, no tenant column so never in a bundle).
`userKeys.decrypt(userId, value)` refuses another user's key, or any key that is not a user key, as `WRONG_USER`; the tenant reader
refuses a user key as `WRONG_TENANT`; dual read keeps node-key envelopes and plaintext readable. The columns are declared on
`db:tenant_key_columns` with `keyScope: 'user'`, moved by the same online backfill and counted by the same judge; the ratchet scans the
user-level tables too. Erasing the person (privacy self-service account deletion, `UserService.delete`) calls
`userKeys.recordErasure(userId, 'USER_ERASURE')` and then `userKeys.destroy(userId, 'USER_ERASURE')` (an identity merge does the same for
its placeholder with `USER_MERGED`). The final record lives in `user_key_erasures` (migration `005_user_key_erasures.sql`, RLS-exempt):
while it exists no key is ever created for the person, even one who never had a key, and its `keysDestroyedAt` stays null until a destroy
marked every key DESTROYED. `userKeys.retryErasures()`, run by the `db-tenant-key-backfill` worker before each pass, reruns the destroys
still owed and the provider slots a destroy left (`retryPendingSlots`, never touching a live key). `resealUserKeyColumns(userId)` seals one
person's legacy values under their key before an erasure; its count tells the caller not to claim the backups shredded.

**Applied version.** After a clean run `migrateDatabase` records the schema version of the code in `_schema_state` (one row
per database: `schema_version`, `applied_at`, `applied_by`, `release`; [`db.schema-state.ts`](server/db.schema-state.ts)).
It is bookkeeping: an unknown version or a failed write is a warning, never a failed deploy. `/internal/api/health`
reports `schemaHash`, the 16-hex hash of the schema this build expects (from its own migration files and entity metadata, no
database, `null` until computed and when the image carries no migration files); `/internal/api/ready` adds
`schema: { hash, appliedHash, inSync }` from `_schema_state` and never turns a missing or unreadable record into a 503.
Both expose the hash only, never the migration number: they are unauthenticated.

**Tenant databases (fan-out).** `fanOutDeploy(control, opts)` ([`db.deploy.fan-out.ts`](server/db.deploy.fan-out.ts)) runs
`migrateDatabase` over every `tenant_databases` row that is not `DROPPED`: one call per distinct database (server, database,
schema), so each has its own lock, its own `_sql_migrations` ledger and its own report; tenants that share a database are one
entry; a row registered on the control database itself is skipped. A database that fails (unreadable DSN, unreachable, edited
applied file, failing SQL) is recorded and the run goes on; the result counts `migrated`, `failed` and `skipped`, and each
migrated database's version is copied to `tenant_databases.schemaVersion`. `db-deploy.ts` runs it after the control deploy
for `node` and `fleet` (the `single` role keeps today's behaviour unless `--tenant-databases` is given;
`--no-tenant-databases` switches it off), prints one line per database and exits non-zero when the control deploy or any
tenant database failed. The registry DSN is what the application connects with: a fan-out needs it to be able to run DDL.

**Modes, by process role** ([`db.deploy-mode.ts`](server/db.deploy-mode.ts), `FLEET_ROLE`):

| | `single` (default: dev, Vercel, compose, demo) | `node`, `fleet` |
|---|---|---|
| schema step | `synchronize` from the entities (today's behaviour; `DB_DEPLOY_SYNC=false` still skips it) | `migrate`: SQL migrations only, no `synchronize` |
| bootstrap seed (demo accounts, fresh DB only) | on | off |
| connection | `DATABASE_URL_UNPOOLED`, else `DATABASE_URL_ADMIN`, else `DATABASE_URL` | `DATABASE_URL_UNPOOLED` only, throws when unset |

`DB_DEPLOY_MODE=migrate|synchronize` and `DB_DEPLOY_SEED=auto|always|never` override the role default (an invalid
value fails the run). `migrate` mode, whatever the role, also requires `DATABASE_URL_UNPOOLED`. A database in `migrate`
mode can start from nothing: the baseline migration below builds its tables.

**Baseline** ([`migrations/000_baseline.sql`](server/migrations/000_baseline.sql), rules in
[`db.baseline.ts`](server/db.baseline.ts)). Every other migration file alters tables that must already exist, so the whole
entity schema is one generated file, `db:000_baseline.sql`, that the loader always runs first. `npm run db:baseline`
(`modules/db/scripts/db-baseline.ts`) asks TypeORM for the DDL `synchronize` would run in an empty scratch schema, strips the scratch
schema name and writes the file (statements only, extensions installed in `public`, `public` after the target schema on the
search path for that transaction only). It refuses to overwrite a file that exists: once released, its checksum is in every
ledger and an edit fails closed, so `--force` is for the day before the first release. After the baseline a schema
change is a new migration file, never a regenerated baseline. What a database does with it:

| database | in `synchronize` mode | in `migrate` mode |
|---|---|---|
| empty | the sync pass builds the schema, the baseline is **recorded without running** (`report.adopted`) | the baseline runs, first |
| has tables, no baseline row | the sync pass is the "one last sync", the baseline is recorded without running | **refused** (`report.failed`, nothing applied): `npm run db:baseline -- --adopt` |
| baseline recorded | nothing | nothing |

`npm run db:baseline -- --adopt [--allow-drops]` ([`db.baseline-adopt.ts`](server/db.baseline-adopt.ts)) adopts an existing
database (the deploy target; `DATABASE_URL_UNPOOLED` under `FLEET_ROLE=node|fleet`), under the deploy lock: it lists what
`synchronize` is about to run, refuses a plan that would **remove** something the entities do not declare (an index or
constraint a SQL migration added) unless `--allow-drops`, runs the one last sync pass, then records the baseline in the
ledger. Safe to re-run. Dedicated tenant databases that were never migrated need it once before the fan-out can migrate them.

**Schema drift** (`npm run db:schema:drift`, `modules/db/scripts/db-schema-drift.ts`, CI job `schema.no_drift`). A migrate-mode
database must be reproducible from the files, so an entity change without a migration is a defect. The check builds an empty
scratch schema exactly as a node is built (the baseline, then every module's SQL files, contract steps allowed, no
time-series) and asks TypeORM which statements `synchronize` would still run ([`db.schema-scratch.ts`](server/db.schema-scratch.ts)).
[`db.schema-drift.ts`](server/db.schema-drift.ts) classifies them: a missing table, column, index, constraint or type, or a
changed type or default, is drift and exits 1 with a one-line summary per statement (never a literal); what the migrations add
beyond the entities (RLS helpers, exclusion constraints, extra indexes) is listed and allowed. TypeORM never settles on a few
statements (it re-issues `SET DEFAULT '{}'::jsonb` on every pass), so a second scratch schema is built by `synchronize` itself and
the statements it still gets are subtracted one for one. Both scratch schemas (`fleet_scratch_<hex>`) are dropped afterwards.

**Ledger.** `_sql_migrations` records `name` (`<module>:<file>`), `module_id`, `file_name`, `applied_at` and, added
idempotently by the runner (not by a numbered file, a file cannot alter the table that records it), `checksum`
(sha256 of the file, CRLF normalised), `applied_by` (`DB_DEPLOY_ACTOR`, else the database role) and `release`
(`RELEASE_VERSION`). On every run an applied file whose checksum differs fails the run before anything is applied
(the report names the stored and the found checksum): an applied migration is never edited, a change is a new file.
A row written before checksums existed has `checksum IS NULL` and is **stamped once from the current file**
(trust on first use: a file edited after it was applied, before this existed, is accepted as it is today).

**Phases.** A file declares its phase in its leading comment, `-- kind: expand|migrate|contract; reversible: false`
(default `expand`, reversible; `migrate` and `contract` default to irreversible, a `contract` cannot be reversible).
This is the `ReleaseMigration` shape of `fleet_protocol` (mirrored, `db` does not import it; a test checks both).
Phases must not go backwards across the pending files, and a pending `contract` migration is refused, with
nothing applied, unless the caller passes `allowContract` (`db-deploy.ts --allow-contract`), which the node helper
does only inside a READ_ONLY maintenance window after the backup.

**Repeatable files.** A generated, idempotent file that is rewritten in place after it was applied
declares `-- repeatable: true` in its leading comment (expand only; `tenant:127_rls_policy_hardening.sql` does, because
its generator rewrites it whenever a table joins the registry). When its checksum changes, or the row has none, it is re-applied in
its own transaction and the row is updated instead of failing.

**Superseded checksums.** A hand-written file may be edited after it was applied only when the edit is a no-op for a
database that already ran the old text (for example a column default that only a fresh schema will ever use). It then
names the checksum of the applied version in its leading comment, `-- supersedes: <sha256 hex>[,<sha256 hex> ...]`
(lowercase, no spaces; never together with `repeatable`). A ledger row carrying one of those checksums is re-stamped
to the current file WITHOUT running it (conditional on the checksum just read; reported under `stamped`); a database
that never applied the file runs the new text; any other stored checksum still fails closed, and the next edit fails
closed too unless it names the new checksum. Used once so far: the module files whose uuid defaults moved from
`uuid_generate_v4()` to the built-in `gen_random_uuid()` (fleet HEALTH-3), because a module migration runs with only
the target schema on its search path, where `uuid-ossp` (in `public`) is not found. New module files use
`gen_random_uuid()`; `db.migration-uuid-default.test.ts` fails on a module file that calls `uuid_generate_v4()`
without putting `public` back on its own search path.

**Schema version and release manifest.** [`db.schema-version.ts`](server/db.schema-version.ts) computes
`<highest migration number>.<16 hex>` (at most 20 characters) from the migration files and a canonical hash of the
entity metadata, with no database: `npx tsx modules/db/scripts/db-schema-version.ts`. It is an identity, not an ordering key
(migrations are numbered per module). `npx tsx modules/db/scripts/db-migration-manifest.ts [--out file]` emits the database
part of a release manifest, `{ schemaVersion, migrations: [{ name, checksum, kind, reversible }], containsContract }`,
validated against fleet_protocol's `ReleaseMigrationSchema` and `checkMigrationPlan` before it is printed.

`db` owns two migration files: the baseline and `001_tenant_databases_expand.sql`. The tenant-isolation SQL (RLS functions `001`,
roles `122`, the first generated policies `123`/`126`, and the final-state hardening `127`) is owned by
the `tenant` module, in [`modules/tenant/server/migrations/`](../tenant/server/migrations); it runs
before any module that requires `tenant`. `127` and
`manual/rls-force-{enable,disable}.sql` are generated by `npm run gen:rls-policies`; `123`/`126` are
history (old policy shape) and are no longer produced or checked. Policies are installed but **not
enforced** until the Faz 4 cutover.

**Policy shape (migration 127, docs/phases/10-db phase 6).** Every tenant table has two policies, from the single
definition in [`db.rls-policy.ts`](server/db.rls-policy.ts): `tenant_isolation`
`USING ("tenantId" = (SELECT app_current_tenant()))` (+ `WITH CHECK`), for everybody, and
`tenant_admin_bypass` `TO app_admin USING ((SELECT app_rls_bypass()))` (+ `WITH CHECK`). The `(SELECT ...)`
makes the helper an InitPlan (one evaluation per statement, not per row; a query with no tenant context
does no scan). `app_current_tenant()` / `app_rls_bypass()` are `LANGUAGE sql STABLE ... BEGIN ATOMIC`:
bound to catalog OIDs, so a caller's `search_path` cannot substitute `current_setting()`/`pg_has_role()`.
Only canonical uuid text counts as a tenant; anything else is no tenant (never an exception). Never ship the
functions without the policies or the other way round (the inlined OR policy is a measured 2 000 ms plan
regression). Tests: `rls.policy-shape.test.ts` (always) and `rls.probes.integration.test.ts`
(`RLS_PROBE_TEST=1`, local server, scratch database).

The old numbered files (formerly `docs/archive/legacy-db-migrations/`, now owned by [`modules/tenant/server/migrations/`](../tenant/server/migrations))
are a legacy archive from before module-owned migrations and are intentionally
not executed.
Fresh databases establish their baseline from the current TypeORM entities (the generated `000_baseline.sql`);
future changes must be added to the owning module's migration directory.

`ensureTimescaleExtension` (`db.timescale.ts`, deploy pipeline time-series phase) creates the `timescaledb` extension **only when the
server offers it** (otherwise a `NOTICE` and exit 0). Applied by the deploy
pipeline for every database it is pointed at (the system DB, and each tenant DB
URL the deploy is run against); it needs the admin/owner credential, never
`app_runtime`.

---

## Moving a tenant to another id (`tenant:rekey`)

`npm run tenant:rekey -- --from <id> --to <id>` ([`scripts/tenant-rekey.ts`](scripts/tenant-rekey.ts) over
[`db.tenant-rekey.ts`](server/db.tenant-rekey.ts); docs/phases/46-module-placement, D46-6) moves every row of one tenant to a
new id, nothing lost. Written for databases seeded before 2026-10-27, whose demo customer sits at the fleet tenant's id; generic
otherwise.

- **Dry run by default**, in a READ ONLY transaction: per table and column the rows that would move, the sessions it would end,
  the Redis keys it would rename or delete, the tenant-key values it would carry over, the objects it would copy, and what it
  cannot rewrite (hash chains). `--scan-text` also lists every text, JSON and uuid column that still names the old id after the
  move (history, labels, pointers: left as written; a uuid column listed there may be a reference the tool does not know, check it).
- **The columns come from the catalog**: every column of the app schema (the `?schema=` of the URL, default `public`) named
  `tenantId`, `tenant_id`, `<x>TenantId` or `<x>_tenant_id` of a uuid or text type or an array of one (`pg_attribute`, so a
  column the role holds no privilege on is not silently skipped), plus the declared JSON references
  (`EMBEDDED_TENANT_REFERENCES`: `account_deletions.tenantIds/doneTenantIds`, `feature_flags/experiments.targetingRules`,
  `session_revocation_outbox.sessions`), where a whole `"<id>"` string is replaced, and the polymorphic owner columns
  (`POLYMORPHIC_TENANT_REFERENCES`: `documents.ownerId` and `wallet_accounts.ownerId` where `ownerType = 'TENANT'`).
- **`--apply --confirm <database>@<host>`** runs it in ONE transaction: the foreign keys over moved columns are made deferrable for
  the transaction and restored, referencing tables move before the tables they reference, the tenant's `user_sessions` are
  deleted and handed to the session-revocation outbox (the worker then tells the `session_revoked` hooks: push tokens, Fleet ID
  SSO sessions, limiter marks, sockets), every moved column is counted again (a row left at the old id rolls back) and only then
  is it committed. Any error rolls everything back, the DDL included.
- **Tenant data keys**: a `v2.tdek-<from>-<n>` envelope is bound to its tenant, and `tenant_keys` refuses a change of tenant. In the
  transaction such values are opened under the old key and written as node-key envelopes (readable in any tenant's context): in
  the declared columns, and embedded in any other text or JSON column (found by a scan, e.g. a bank change request's
  `payload.ibanEnc`). After the commit the new tenant's own key seals the declared columns (the backfill's per-tenant pass, which
  refills the blind indexes); embedded ones stay under the node key, readable. The old ACTIVE key is RETIRED in the move, never
  destroyed (the backup taken before the move opens with it), so the fleet tenant created at the old id gets a key of its own.
  Needs the app's environment (the node field key).
- **Objects**: before anything is written, every object under `<from>/` that `OBJECT_KEY_COLUMNS` name is copied to the same path
  under `<to>/` in the moving tenant's store and the columns are rewritten; the originals are never deleted (stored URLs and the
  backup keep working). Needs the app's environment (the storage settings). `--keep-object-keys` leaves the keys as they are
  instead, and then the moved tenant can no longer presign or delete those objects.
- **After the commit, Redis** (SCAN, never FLUSHDB): a key whose name holds the old id is RENAMED to the new id (RENAMENX, data and
  TTL kept; a string or hash value naming the id as a whole JSON string is rewritten), so the automation host's node state, dead
  letters and usage counters, the in-app inboxes and the caches follow the tenant. A key of another name is deleted only when it is
  an expiring string naming the id (a cache); a hash or a key without a TTL that names it (an automation partition's schedules,
  shared by every tenant) is listed and never touched. The session cache of the users whose sessions ended is deleted. BullMQ keys
  (`bull:*`) are never touched and are listed.
- **Refused**: `--to` in the platform range or named by any row, `--from` root, `--from` fleet while it is the fleet tenant (named
  Fleet, a name `TenantService.update` keeps fixed, or any row there with `FLEET_ROLE=fleet`), a `--from` that is no tenant or has
  its own database, a tenant column that partitions a hypertable, a role without UPDATE or without a row-level-security bypass,
  an apply without Redis or without the right `--confirm`, object keys under `<from>/` when the store cannot be reached and
  `--keep-object-keys` was not given; and until acknowledged: rows of hash chains that cover the tenant id
  (`--accept-chain-break`: the audit, approval and wallet chains of the tenant then report a break).
- `--exclude-table <t>` (repeatable) leaves a table's rows at the old id. The connection is `DATABASE_URL_UNPOOLED`, else
  `DATABASE_URL_ADMIN`, else `DATABASE_URL`, from the environment only (never a URL on the command line); a variable set in the
  shell wins over every one `.env` adds, and the report names the user, host, port and variable. Exit 0 done or dry run, 1 refused
  or failed, 2 usage.

**The demo recipe** (the old seed's Acme at `…8000-000000000001` → `…a000-000000000001`, then the real fleet row):

1. A full backup of the database, of Redis and of the object store's `00000000-0000-4000-8000-000000000001/` prefix.
2. Dry run in the app's environment: `npm run tenant:rekey -- --from 00000000-0000-4000-8000-000000000001 --to
   00000000-0000-4000-a000-000000000001 --scan-text`. Read it: the connection line, the tables and counts, the hash chains, the
   objects to copy, the Redis keys left alone (shared or durable, BullMQ), the uuid columns of the text scan, and the "and first"
   lines.
3. Stop the app and the worker (no write lands at the old id while it moves; in-process caches go with them).
4. `npm run tenant:rekey -- --from … --to … --apply --confirm <database>@<host> --accept-chain-break` (the dry run prints the
   exact `--confirm`).
5. Deploy (`npm run db:deploy`): the fleet id is free, so the fleet tenant row is created. Start the app and the worker; the moved
   tenant's people sign in again, and the outbox drain tells the session hooks within a minute.
6. Check the boards, devices, users, domains, files and telemetry of the moved tenant, and deploy its automation flows again: the
   schedules and timers an automation partition held under the old id are not moved (they are listed), a deploy registers them
   under the new id.

---

## Time-series tables (TimescaleDB capability)

Any module can declare an append-only, time-keyed table as time-series without
knowing whether its database has TimescaleDB (`docs/phases/10-db/phase-5`):

```ts
// modules/<id>/server/<id>.timeseries.ts  (contributed to the `db:time_series` point)
export default [{ table: 'iot_reading', timeColumn: 'recordedAt', chunkInterval: '1 day', retention: '90 days' }] satisfies TimeSeriesTable[];
```

- `timescaleCapability(ds)` (`db.timescale.ts`) -> `{ available, edition: 'tsl'|'apache'|null, version, schema }`, cached per DataSource. `DB_TIMESCALE=off` forces the fallback.
- `ensureTimeSeriesTables` (deploy phase after `synchronize` + SQL migrations, `db.time-series.ts`): hypertable with `create_default_indexes => false` (every index is declared on the entity), or the fallback: BRIN on the time column + `(tenantId, time DESC)` btree. Idempotent.
- Entity rules: the primary key and every unique index include the time column and, for a tenant-scoped table, START with the tenant column - `(tenantId, deviceId, keyId, ts)`, not `(deviceId, keyId, ts)` (a key without the tenant lets a duplicate-key error or an `ON CONFLICT DO NOTHING` row count reveal another tenant's row). `entityRuleProblems` states the rule and `ensureTimeSeriesTables` enforces it on the live table. The `(tenantId, time DESC)` index is created in both modes (a tenant-wide window needs it: without it the query falls back to the lossy BRIN). Every index is declared on the entity (so `synchronize` never drops one it did not create). A column change on a time-series table goes through a numbered migration.
- **Hypertable isolation (Timescale mode, tenant-scoped tables):** RLS is not inherited by chunks and chunks copy the hypertable's privileges, so granting an app role on a hypertable lets it read every tenant from `_timescaledb_internal.*`. `ensureTimeSeriesTables` therefore makes a non-superuser owner role (`tele_owner`, `DB_TIMESERIES_OWNER_ROLE`; `LOGIN` with `CONNECTION LIMIT 0` and no password because policy jobs run as the owner) own the hypertable and the rollup hypertables before the first chunk exists, gives `app_runtime`/`app_admin` NO privilege on them (and revokes it from existing chunks, reporting `chunk-acl-revoked`), and creates the access view `<table>_v` (`security_barrier`, `WITH CHECK OPTION`, owner-owned, DML granted to the app roles). The app must use `<table>_v` (`timeSeriesAccessRel(db, table)` resolves it; the rollup job and `readTimeSeries` already do; `INSERT ... ON CONFLICT` works through it). TypeORM repositories bound to `@Entity('<table>')` have no privilege in Timescale mode: use query builder / raw SQL against `<table>_v`. Through the view `app_admin` has no cross-tenant bypass. `pg_class.reltuples` of the parent stays readable (accepted metadata). Details and probe results: `docs/phases/10-db/05-timescale-capability.md` section 5.8.
- Retention: job `db-time-series-retention` (hourly; `POST /api/cron/time-series-retention`) runs `drop_chunks` on hypertables (for `app_admin` through the owner's SECURITY DEFINER `time_series_drop_chunks`) and batched `DELETE` otherwise; on TSL a retention policy is also reconciled.
- **Known Timescale limitation (verified on 2.17.2 and 2.30.2):** a hypertable with row-level security cannot be compressed and cannot be the source of a new continuous aggregate (a plain materialized view has no RLS either). `ensureTimeSeriesTables` therefore refuses `compressAfter` / `continuousAggregates` on an RLS table, with an error that points to `rollups`. System tables without RLS may still use both. RLS tables stay uncompressed; filesystem-level compression of the plain layout was estimated at about 4.2-5.9x (heap) and 4.2-7.9x (indexes) in the benchmark (`scripts/bench/telemetry-isolation/results/e_fs_compression.json`).
- **Tenant-isolated rollups (`rollups`, `db.time-series.rollup.ts`):** the answer for tenant-scoped telemetry. Declare `rollups: [{ name, bucket: '1 minute'|'1 hour'|'1 day', groupBy, values: { col: ['avg'|'min'|'max'|'sum'|'count'|'last'] }, retention?, lateWindow?, sweepEvery?, lag?, source?, maxLagBuckets? }]`; `db` creates each rollup as an ordinary (hyper)table with `tenantId`, the same `tenant_isolation` + `tenant_admin_bypass` policy pair + `FORCE ROW LEVEL SECURITY`, primary key `(tenantId, groupBy..., bucket)` (the watermark table is `(tenantId, rollup)`); job `db-time-series-rollup` (every minute; `POST /api/cron/time-series-rollup`) maintains closed buckets per tenant under `withTenantTransactionFor`, driven by what changed (per-(rollup, tenant) watermark for new buckets, a dirty-range queue `time_series_rollup_dirty` fed by `markRollupDirty` at ingest and by finer rollups whose bucket changed, a periodic `sweepEvery` safety-net sweep of the short `lateWindow`; only buckets whose values differ are written), derives 1h from 1m and 1d from 1h when the declared aggregates allow it (`source`), bounds a pass (`maxSlicesPerRun`, 50 s budget, fair rounds), never overlaps itself (Redis lock per rollup + advisory lock per rollup and tenant) and reports lag per rollup and tenant (`lagBuckets`, alert hook when above `maxLagBuckets`, default 5). Sliced backfill on first run, idempotent. Works on plain Postgres (`date_bin`). `readTimeSeries(table, tenantId, { from, to, resolutionMs | maxPoints, filters })` picks raw -> 1m -> 1h -> 1d and appends the raw tail after the watermark. Each rollup has its own `retention`, independent of the raw table's. A view with `security_invoker = true` (PG15+) is fine as a read-only convenience over an RLS table; a plain or materialized view is not an isolation boundary.
- Continuous aggregates (system tables only) are views over an internal hypertable and are not reached by the RLS generator: expose them only through a service that filters by `tenantId` if they ever hold tenant data.

### Provider matrix

| Environment | Hypertables | `drop_chunks` | Compression / caggs / policy jobs | Result |
|---|---|---|---|---|
| Self-hosted `timescale/timescaledb` image (TSL, default compose) | yes | yes | yes (compression / caggs not on RLS tables: those use `rollups`) | full |
| Apache-only build (`-oss` image, some distro packages) | yes | yes | no (`rollups` still work: plain tables + job) | hypertables + job retention + rollups |
| Timescale Cloud | yes | yes | yes | full (their licence terms apply) |
| AWS RDS / Aurora, Google Cloud SQL, Azure Flexible Server, Supabase, Neon | no (extension not offered or Apache-only on some) | - | no (`rollups` work: BRIN/btree plain tables) | plain-table fallback + rollups |

The probe output decides at runtime; this table is for operators. Provider offerings change - verify before relying on a row other than the first.

---

## Security

Migration `001_tenant_rls.sql` enables Postgres RLS on the tenant-scoped tables (`tenants`, `tenant_domains`, `tenant_members`, `tenant_invitations`, `tenant_subscriptions`, `tenant_usage`, `settings`, `audit_logs`, `api_keys`, `payments`, `payment_transactions`, `subscription_plans`, `plan_features`, `coupons`, `coupon_redemptions`, `webhooks`, `webhook_deliveries`, `saml_configs`, `push_subscriptions`, `uploaded_files`, `ai_usage_logs`, `notification_logs`) as defense-in-depth.

**Runtime contract:** once RLS is applied, every connection MUST issue `SET LOCAL app.current_tenant = '<tenantId>'` on checkout — without it RLS-protected `SELECT`s return 0 rows. Cron jobs / CLI tooling that legitimately need cross-tenant access connect as a `BYPASSRLS` role (or `SET LOCAL app.bypass_rls = 'on'`). The User family, e-signature, trust-list, and `tenant_databases` tables are intentionally left RLS-exempt (cross-tenant by design; the boundary there is the JWT/session).

> Note: the `SET LOCAL` is issued by the chokepoint in `db.context.ts` (`withTenantRepository` / `withTenantRepositoryFor` / `withTenantTransactionFor`), not by `tenantDataSourceFor`. Policies are enforced only on a deployment that connects as an `app_runtime` login and has run `manual/rls-force-enable.sql` (see the cutover runbook, `docs/phases/10-db/04a-cutover-runbook.md`); on the default owner/superuser connection isolation still rests on the application-layer `where: { tenantId }` guards. Enforcement has been rehearsed on a local development database only.

### Roles and the two reasons RLS was toothless (migration 122)

Migration 001 enabled RLS and then left it unable to bite, in two independent ways:

1. **`ENABLE` does not apply to a table's owner**, and the application connects as the role that created the tables. Every policy 001 wrote was skipped for every query the app makes. Only `FORCE ROW LEVEL SECURITY` removes that exemption.
2. **`app_rls_bypass()` read a session variable and nothing else.** Anything able to run one statement on the connection — an injected fragment, a careless helper — could `SET LOCAL app.bypass_rls = 'on'` and switch off its own isolation. A guard the guarded party can lift is not a guard.

Migration 122 fixes (2) and prepares (1):

- `app_runtime` and `app_admin` exist as **NOLOGIN group roles**. No password is committed: the operator creates the login their environment needs and grants it membership. (A placeholder password in git would be a real, guessable login on a real database.)
- `app_rls_bypass()` now requires the GUC **and** `pg_has_role(current_user, 'app_admin', 'member')`. Role membership is a property of the connection; no SQL text can forge it. Note that `BYPASSRLS` is a role *attribute* and is **not** inherited through membership — which is the other reason bypass goes through the policy rather than that attribute.
- The migration grants `app_admin` to whoever runs it, so `withSystemRLS()` keeps working the day enforcement is switched on.
- `withSystemRLS()` now runs on `getSystemDataSource()`, which prefers `DATABASE_URL_ADMIN` when set (identity), then the unpooled URL (connection shape), then the default connection — i.e. unchanged behaviour until an admin credential exists.

**Enforcement is still off, deliberately.** `FORCE ROW LEVEL SECURITY` lives in [`migrations/manual/rls-force-enable.sql`](../tenant/server/migrations/manual/rls-force-enable.sql), which the numbered runner does not pick up, with its reverse beside it. Running it before every tenant-scoped query goes through a chokepoint that issues `SET LOCAL app.current_tenant` (docs/phases/10-db Faz 2/3) turns the whole application into empty screens — correctly, and instantly.

### The tenant-scoped data path (Faz 2, and the move onto it)

RLS only bites inside a transaction that has issued `SET LOCAL app.current_tenant`, and ~2,800 call sites do `(await getDataSource()).getRepository(X)` — pooled, ad-hoc, no transaction, nowhere for that statement to live. `db.context.ts` is the shape they move to:

```ts
import { withTenantRepository, runWithTenant } from "@kuraykaraaslan-labs/db";

// In a request (the API dispatcher already opened the context):
const rows = await withTenantRepository(Badge, (repo) => repo.find());

// In a job, which must open it per iteration:
await runWithTenant(tenantId, () => doWork(tenantId));
```

Three things worth knowing:

- **There is no `getTenantRepository(X)` that returns a repository.** A repository carrying `SET LOCAL` belongs to the transaction that ran it, and a function returning one has to end its transaction first — the caller would hold a handle on a released query runner, or worse, silently fall back to a pooled connection with no tenant set. The callback shape makes that impossible to write.
- **Fail-closed.** With no tenant in context these helpers throw. They never widen to "all tenants": a missing context is a caller bug, and guessing produces a cross-tenant read.
- **An entity pinned to the shared database (`@SharedDatabaseOnly()`, `db.shared-database.ts`) → `withSharedTenantRepositoryFor` / `withSharedTenantTransactionFor`.** For tables read before the tenant is known (`api_keys`: `verify()` looks a key up by hash; 02-fleet F8). Same transaction, `SET LOCAL app.current_tenant`, write fence and async context as the tenant helpers, but always on the shared DataSource. The guard: `withTenantRepository(For)` refuses a pinned entity (`SharedDatabaseRoutingError`) wherever the tenant lives, and `tenantDataSourceFor` builds a tenant's own DataSource without the pinned entities, so a query on it fails and its dev sync never creates their tables. Every entity inside a `withSharedTenantTransactionFor` block must itself be pinned: a tenant-routed entity read there would come from the shared database for a tenant with its own.
- **More than one entity in one transaction → `withTenantTransactionFor(tenantId, (qr) => …)`.** `withTenantRepositoryFor`'s callback holds a single entity's repository, so multi-entity work (a merge that re-points one table and retires a row in another, first/last flags recomputed around an insert) could not move before. This hands the callback the tenant-scoped `QueryRunner`; use `qr.manager.getRepository(X)` for every entity inside it, which is exactly the receiver `check:tenant-repo-coverage` counts as scoped. It runs on the tenant's own DataSource, unlike the older `withTenantRLS`, which always uses the shared one.
- **A catch that swallows a query error belongs OUTSIDE the block.** A failed statement aborts the Postgres transaction; catching it inside and carrying on (or returning a fallback) leaves the block to commit an aborted transaction. Wrap the whole `withTenant…` call instead.
- **Raw SQL is tenant data too.** `check:tenant-repo-coverage` only counts `getRepository` calls, so a `ds.query(…)` on a tenant table is invisible to it. Move it into `withTenantTransactionFor` and call `qr.query(…)` (see `search`'s Postgres provider).
- **Cache writes and side effects go AFTER the block, never inside it.** Busting a read-through cache inside the transaction runs before commit, and a concurrent reader can re-cache the old row for the whole TTL. Put only database work in the callback; invalidate, audit and emit once it has returned (see `redirect.service.ts`).
- **Keep the callback short.** The transaction is open for its whole duration, so S3 uploads, mail and third-party calls belong outside it. A long callback holds a pooled connection.

Context is opened where the tenant is actually known: the **API dispatcher** (`app/tenant/[tenantId]/api/[...slug]/route.ts`) for module routes, each per-tenant **cron route**, and each **job** around its own per-tenant iteration. Not in `proxy.ts` — that runs as middleware, in a different invocation from the handler, so an `AsyncLocalStorage` opened there reaches nothing. A job must wrap itself for the same reason: a queue hands work to a fresh continuation and inherits nothing from whoever scheduled it.

### Coverage is derived, not remembered (migration 123)

001's list of 19 tables was written by hand in 2025 and the registry now holds 328 entities. That gap is not a list that fell behind — it is the failure mode: a module ships a tenant-scoped table, nobody remembers the migration, and the table sits outside the isolation boundary until somebody notices.

`npm run gen:rls-policies` derives the list from `ENTITIES` and writes four artefacts: migration 123 (policies for the **306** tables with a `tenantId`), the two cutover scripts (same list, so the switch cannot fall behind the policies), and [`rls.coverage.generated.md`](server/rls.coverage.generated.md) — the inventory of what is covered, what is exempt **and why**, and what is scoped through a parent row. Nothing is silently skipped: every one of the 328 entities lands in exactly one of those buckets.

`npm run check:rls-policies` regenerates and fails when the committed artefacts differ. It runs in CI, which is what stops the list going stale again by the same mechanism it went stale the first time.

### Measuring the move, and holding it (Faz 3)

The rollout is the largest phase in this set and it runs for months, so it needs two things a plan cannot supply on its own: a number, and a ratchet.

`npm run gen:tenant-repo-coverage` counts, from the source, every repository call on a **tenant-scoped** entity and reports it per module in [`tenant-repository.coverage.generated.md`](server/tenant-repository.coverage.generated.md). Cross-tenant tables (`users`, `tenant_databases`) are not counted — they are not part of this move, which is why the honest figure is 2 589 rather than the plan's raw 2 800.

`npm run check:tenant-repo-coverage` (a CI job) fails on two things: the inventory drifting from the source, and **a module that has already been migrated growing a new unscoped call**. The second is the ratchet, and it is on from the first migrated module rather than at the end — a gate switched on when the work is finished protects nothing while the work is happening.

**The codemod the plan asked for cannot exist**, and the reason is the one written above: the API is a callback, so rewriting `const repo = ds.getRepository(X)` means moving the statements after it into a block with a different lifetime — which statements belong in the transaction, and which (an S3 upload, a third-party call) must stay outside it, is judgement. The plan's own risk note says the same thing from the other end: some call sites are cross-tenant on purpose, and moving them mechanically would be a silent authorization break. So modules move by hand, smallest and least risky first.

**Shadow mode** ([`db.shadow.ts`](server/db.shadow.ts)) is how the paths that will go dark are found before they do. Every tenant-scoped query running with no tenant in context is counted by table, logged at a rate that will not become its own outage, and readable through `shadowStats()`. It counts while the policies are not yet enforced on a database, which is the only safe time to look.

Migrated so far (see the inventory for the current list): `fx`, `hr_schedule`, `ai`, `notification_sms`, `notification_inapp`, `auth_impersonation`, `plugin_runtime`, `storage`, `auth_abac`, `utm`, `tags`, `activity`, `time_entry`, `notification_log`, `hr_contract`, `seo`, `redirect`, `search`, `approval`, `comments`, `navigation`, `tax`, `enrichment`, `ai_agent`, `field_service`, `notification_push`, `tenant_export`, `data_import`, `warehouse`, `crm_assignment`, `crm_opportunity`, `pos`, `tenant_setting`, `wallet`, `analytics`, `privacy`, `mail_inbound`, `contract`, `blog`, `commerce_shipping`, `gift_card`, `feature_flags`, `tasks`, `bookings`, `project`, `bank`, `terms_consent`, `commerce_review`, `legal_tr`, `coupon`, `pricing`, `webhook`, `integrations_hub`, `form_builder`, `procurement`, `events`, `hr_leave`, `hr_payroll`, `tenant_usage`, `audit_log`, `manufacturing`, `invoice`, `pipeline`, `commerce_cart`, `asset`, `quote`, `support`, `hr_recruitment`, `crm_lead`, `organization`, `commerce_fulfillment`, `commerce_order`, `commerce_return`, `contact`, `marketing`, `media_gallery`, `accounting`, `payment_subscription`, `drive`, `crm_lead_finder`, `messaging`, `observability`, `commerce_wishlist`, `dashboard`, `calendar`, `document`, `tenant_subscription`, `inventory`, `loyalty`, `dynamic_page`, `commerce_catalog`, `telephony`, `hr`, `metering`, `scim`, `api_key`, `tenant_invitation`, `tenant_domain`, `tenant`, `marketplace_review`, `marketplace_developer`, `marketplace`, `tenant_member`, `payment` — chosen because their services take the tenant id as an **argument**, so `withTenantRepositoryFor` needed no claim about their callers. The context-reading variant is a bigger promise (every path into the module passes through `runWithTenant`) and is proved module by module.

**Operator steps, when the cutover comes:** create a login role, `GRANT app_runtime TO <login>`, point `DATABASE_URL` at it; create the admin login, `GRANT app_admin TO <admin login>`, point `DATABASE_URL_ADMIN` at it; then run the force script.

---

## Usage

```ts
import { getDataSource, tenantDataSourceFor } from "@/modules/db";
import { User } from "@/modules/user/entities/user.entity";
import { TenantMember } from "@/modules/tenant_member/entities/tenant_member.entity";

// Default path — ~99% of the app
const ds = await getDataSource();
const users = await ds.getRepository(User).find();

// Per-tenant DB override (optional; falls back to default when no row exists)
const tds = await tenantDataSourceFor(tenantId);
const members = await tds.getRepository(TenantMember).find();
```

---

## Rules

- No `next/*`, no `react` — service-layer infrastructure only.
- Always `await` the helpers — the first call runs a lazy `initialize()`.
- Tests mock these helpers; production code never calls `new DataSource()` directly.
- **A `null` in a where is SQL NULL.** Every DataSource built here (`buildDataSourceOptions`, the deploy, migration,
  post-deploy and scratch sources) sets `invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR` (`db.where-values.ts`):
  `null: 'sql-null'`, `undefined: 'ignore'`. TypeORM 0.3.28's default skipped a null, so `where: { subjectId: x }` with
  `x === null` matched every row; now it can only narrow (`IS NULL`). Update / delete / increment criteria and
  query-builder `.where({…})` used to render it as `= NULL` (no row) and now render `IS NULL` too. Still write the
  intent: `x ?? IsNull()` for "rows where it is NULL", the key left out for "no filter". An `undefined` is still
  skipped, so a tenant key must never be undefined on a tenant path. `npm run check:null-where`
  (`scripts/registry/null-where.mjs`, in CI) fails on a criteria value whose type can be null, any or unknown; `x!` /
  `x as T` claims are listed with `--asserted`, optional tenant filters with `--tenant-undefined`.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

The db module is a pure-infrastructure TypeORM DataSource factory (one shared default DB plus an optional per-tenant physical-DB override via the TenantDatabase mapping) and exposes no settings, no service layer, and no SettingService reads, so its only tenant surface is connection routing.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| *(resolved by the Faz 2 chokepoint)* `tenantDataSourceFor` itself does not set the RLS session variable | `db.ts:tenantDataSourceFor` | The `SET LOCAL app.current_tenant` is issued per transaction by `db.context.ts` (see *The tenant-scoped data path*); the remaining step is enforcing it on a database (`04a-cutover-runbook.md`). | — |
| synchronize, logging level, and MAX_CACHED connection-pool sizing are global/env-derived, not per-tenant | `db.ts (defaultDataSource + tenantDataSourceFor DataSource options, MAX_CACHED constant)` | Intentionally global shared-infrastructure tuning (driven by NODE_ENV / env and a single LRU cap of 100). A large or noisy tenant cannot get a different pool size, logging verbosity, or sync behavior, but making these per-tenant is generally undesirable for shared infra, so this is noted only for contrast and not recommended as a real setting. | — |

---

## Dependencies

Requires the [`env`](../env) module (`DATABASE_URL`). Imports entity classes from every domain module to assemble the shared `ENTITIES` array.
