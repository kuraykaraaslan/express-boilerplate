# Audit Log Module

Append-only event logging for sensitive system and tenant-level actions. Records the actor, action, resource, metadata, IP, and user agent, and supports paginated, filtered querying. Every row is persisted to the acting tenant's own DB; platform-level events fall back to `ROOT_TENANT_ID`.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `AuditLog` | `audit_logs` | One immutable audit event. Lives in the **tenant DB** (platform events land on the `ROOT_TENANT_ID` tenant). |
| `AuditActorIdentity` | `audit_actor_identities` | `(tenantId, actorRef) -> actorId`, plus the `keyVersion` of the key that derived the reference. The only place a pseudonymous `actorRef` resolves to a person. Written by the sealed chain only. |
| `AuditChainPolicy` | `audit_chain_policy` | One row per tenant that overrides the role default of the chain mode (`legacy` or `sealed`). Read by the writer and by the database trigger. |

`audit_logs` columns: `auditLogId` (uuid PK), `tenantId`, `actorId` (nullable), `actorType` (default `SYSTEM`; `USER` / `SYSTEM` / `API_KEY` / `SERVICE`), `onBehalfOfActorId` (nullable, dual-actor / impersonation), `actorTenantId` (nullable, delegation and break-glass provenance), `action`, `severity` (`low|medium|high|critical`, default `low`), `resourceType` (nullable), `resourceId` (nullable), `metadata` (`jsonb`), `ipAddress` (nullable), `userAgent` (nullable), `prevHash` / `rowHash` (nullable, hash chain), `createdAt`, `deletedAt` (nullable, soft-delete guard), and the columns of the hardened chain, all nullable and additive: `actorRef`, `onBehalfOfRef` (`varchar(64)` pseudonyms), `commandJti`, `nodeId` (uuid, SERVICE actors), `hashVersion` (`smallint`; NULL = v1, 2 = v2).

