# session_end — orders that end a session, never lost to a Redis outage

Ending a device's MQTT session or a person's websocket is an order to the gateways over Redis: a kick on `iot:kicks`, a drop on
`ws:control:stream`. Before 2026-11-03 such an order was written after the change and only logged when Redis refused it, so a
deleted device or a revoked session could stay connected (docs/audits/2026-11-03-redis-outage.md). This module is the
transactional outbox in front of those streams (decisions D243, D244).

## How an order travels

1. **Recorded with its cause.** `recordOrders(inputs, { qr })` inserts the rows in the cause's transaction when it runs on the shared
   database; a tenant with a database of its own gets a shared-database transaction opened and committed inside the cause's (if the
   change commits the order exists; a change that then rolls back closes a session for nothing, never leaves one open). A caller with
   no transaction to join uses `endSessions(inputs)` (record, then deliver; when the database will not record it, the order is
   written to Redis directly and the error thrown for the caller's retry).
2. **Fast path.** `deliverRecorded(orders)` right after the commit: each order delivered (2-s timeout) and its row deleted; a failure is
   logged and left to the relay. Never throws.
3. **Relay.** `relayOrders()` every 5 s (`session_end.relay.ts`, a timer in every process with background jobs, phase `scheduler`,
   `parallel`; HTTP twin `POST /api/cron/session-end-relay`, Bearer `CRON_SECRET`): the due rows of every tenant, oldest first, locked
   `FOR UPDATE SKIP LOCKED`. A Redis that does not answer PING costs no attempt. A refused delivery backs off (2 s doubling to 60 s);
   after 50 attempts, or with a payload that cannot be delivered, the row is a dead letter (`deadAt`), kept for an operator.
4. **Once.** The stream entry carries the row's id as `oid`; the readers (`iot_gateway` kick listener, `websocket` control-stream
   reader) act on an `oid` once.

An order is generic (`session_end.contract.ts`): keys to `INCR` + `EXPIRE` (a credential-cache generation), keys to `DEL`, then
`XADD <stream> MAXLEN ~ <n> * <field> <entry + oid>`. The relay needs no producer code to deliver it.

## Inside a host's transaction (D249)

A change that ends a person's access lives in a module that must not depend on the gateways' modules (`user_session`, `tenant_member`,
`tenant` sit upstream of `websocket_session`). Such a host calls `recordSessionEndInTx(qr, cause)` (`session_end.in-tx.ts`) with its
OPEN transaction before it commits, and `afterCommit()` after:

- `cause` is ids only: `sessions_revoked` (the sessions), `member_access_ended` (`membership_ended` / `access_changed`),
  `tenant_access_ended` (`suspended` / `deletion_requested` / `purged`).
- Each tenant's contributions to **`session_end:order_source`** (hook, `aggregate`, gate `data`, 2 s; default export
  `SessionEndOrderSource`, `ordersFor(cause) => SessionEndOrderInput[]`) answer the orders. They only build them: no database, no Redis,
  never the host's transaction. An order that names another tenant, or could never be delivered, is refused.
- `recordOrdersInTx(qr, inputs)` writes them: on the shared database under a savepoint, with `app.current_tenant` set to the order's
  tenant for the insert and the host's own setting put back; on a tenant's own database, a shared-database transaction committed before
  the host's (D243).
- Nothing a satellite does blocks the host: a contribution that fails or answers something invalid, and a refused insert (rolled back
  to the savepoint), are logged, counted (`session_end_in_tx_total{outcome="recorded|fallback"}`) and left out of `orderedBy(tenantId)`.
  The host passes `orderedBy` to its after-commit hooks as `sessionEndOrderedBy`; a module named there skips, a module not named records
  after the commit as before. Only `HostTransactionBroken` (the savepoint cannot be rolled back to) is thrown.

## Cache drops and the cache guard (D253)

A change that must end access through a CACHE (an API key revoked, an ABAC policy or a role set written) records a **cache drop**
(`cacheDropOrders` in `session_end.cache-guard.ts`): an order on the log stream `session_end:cache_drops` (MAXLEN ~1000, nothing reads it)
whose real work is its steps: the entries to `DEL` and the namespace versions to `INCR` (TTL 7 days). It is recorded in the change's
transaction like any order, but due at once (no fast-path grace: a second delivery is one more cache miss), so another node's relay
delivers it while the writer cannot reach Redis.

