# tenant migrations

Numbered SQL owned by `tenant`: the tenant-isolation SQL (RLS helper functions,
roles, generated policies). `db` owns the runner (`db.deploy.ts`), not migration
files. The runner applies each file once, recorded as `tenant:<file>` in
`_sql_migrations`, after every module `tenant` requires. A module whose own SQL
calls `app_current_tenant()` / `app_rls_bypass()` lists `tenant` in
`dependencies.requires` so it runs after these.

The numbers keep their history from when these files lived in `db` (the gap is
not a mistake). `125_timescale_extension.sql` is no longer a file: the extension
is created by `ensureTimescaleExtension` in `modules/db/server/db.timescale.ts`
during the deploy pipeline's time-series phase.

| File | Purpose |
|---|---|
| `001_tenant_rls.sql` | RLS helper functions + first policies |
| `122_rls_roles_and_hardening.sql` | group roles, GUC AND membership bypass |
| `123_tenant_rls_full_coverage.sql` | generated policies, pre-127 shape. **History**: no longer produced by the generator, superseded by 127 |
| `124_rls_admin_privileges.sql` | `app_admin` table privileges for the cutover |
| `126_rls_coverage_additions.sql` | policies for the two tenant tables added after 123 was already applied (`notification_telegram_links`, `tenant_usage_metrics`); history, superseded by 127 |
| `127_rls_policy_hardening.sql` | **generated** (`npm run gen:rls-policies`): `app_current_tenant()` / `app_rls_bypass()` as `LANGUAGE sql ... BEGIN ATOMIC`, and per tenant table the `tenant_isolation` (InitPlan) + `tenant_admin_bypass` (`TO app_admin`) policy pair; rewrites every policy 001/123/126 created, idempotent, transactional, FORCE untouched. docs/phases/10-db phase 6 |
| `128_tenant_federation_columns.sql` | fleet federation columns of `tenants` (home region/node, residency, legal hold, relocation tombstone, assignment version; three CHECKs) and `tenant_slug_tombstones` (RLS-exempt), expand step; docs/phases/02-fleet/02 section 3.6 |
| `129_tenant_retained_files_due.sql` | `tenants.retainedFilesDueAt`, the marker of the retention-aware purge (when a purged tenant's next retained file needs a verdict), expand step; docs/phases/37-extensions/11 |
| `130_tenant_legal_hold_origin.sql` | `tenants.legalHoldOrigin` and its CHECK: which authority stands behind a legal hold (control plane, regional operator, tenant DPO, mixed), expand step; docs/phases/02-fleet/decisions-2026-10-18.md F19 |
| `131_tenant_fenced_at.sql` | `tenants.fencedAt`: when this node was fenced as the tenant's old home (the write fence then opens its transactions read only, routing refuses it as FENCED), expand step; docs/phases/02-fleet/decisions-2026-10-18.md F1 |
| `132_tenant_dr_taken_from.sql` | `tenants.drTakenFromNodeId`: the node this one last took the tenant over from in disaster recovery (failover: the primary; failback: the standby), so a failback takes back exactly the failed-over tenants and a repeated takeover re-sends its receipts, expand step; docs/phases/02-fleet/decisions-2026-10-18.md F1 |
| `133_tenant_purged_at.sql` | `tenants.purgedAt`: when this node actually purged the tenant (the deletion purge's claim, or a migration's source purge), so the key-shredding sweep retries only real purges and never shreds a tenant the admin soft delete merely hid, expand step with a backfill of earlier purges; P7-TDEK |
| `134_tenant_deletion_requested_by.sql` | `tenants.deletionRequestedBy` (OWNER / OPERATOR / FLEET / SELF_SERVICE): who asked for a pending deletion, so an owner may cancel only an owner or self-service request; NULL (rows from before) counts as the operator's. Expand step, no backfill. The previous release neither writes nor clears it: after a rollback or mixed-version window, null it on non-pending rows and on rows requested inside the window (the SQL header has the UPDATE); 41-ui-fixes 04-tenant-setting 1.7 |
| `135_tenant_country.sql` | `tenants.countryCode` (ISO 3166-1 alpha-2) and `tenants.countrySource` (operator / geoip / locale / default) with their CHECK: the country the price lists and payment options of phase 49 are looked up by; `region` is derived from it, data residency is untouched. Expand step, no backfill (a tenant from before has no country and prices from its `region`); docs/phases/49-country-pricing stage 49.1 |

Next free number: **136** (a tenant table added after 127 was applied needs its own file: copy the policy block of 127, see docs/phases/10-db phase 6). `manual/` holds scripts the runner never applies
(`rls-force-{enable,disable}.sql`).