Indexes: `tenantId`, `actorId`, `onBehalfOfActorId`, `action`, `severity`, `resourceType`, the compound `(tenantId, createdAt)` (`IDX_audit_logs_tenant_created`, the hot read path), `IDX_audit_logs_tenant_actor_tenant` (declared on `actorTenantId`; the baseline shows the entity's compound intent is not honoured by a property-level `@Index`, so do not rely on it for a compound lookup) and `IDX_audit_logs_tenant_actor_ref` `(tenantId, actorRef)`.

Schema comes from three places, in this order: the generated baseline (`modules/db/server/migrations/000_baseline.sql`, built from the entities), `synchronize` on a single-role deployment, and this module's own migrations in `server/migrations/` (see "Hardened chain"). Every index and CHECK the SQL creates is mirrored in the entity decorators, because `synchronize` drops what the entity does not declare (`audit_log.migrations.test.ts` and `npm run db:schema:drift` prove it). The old reference to `modules/db/migrations/005_audit_log_compliance.sql` was wrong: that file does not exist.

---

## Service / Responsibilities

`AuditLogService` (`audit_log.service.ts`) is the only service — there is no repository abstraction beyond it.

| Method | Responsibility |
|---|---|
| `log(input)` | Validate the input (`CreateAuditLogDTO`), resolve `tenantId` (defaulting null/omitted to `ROOT_TENANT_ID`), resolve the tenant's chain mode, open that tenant's DataSource via `tenantDataSourceFor`, and persist one row: on the legacy chain with the JavaScript hash under the advisory lock, on the sealed chain with ONE `INSERT` that the database trigger chains and hashes. **Never throws** — failures are caught and logged so auditing can't break the calling operation. Also emits a structured `[AUDIT]` line via `Logger` (a sealed row never names the person in it, only a short reference). |
| `getAll(input)` | Validate the query (`GetAuditLogsDTO`), resolve the tenant the same way, and return `{ logs, total }` filtered by `tenantId` plus optional `actorId` (matches a legacy row's id OR any reference the identity mapping holds for that actor), `action` (partial `ILike` match), `severity`, `resourceType`, `resourceId`, and an inclusive `fromDate`/`toDate` range on `createdAt`, ordered by `createdAt DESC` and paginated. Excludes soft-deleted rows. A sealed row's `actorId` / `onBehalfOfActorId` are filled from the mapping (null once erased). Rows are parsed through `AuditLogSchema` before return; the hardened-chain fields appear only on rows that carry them, so a legacy row serialises as it always did. |
| `purgeExpired(input, exporter?)` | Per-tenant retention purge. Reads `auditLogRetentionDays`; 0/unset = keep forever (no-op). Otherwise hard-deletes rows older than the cutoff. With `archive: true`, serializes the doomed batch to NDJSON first — handed to the optional `AuditArchiveExporter` if supplied, else returned to the caller. Returns `{ purged, cutoff, archive }`. Unchanged in this release; see "Known defects" for what it does to verification. |
| `anonymizeActor(input)` | Right-to-erasure (GDPR Art. 17) on the **legacy** chain. Nulls `actorId`/`onBehalfOfActorId`, stores a stable `anon:<sha256>` pseudonym in metadata for correlation, scrubs PII metadata + IP/UA — while preserving the row and `action`. Returns `{ anonymized }`. It rewrites hashed columns, so the chain no longer verifies afterwards (known defect). On a **sealed** tenant it calls the SECURITY DEFINER function `audit_anonymise_actor` instead (migration 005): the identity is withdrawn from the mapping, one `audit.anonymised` row is appended, no existing row changes and the chain keeps verifying; `{ anonymized }` is the number of rows that named the actor (see "Hardened chain"). |
| `exportLogs(input)` | Right-to-access (GDPR Art. 15) + bulk export. Returns all non-deleted rows for the tenant (optionally filtered by `actorId` for a per-user SAR, plus a date range) serialized as `csv` or `ndjson`. Returns `{ format, body, count }`. |
| `verifyChain(tenantId)` | Recomputes the per-tenant append-only hash chain in keyset-paged rounds (1000 rows; memory does not grow with the trail) and confirms each row's `prevHash`/`rowHash` links match. v2 rows are recomputed inside PostgreSQL, v1 rows in JavaScript, so a mixed chain verifies. Soft-deleted rows are included. Returns `{ ok, checked, brokenAt }` (`brokenAt` = first broken row's id; `checked` counts the rows examined, the broken one included). |
| `verifyChainStatus(tenantId)` | The same verdict as a code only, `CHAIN_OK` or `CHAIN_BROKEN`, for compliance checks that may report a status but never a row or an id. |
| `queryCrossTenant(callerTenantId, input)` | **Root tenant only** (rejects non-root callers with 403). Aggregates matching events across every tenant's audit table within a time window. Returns `{ logs, total }`. |
| `actionActivityCrossTenant(callerTenantId, { actions, since, latest?, now? })` | **Root tenant only** (403 otherwise). For exact action names: per window start, how many rows every tenant holds (one grouped COUNT per tenant, served by the index `(tenantId, action, createdAt)` of migration 013), and the newest `latest` rows with actors resolved. Bounded: 50 actions, 5 windows no older than a week, 100 rows. A tenant whose database cannot be read is logged, left out and counted in `skippedTenants`; the others still answer. Used by the AI firewall activity page, which caches the result. Proven on a real PostgreSQL in `audit_log.action-activity.integration.test.ts` (FLEET_DB_TEST=1). |
| `computeRowHash` / `scrubMetadata` / `serializeForArchive` / `serializeForCsv` | Pure helpers (also used by tests). `computeRowHash` is the **v1** hash: deterministic `sha256(prevHash + canonical(row))` with recursively key-sorted metadata. It is never changed (every v1 row is verified against it). |

Also exported for other modules (not on the facade): `verifyChainRange(tenantId, { resumeFrom?, anchorHash?, batchSize? })` in `audit_log.query` (the verifier with a resumable position, for incremental jobs), and `resolveActors(queryRunner, tenantId, rows)` / `actorRefsOf(...)` in `audit_log.actors`. A module that reads `audit_logs` directly (`tenant_export`, `tax`, the activity timelines) must call `resolveActors` once on its rows instead of reading `actorId` off the entity, or a sealed row shows no actor.

### Retention, lifecycle & tamper design

- **Per-tenant retention** is driven by the `auditLogRetentionDays` setting (0 = keep forever). `purgeExpired` enforces it.
- **Retention is enforced, and has been since 2026-10-06** (commit `9f11e196c`): the `common:boot_task` in this module's `module.json` registers `audit-log-purge`, which calls `scheduleAuditPurgeJob()` daily at 04:00 wherever `ENABLE_BACKGROUND_JOBS` is on. The earlier text of this README ("defined, never scheduled") was stale. The "irreversible first purge" owner decision recorded on 2026-09-25 was therefore effectively taken by that scheduler entry: the first sweep hard-deleted whatever each tenant's configured window covered, with `archive: false` and no exporter.
  - There is **no HTTP cron twin** (`POST /api/cron/audit-log-purge`) yet: a serverless deployment without a BullMQ consumer does not purge. Planned with the next wave.
  - The sweep covers `listActiveTenants()`; whether the fleet tenant belongs in it is an open question for the fleet audit floors (fleet chain >= 365 days, customer chain floor 90 days, progress-log Decision 22).
- **Automated purge** runs via the BullMQ job in `audit_log.purge.job.ts` (`scheduleAuditPurgeJob`, scheduled as above; `runAuditPurgeSweep` is the function a cron route would call). The sweep iterates all active tenants; keep-forever tenants are no-ops.
- **Archive-before-delete** is a pragmatic seam: `purgeExpired(..., exporter)` accepts an optional `AuditArchiveExporter` (`export(tenantId, ndjson, rowCount)`), so cold storage (S3/GCS/log aggregator) can be plugged in without the module hard-depending on any infra. Without an exporter, the NDJSON batch is returned to the caller.
- **Append-only hash chain** is the in-DB tamper-evidence. Every `log()` links `prevHash` to the previous row's `rowHash` per tenant; `verifyChain` detects any modification or deletion within the kept window. Appends are serialised by a per-tenant advisory lock (key `hashtext('audit_log:chain:' || tenantId)`, taken by the JavaScript writer and by the trigger alike), and each row is stamped strictly after the chain head (`max(now, head.createdAt + 1 ms)`). Before 2026-09-25 two writes in the same millisecond, or a pod with a lagging clock, tied or inverted the `createdAt` order that both the head lookup and `verifyChain` rely on, so an untouched trail could report tampering. Two hash versions exist; see "Hardened chain".
- **Separate write-once store** is documented as a design seam (see below) rather than implemented infra — the hash chain provides in-DB tamper-evidence today; the `AuditArchiveExporter` interface is the extension point for an external immutable store.
- **Soft-delete guard**: the entity uses a `DeleteDateColumn` (`deletedAt`) so accidental TypeORM deletes are soft and excluded from normal reads; only the retention purge performs hard deletes (after optional archive). The verifier and the trigger read soft-deleted rows too; the legacy JavaScript writer's head lookup does not (nothing soft-deletes an audit row).

#### Separate write-once store (design seam, not implemented)

The audit trail lives in the same per-tenant Postgres DB as application data, so a compromised app credential could in principle delete rows. Two layers mitigate this:
1. **In-DB tamper-evidence (implemented):** the per-tenant hash chain makes any row modification or deletion detectable via `verifyChain`.
2. **External write-once store (seam):** the `AuditArchiveExporter` interface is the integration point for shipping rows to an immutable destination (write-only DB user, immutable S3 bucket, or a log aggregator). Implement it and pass it to `purgeExpired` (or a custom sweep) to satisfy ISO 27001 A.12.4 / PCI-DSS Req. 10. No external infra is bundled. The S3 object-lock implementation, `REVOKE UPDATE, DELETE` for the runtime role and the anchored checkpoints are the next wave (see "Not yet").

### Severity, alerting & dual-actor

- **Severity/risk score**: `severityForAction(action)` resolves a severity from the `ACTION_SEVERITY` map in `audit_log.enums.ts` (unknown actions default to `low`). Severity is stored on the row and filterable in `getAll`.
- **Real-time high-risk webhook**: when a logged event is `high`/`critical`, `log()` fires a best-effort `audit.high_risk` webhook via `WebhookService.dispatchEvent`. A webhook failure never breaks the audit write.
- **Record sinks (`audit_log:record_sink`, phase 55 01 §1.4a)**: after a row's transaction committed, `log()` tells every sink of a module active for the tenant (`audit_log.record-sink.ts`, `notifyRecordSinks`): a detached fan-out of the frozen `WrittenAuditRecord` (actor ids in the clear, also on a sealed chain; a sink that stores what it hears covers that store with its own export and erasure). A sink that throws, rejects or never settles never delays or fails the write; a failed write tells no sink. `actions` narrows a sink. The AI firewall hears every row this way. A sink must not write an audit row per row it hears.
- **Dual-actor (impersonation)**: `onBehalfOfActorId` is an optional, additive column — `actorId` stays the TRUE actor (e.g. the platform admin) and `onBehalfOfActorId` carries the impersonated user. Callers that don't set it are unaffected.

### Async / queue-based writing

`log()` remains a resilient synchronous write (try/catch wrapped, never throws). For high-write tenants, the queue option is the same pattern as `audit_log.purge.job.ts` (BullMQ): enqueue the `CreateAuditLogInput` and process it in a worker that calls `log()`. This is left as a documented seam rather than a default to avoid hashing-order complications (the hash chain requires serialized, ordered writes per tenant).

---

## Hardened chain (Phase 5, part 1)

The owner decisions below were adopted on 2026-10-15 for fleet Phase 5 (D1 to D8 of the audit gap analysis; they are binding for the whole Phase 5 audit work, so they are recorded here where the code lives).

| # | Decision |
|---|---|
| D1 | The hardened chain is selected per tenant by a row in `audit_chain_policy`, default `legacy` for `FLEET_ROLE=single` (an unset role is `single`) and `sealed` for `node` and `fleet`. A standalone deployment behaves byte-for-byte as before until its operator opts in. |
| D2 | New sealed rows carry `hashVersion = 2` and hash a **declared column set computed in PostgreSQL**. v1 rows (JavaScript hash) stay as they are and are never rewritten; the verifier dispatches per row. |
| D3 | `REVOKE UPDATE, DELETE` from `app_runtime` ships in a **later release** than the functions, as an `expand` file, never `kind: contract` (a pending contract step makes `modules/db/scripts/db-deploy.ts` fail on every single-role deploy). Not part of this release. |
| D4 | The per-tenant actor-reference key is derived with HKDF-SHA256 from `SETTINGS_ENCRYPTION_KEY` (info `ndek-audit:<tenantId>`); `keyVersion` is stored on the mapping row. Required on `node` and `fleet`; absent on `single` means legacy. |
| D5 | Checkpoints live in a separate append-only table (`audit_chain_checkpoints`), not as `kind = CHECKPOINT` rows in `audit_logs`, so list, export, the UI, `tax` and `tenant_export` never see them. This deviates from the wording of doc 04 section 7. Next wave. |
| D6 | The covered column set adds `onBehalfOfRef` (the spec omitted it; `onBehalfOfActorId` was PII and was hashed). `ipAddress`, `userAgent` and `metadata` stay hashed and anonymisation will stop touching them; a write-time redaction of PII metadata keys replaces `scrubMetadata`. **Residual, documented:** `resourceId` and free-text metadata can still carry an identity (an invited e-mail, a user id as `resourceId`); erasure removes the actor, not every mention. |
| D7 | No rebase of legacy rows by default: they keep `actorId`, and legacy erasure keeps the old scrub behaviour in legacy mode only. An optional one-off rebase tool for sealed deployments is a later decision. |
| D8 | Migrations are per-module files `modules/audit_log/server/migrations/00N_*.sql` (the roadmap's 162/163 numbers are obsolete); function bodies live in one `-- repeatable: true` expand file; every index and constraint is mirrored in the entity decorators. |

### The two chains

| | legacy (v1) | sealed (v2) |
|---|---|---|
| Who hashes | `computeRowHash` in JavaScript, under the advisory lock | the `audit_chain_before_insert` trigger, under the same advisory lock |
| Writer | read head, hash, `save` (as before) | one `INSERT` (plus the identity mapping in the same transaction) |
| Actor in the row | `actorId`, `onBehalfOfActorId` | `actorRef`, `onBehalfOfRef` (HMAC pseudonyms); `actorId` is NULL and the database refuses a bare id |
| `createdAt` | JavaScript, `max(now, head + 1 ms)` | the trigger: UTC, millisecond, strictly after the head |
| Verified by | JavaScript | `audit_verify_chain()` in PostgreSQL |
| `commandJti` / `nodeId` | ignored (the v1 hash cannot cover them) | stored and hashed |

`log()` reads the tenant's mode (policy row, else the role default; cached 30 seconds per tenant; a policy that cannot be read keeps the last answer or falls back to the role default, and never throws). If a tenant is sealed while a writer still holds the cached `legacy`, the trigger refuses the hash the writer supplied and `log()` retries once with a fresh mode, so no write is lost.

**Sealed prerequisites.** A sealed write needs `SETTINGS_ENCRYPTION_KEY` (64 hex): without it the row is **not written** and the failure is logged (a row with a bare id would defeat the design; the node would rather lose the audit row than store the person). It also needs migration `audit_log:003`: the write checks that the trigger set `hashVersion = 2` and aborts the transaction otherwise, so a database without the trigger never stores an unhashed row silently. Making the key mandatory on `node` and `fleet` in the env schema is a shared edit (`modules/env`), not done here.

### The v2 hash

`audit_row_hash(prev, ...columns)` is the hex SHA-256 of `'audit.row.v2'` followed by the chain link and the covered columns, each as `<byte length>:<value>` (`~` for NULL), newline separated. Covered, in order (`audit_hash_covered_columns()` returns the list): `tenantId, actorId, actorRef, onBehalfOfActorId, onBehalfOfRef, actorType, action, severity, resourceType, resourceId, metadata, ipAddress, userAgent, createdAt, actorTenantId, commandJti, nodeId`. Left out on purpose: `auditLogId` (the key), `prevHash` (it is the chain link and enters as `prev`), `rowHash`, `hashVersion`, `deletedAt`. `audit_log.chain.integration.test.ts` fails when `audit_logs` gains a column that is in neither list, proves each covered column is covered by editing it, and pins a test vector: **the output of `audit_row_hash` for an existing input must never change.** A new algorithm is a new function, a new tag and a new `hashVersion`.

`actorId` and `onBehalfOfActorId` are covered too (NULL on every sealed row) so that an identity cannot be attached to a sealed row after the fact, and so a hash-less insert that carries an id (the demo seed on a legacy tenant) is still fully covered.

`metadata` is hashed as `jsonb::text`, which PostgreSQL normalises (key order, number format) regardless of the client. `createdAt` is hashed as `YYYY-MM-DD"T"HH24:MI:SS.US` of the stored `timestamp`, which the trigger writes in UTC. v2 is **never recomputed in JavaScript**: `timestamp without time zone` is parsed by node-postgres in the process time zone, which would make a JavaScript check wrong in any zone but UTC.

### The trigger

`BEFORE INSERT ON audit_logs FOR EACH ROW` (migration 003, function in 002):

- A row that arrives **with** `rowHash` is a v1 row (the legacy writer, an N-1 node): passed through untouched, `hashVersion` forced to NULL (a writer cannot claim v2). A **sealed** tenant refuses it with SQLSTATE `23514`.
- A row that arrives **without** one is chained: advisory lock (`hashtext('audit_log:chain:' || tenantId)`, the JavaScript writer's key, so a rolling deploy cannot fork the chain), head read **including soft-deleted rows**, `prevHash`, `createdAt`, `hashVersion = 2`, `rowHash`. A caller-chosen `createdAt`, `prevHash` and `hashVersion` are overwritten. A sealed tenant also refuses a bare `actorId` / `onBehalfOfActorId`.
- Functions pin `search_path` (`pg_catalog` first, then the schema the migration ran in, only known at apply time), are not `SECURITY DEFINER` (the trigger runs as the writer, so row level security still scopes what it reads), and `EXECUTE` is withdrawn from PUBLIC and granted to `app_runtime` / `app_admin`.
- Cost on a legacy tenant: one primary-key lookup on `audit_chain_policy` per insert.
- **Rolling back to N-1** stays safe (N-1 reads the head's `rowHash` and writes v1 rows after v2 rows), but N-1's own `verifyChain` cannot recompute v2 rows and reports them as broken: keep every tenant on the legacy chain until N-1 is gone.
- The lock key is built from the tenant id as PostgreSQL prints it (lower case). The JavaScript key uses the string it was given; callers pass lower-case uuids.

### Reading, erasing, verifying

- `actorRef = base64url(HMAC-SHA256(HKDF(SETTINGS_ENCRYPTION_KEY, info "ndek-audit:" + tenantId), actorId))`: 43 characters, different in every tenant. The mapping `audit_actor_identities` is the only way back; readers look a reference up and never recompute it, so a later move to the real `ndek-audit` key (a `keyVersion` bump) leaves every old reference resolvable.
- Erasure of a sealed actor is the withdrawal of that actor's identity from the mapping (`audit_anonymise_actor`, migration 004 + 005): no row and no hashed column changes, the chain keeps verifying and the actor becomes unresolvable, proven on a real PostgreSQL in `audit_log.chain.integration.test.ts`. The mapping row STAYS as a tombstone (`actorId` NULL, `erasedAt` set; a CHECK keeps the two in step): the writer inserts with `ON CONFLICT DO NOTHING`, so a deleted row would be re-created with the real id by the actor's next audit write and every old row would resolve to the person again. The function checks what row level security would have (the caller must be inside the tenant it names, or be the admin bypass), refuses a tenant that is not sealed, appends ONE `audit.anonymised` row (resource = the first erased pseudonym, metadata only counts, the person is named nowhere) and appends nothing when the actor was never mapped or is already erased.
- `verifyChain` pages by `(createdAt, auditLogId)`, includes soft-deleted rows, treats an unknown `hashVersion` as broken, and can start at a checkpoint head (`anchorHash`) or resume from a verified position (`resumeFrom`).

### Known defects (characterised by tests, not fixed here)

1. **Verification after a retention purge.** `purgeExpired` deletes the oldest rows without recording a checkpoint, so the first kept row names a predecessor that is gone and `verifyChain` reports it as tampering. The verifier now accepts the purged head as an anchor (`anchorHash`); the checkpoint that records it is next wave.
2. **Legacy erasure breaks the chain**: it rewrites hashed columns without re-hashing.
3. **v1 rows verify only in the time zone that wrote them** (`timestamp without time zone` plus node-postgres local parsing). v2 does not have this limit.
4. The legacy writer's head lookup skips soft-deleted rows (nothing soft-deletes an audit row).

### Retention checkpoints (sealed chains)

A sealed chain is purged only through the database: `audit_chain_checkpoint(tenant)` (migration 007) records how far a purge may go and deletes nothing, `audit_chain_purge(tenant)` deletes the rows the newest checkpoint covers and no others. Both are SECURITY DEFINER with a pinned search_path, closed to PUBLIC, take the chain's advisory lock, check the caller is inside the tenant (or the admin bypass), refuse a tenant whose policy row says `legacy`, and take no argument but the tenant: there is no "now" and no cutoff a caller could use to widen a purge.

A checkpoint covers a row only when the row is (1) older than `audit_chain_policy."retentionDays"` (a table the platform operator writes, never a tenant setting; NULL or no policy row keeps everything) AND (2) at or before a chain head the control plane has acknowledged (`audit_chain_anchors`): nothing that nobody outside the node has witnessed ever disappears. It records the last covered row, the hash that row had (what the first kept row must link to), the rows covered and the running total. The verifier then starts from the newest checkpoint (`latestCheckpointHead` as `anchorHash`) and accepts exactly that link; the weekly `audit-chain-verify` job does so for a checkpointed tenant and keeps its looser one-link forgiveness only for a legacy tenant with a retention setting.

`purgeExpired` on a sealed tenant is: checkpoint, then the optional archive of exactly the covered rows (the stored, pseudonymous rows, never a resolved identity), then the purge. A failing exporter stops before the delete; the checkpoint stays and the next run finishes it. Honest limit: `audit_chain_anchors` has no writer yet (audit hardening item 13, the anchoring seam), so until it has one a sealed chain is never purged.

### Append-only for the application

`migrations/manual/append-only-enable.sql` withdraws from `app_runtime` the privileges that would let the application rewrite or erase the trail: UPDATE, DELETE and TRUNCATE on `audit_logs`, `audit_actor_identities` and `audit_chain_anchors`, and every write on `audit_chain_checkpoints` and `audit_chain_policy` (checkpoints are written only by `audit_chain_checkpoint()`, a tenant's chain mode only by the platform operator). INSERT and SELECT stay where the writer needs them. It is a MANUAL file, like `rls-force-enable.sql`: the numbered runner never applies it, because the legacy chain's JavaScript purge and erasure UPDATE and DELETE `audit_logs`, so it belongs on a node whose tenants are all sealed. `append-only-disable.sql` restores the grants. `audit_append_only_status()` (migration 008, `getAppendOnlyStatus()`) reports per relation whether the runtime role still holds a forbidden privilege (`writable`), and `enforced` is true only when none does. The guarantee is only real on a node that connects as a non-owner member of `app_runtime`: the table owner and a superuser are outside every table privilege.

### Honest limits

- The table owner and any superuser are outside every table privilege and, until RLS is forced, outside the policies. The privilege story (`REVOKE`, `audit.append_only`) is only true on a node that connects as a non-owner member of `app_runtime`.
- `audit_chain_policy` is protected by the generated tenant policy only: until the append-only `REVOKE` ships, a database login that can run arbitrary SQL inside its own tenant could downgrade that tenant to legacy. There is no application writer for the table in this release; operators set a row with SQL (`INSERT INTO audit_chain_policy ("tenantId", "mode") VALUES ('<uuid>', 'sealed') ON CONFLICT ("tenantId") DO UPDATE SET "mode" = EXCLUDED."mode"`), and a running process picks it up within 30 seconds.
- A sealed chain does not by itself make the trail tamper-proof against the database owner; the anchoring of chain heads to the control plane (attestation) is what does.

### Not yet (next wave; the schema is shaped for it)

Items 11, 13 (the anchoring seam is delivered end to end; only a compliance consumer is missing) and 14 of the audit hardening plan (items 8, 9 and 10 shipped: see above, "Retention checkpoints" and "Append-only for the application"): `audit_chain_checkpoints` and `audit_chain_anchors` plus the gated purge functions and the `audit_chain_policy` retention columns (added with `ADD COLUMN IF NOT EXISTS`), the append-only `REVOKE` file and `audit_append_only_status()`, the purge cron route and archive-by-default on sealed tenants, the weekly `audit-chain-verify` job (the verifier already returns a resumable position), the anchoring seam for the attestation area, and the S3 object-lock `AuditArchiveExporter` (contributed from `storage` through an extension point).

---

## Types & Enums

| File | Exports |
|---|---|
| `audit_log.types.ts` | `AuditLogSchema` / `AuditLog` — the parsed read shape (the hardened-chain fields are optional and present only on rows that carry them), `ChainVerificationResult`, `ChainPosition`, `ChainVerificationDetail`, `AuditArchiveExporter`. |
| `audit_log.mode.ts` | `defaultChainMode(role)`, `resolveChainMode(tenantId)` (cached 30 s, never throws), `invalidateChainMode(tenantId?)`. |
| `audit_log.actor-ref.ts` | `deriveActorRef(masterKeyHex, tenantId, actorId)` and `ACTOR_REF_KEY_VERSION`. Pure. |
| `audit_log.actors.ts` | The read side of the pseudonyms: `resolveActors`, `actorRefsOf`, `toAuditLog`. |
| `audit_log.sql.ts` | `auditSqlNames(queryRunner)`: schema-qualified table and function names for the module's hand-written SQL. |
| `audit_log.dto.ts` | `CreateAuditLogDTO` (now incl. optional `onBehalfOfActorId`, `severity`, and `commandJti` / `nodeId` for SERVICE actors, which only the sealed chain stores), `GetAuditLogsDTO` (incl. `severity`, `fromDate`, `toDate`), plus `PurgeAuditLogsDTO`, `ExportAuditLogsDTO`, `AnonymizeActorDTO`, `CrossTenantAuditQueryDTO`. `pageSize` accepted up to the hard cap `500` (default `20`); the effective per-tenant cap (default `100`) is enforced in `audit_log.query.ts`, not here. Input types use `z.input` so raw ISO date strings are accepted. |
| `audit_log.enums.ts` | `AuditActorTypeEnum` (`USER` \| `SYSTEM` \| `API_KEY` \| `SERVICE`), `AuditSeverityEnum` (`low`\|`medium`\|`high`\|`critical`), `HIGH_RISK_SEVERITIES`, the `AuditActions` constant map + `AuditAction` union, the `ACTION_SEVERITY` map, and `severityForAction(action)`. |
| `audit_log.setting.keys.ts` | `AuditLogSettingKeySchema` (Zod enum) + `AUDIT_LOG_SETTING_KEYS` (`auditLogRetentionDays`, `auditLogMaxPageSize`), `RETENTION_KEEP_FOREVER`, `AUDIT_LOG_DEFAULT_MAX_PAGE_SIZE` (100), `AUDIT_LOG_PAGE_SIZE_HARD_CAP` (500). |
| `audit_log.settings.fields.ts` | `AUDIT_LOG_SETTINGS_FIELDS` — admin-UI metadata consumed by `ModuleSettingsPage`. |
| `audit_log.purge.job.ts` | BullMQ retention-purge sweep: `auditPurgeQueue`, `startWorker` (the consumer, started by `scheduleAuditPurgeJob`, never at import), `scheduleAuditPurgeJob`, `runAuditPurgeSweep`. |
| `audit_log.messages.ts` | `AuditLogMessages` error/status strings. |
| `audit_log.seed.ts` | `seedAuditLog(ctx)` — idempotent demo seed (login, failed login, settings change, subscription assignment, invitation, file upload) keyed on `tenantId + action + resourceId`. Its rows carry no hash; the trigger chains them (and assigns `createdAt`, so the `daysAgo` history is no longer backdated). |

`AuditActions` is a non-exhaustive catalog — domains may pass any non-empty `action` string; the constants exist for consistency.

---

## Writing a Log

```typescript
import AuditLogService from '@/modules/audit_log/audit_log.service';
import { AuditActions } from '@/modules/audit_log/audit_log.enums';

await AuditLogService.log({
  actorId: userId,
  actorType: 'USER',
  action: AuditActions.INVITATION_SENT,
  resourceType: 'tenant_invitation',
  resourceId: invitation.id,
  tenantId,                              // omit for platform events → ROOT_TENANT_ID
  ipAddress: request.ip,
  userAgent: request.headers['user-agent'],
  metadata: { invitedEmail: dto.email },
});
```

---

## Querying Logs

```typescript
const { logs, total } = await AuditLogService.getAll({
  tenantId,
  page: 1,
  pageSize: 20,
  actorId: userId,                       // optional
  action: 'invitation',                  // optional — partial (ILike) match
  resourceType: 'tenant_invitation',     // optional
  resourceId: invitation.id,             // optional
});
```

---

## API Routes

| Method | Path | Scope | Description |
|---|---|---|---|
| GET  | `/tenant/[tenantId]/api/audit-logs` | tenant `ADMIN` | List logs. Query params: `page`, `pageSize`, `actorId`, `action`, `severity`, `resourceType`, `resourceId`, `fromDate`, `toDate`. |
| POST | `/tenant/[tenantId]/api/audit-logs/purge` | tenant `ADMIN` | Run the retention purge. Body `{ archive?: boolean }`. |
| GET  | `/tenant/[tenantId]/api/audit-logs/export` | tenant `ADMIN` | Bulk export. Query: `format=csv|ndjson`, `actorId` (per-user SAR), `fromDate`, `toDate`. Streams a file download. |
| POST | `/tenant/[tenantId]/api/audit-logs/anonymize` | tenant `ADMIN` | Right-to-erasure. Body `{ actorId }`. |
| GET  | `/tenant/[tenantId]/api/audit-logs/verify` | tenant `ADMIN` | Verify the hash chain → `{ ok, checked, brokenAt }`. |
| GET  | `/tenant/[tenantId]/api/audit-logs/cross-tenant` | **root** `ADMIN` | Cross-tenant aggregated view (rejects non-root). Query: `action`, `severity`, `fromDate`, `toDate`, `limit`. |

All handlers authenticate via `TenantSessionNextService.authenticateTenantByRequest({ requiredTenantRole: "ADMIN" })` behind the rate limiter and propagate `AppError.statusCode`. On the root tenant the list endpoint surfaces platform-wide audit logs (rows written with `ROOT_TENANT_ID`); the cross-tenant endpoint is gated to the root tenant in the service via `isRootTenant`.

---

## Settings

Per-tenant settings (Zod-enumerated in `audit_log.setting.keys.ts`, edited via the admin page at `app/tenant/[tenantId]/admin/(tenant-scope)/audit-logs/settings/page.tsx` using `ModuleSettingsPage`):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `auditLogRetentionDays` | number | `0` | Days to keep audit rows before the retention purge deletes them. `0` = keep forever (the historical behaviour). |
| `auditLogMaxPageSize` | number | `100` | Upper bound on `pageSize` a caller may request from `GET /audit-logs` for this tenant. Unset/invalid falls back to `100` (the historical fixed cap); the effective value is always clamped to a hard cap of `500` (`AUDIT_LOG_PAGE_SIZE_HARD_CAP`). Enforced in `audit_log.query.ts#resolveMaxPageSize`, not in the Zod DTO (which only bounds the request to the hard cap). |

Logging itself remains unconditional and uniform; only retention and the listing pageSize cap are configurable.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

An append-only audit trail that persists sensitive-action events per tenant (writing to and reading from each tenant's own DB via tenantDataSourceFor, with platform-level events falling back to ROOT_TENANT_ID), but it exposes no per-tenant settings or per-tenant behavioral branching today.

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `AuditLog` | `audit_logs` | actorId, actorType, action, resourceType, resourceId, metadata, ipAddress, userAgent |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `audit_log.service.ts:log/getAll` — Both methods resolve the row's tenantId (defaulting null/omitted to ROOT_TENANT_ID for platform events) and open that tenant's data source via tenantDataSourceFor(tenantId), so each real tenant writes to and reads back its own isolated audit table; getAll filters strictly by that tenantId so a tenant only ever sees its own logs. This is routing/isolation rather than configurable per-tenant logic.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Audit-log retention is unbounded and uniform: log() always inserts and getAll() never prunes or applies any age cutoff, so every tenant keeps all audit rows forever with no per-tenant policy. | `audit_log.service.ts (AuditLogService.log / AuditLogService.getAll)` | Compliance and storage needs differ per tenant (e.g. a regulated tenant may require 7-year retention while another wants 30-day purge); a per-tenant retention window would let each tenant control how long their audit trail is kept. Currently hardcoded to keep-forever for everyone. | `auditLogRetentionDays` |
| Maximum query page size is hardcoded to 100 in GetAuditLogsDTO (pageSize max), applied identically to all tenants. | `audit_log.dto.ts (GetAuditLogsDTO.pageSize)` | Export/reporting-heavy tenants may want a larger page cap while others stay small; this is a global hardcoded limit that could plausibly be a per-tenant override, though it may be intentionally global as a safety bound. | `auditLogMaxPageSize` |

---

## Plan entitlement (`audit_logs`)

The list (`GET /api/audit-logs`) and the export refuse with 403 when a live plan
explicitly says `audit_logs: false`.

**The recorder is never gated.** A tenant on any plan keeps accumulating
history: an audit trail is a security control, and a lapsed subscription that
stopped it would make the period around a downgrade — exactly when an account is
most likely to be in dispute — the one period with no record. A refused read is
reversible the moment the tenant upgrades; a gap is not.

Also deliberately open:

| surface | why |
|---|---|
| `purge`, `anonymize` | erasure duties (GDPR Art. 17, retention). Gating them would trap a tenant holding data it is legally required to delete |
| `verify` | returns an integrity verdict, not history. A tenant should always be able to establish that the record we hold is intact |
| `cross-tenant` | a platform-operator surface behind its own permission, not something a tenant plan sells |

A plan that never mentions the key is not a refusal, and a feature-gate error
fails open.

## Dependencies

Requires `db` (per-tenant DataSources via `tenantDataSourceFor`), `env` (`FLEET_ROLE`, `SETTINGS_ENCRYPTION_KEY`), `logger`, `tenant` (the RLS functions its migrations use) and `tenant_setting`, `webhook`. Does NOT require `storage`: the S3 archive exporter will be contributed from `storage` through an extension point (AGENTS.md section 10), never imported here.