The guarded caches (`api_key`, `auth_abac`, `tenant_member`'s role set) read through the guard:

- `readGuarded(keys, versionKeys)` reads the entry and its versions together (one round trip) and the instance id (`redis.health.ts`);
  `stampOf(read)` is `<instance>|<version>…`, or null (Redis untrusted, a version missing); `openEntry(raw, stamp)` returns the data only
  of an entry sealed with exactly that stamp;
- `noDropPending(tenantId)`: no pending (or, for an hour, dead-lettered) cache drop of the tenant in this process's view of the outbox,
  re-read at most once a second (`PENDING_VIEW_MS`; one indexed query); an unreadable outbox, or over 1000 pending tenants, trusts nobody;
- `stampForWrite(read)` + `writeGuarded(...)`: a refill is sealed with the versions read BEFORE its database read (a missing version is
  created with `SET NX`, or the refill is not cached), and nothing is cached while a drop is pending or Redis is untrusted.

The bound: with Redis up, a drop is applied before the writer's request returns. With the writer cut off from a Redis the readers reach,
the readers stop believing the tenant's entries within one outbox view (about a second) and a relay delivers the drop at its next pass.
After Redis comes back with old data, an entry of the old instance is never believed, and one that looks current is not believed while
its drop is pending. Tests: `session_end.cache-guard.test.ts`, the lanes `api_key.redis-outage.test.ts`, `auth_abac.redis-outage.test.ts`.

## Producers

| Module | Orders |
|---|---|
| `iot_device` | device kicks (rotate, set, revoke, disable, rename, update, delete, quarantine release, firewall kick) with their cache bust; tenant kicks (suspended, deletion requested, purged) |
| `iot_device_profile` | profile kicks (edit, delete) |
| `api_key`, `auth_abac`, `tenant_member` | cache drops (D253): an API key changed, a policy written, a role set written |
| `tenant_setting` | cache drops (D270): every setting write (`settings:<t>:all` deleted, `settings:<t>:gen` bumped; auth_abac's runtime settings seal with it) |
| `tenant` | cache drops (D270): every status move of a tenant (`tenant:id:<t>`, `tenant:route:<t>` deleted, `tenant:ver:<t>` bumped; `getById` is guarded) |
| `websocket_session` | `disconnect_user` / `disconnect_tenant` (session revoked, membership ended, access changed, tenant suspended / deleting / purged), through `session_end:order_source` inside the host's transaction (D249); its after-commit hooks are the fallback |

## Watching it

- Metrics (scrape time): `session_end_orders{state="pending|dead"}`, `session_end_orders_oldest_pending_seconds`,
  `session_end_in_tx_total{outcome="recorded|fallback"}` (D249: orders written with the change; contributions left to their
  after-commit path, each one also an error log line).
- Health: `session_end` is `degraded` with a pending order older than a minute or any dead letter.
- Alerts (`observability:alert-source`, root tenant only): `session-end-orders-stale` (MAJOR, opens an incident under the default
  policy), `session-end-orders-dead` (CRITICAL). The relay also logs an error once a minute while either holds.
- A dead letter: `SELECT * FROM session_end_orders WHERE "deadAt" IS NOT NULL` (as the platform admin). Fix the cause (usually a key
  of the wrong type on the stream), then `UPDATE session_end_orders SET "deadAt" = NULL, "attempts" = 0, "nextAttemptAt" = now()` to
  have it relayed again.

## Data

`session_end_orders` (migration 001): on the shared database only (`@SharedDatabaseOnly`), tenant-keyed, the generated RLS policy pair,
FORCE from birth. Rows are written in their tenant's context; the relay, the counts and the alert read and change them under the
system context. A row lives seconds normally; nothing in it is personal data beyond the ids the gateways need (tenant, device, user,
session). `tenant:rekey` rewrites the tenant ids in `payload`.

## Deploy

Migration 001 before the release. The relay runs where `ENABLE_BACKGROUND_JOBS=true`; without background jobs, call the cron twin on
the root tenant every minute. Tests: `server/tests/session_end.orders.test.ts`, `session_end.in-tx.test.ts`, `session_end.cron.security.test.ts`, the
real-Postgres + scratch-`redis-server` lane `session_end.redis-outage.test.ts` (`SECURITY_TEST_LIVE=1`), and the in-transaction lane
of a real revocation, `user_session/server/tests/user_session.revocation-tx.live.security.test.ts` (`SECURITY_TEST_LIVE=1`).
