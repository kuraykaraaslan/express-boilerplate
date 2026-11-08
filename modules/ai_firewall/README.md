# AI firewall (`ai_firewall`)

Core module. One security brain over the platform's existing controls (docs/phases/55-ai-firewall). This first slice is the
**model runtime**: the two tree models of the request cascade, evaluated in TypeScript inside the module, and the cascade's decision.
Beside it sits the first page, **Platform -> AI firewall** (the activity page). Signals, features, the responder and the other
pages follow in phases 00–03 and 05.

Edition `core`, tier `platform`, placement `core`. Requires only Core modules: `common`, `audit_log`, `auth_abac`, `db`, `i18n`, `ip_subnet`,
`limiter`, `logger`, `observability`, `redis`, `tenant`, `tenant_setting`, `user_session`, `webhook`.

## The activity page (`/admin/platform/ai-firewall`, root super-admin)

One request per load, `GET /api/ai-firewall/activity` (GLOBAL scope, permission `ai_firewall.activity.read`, ADMIN floor), polled every
30 s while the tab is visible. Plain sections on one page, every list a DataTable:

- **Models**: for the behaviour (LightGBM) and attack (XGBoost) stage, `loadShippedModel(name)`: loaded (library and version, trained
  at, feature count, the gate's state and the shadow start) or off with the reason. Today both are `absent`.
- **Cascade mode**: `cascadeMode` (`server/ai_firewall.cascade-mode.ts`): `off` with no model loaded, `shadow` while a model is loaded
  but not both stages are loaded and promoted, or both are but a kill switch holds (`kill_switch`), `enforcing` only with both promoted by
  the gate for the files this process loaded and no kill switch (04.7, D55-113).
- **Promotion gate** (04.7, 4.9): each model's state (shadow, promoted, held), its last verdict criterion by criterion and its weekly drift
  report, from the promotion store; the ROOT owner's hold and release (below).
- **Security activity across every tenant** from the audit log (`AuditLogService.actionActivityCrossTenant`): per security action, the
  rows of the last 15 min, 1 h and 24 h, and the newest 50 rows with safe fields only (time, tenant, action, severity, actor id, address,
  a short target; never metadata). The actions are the default alert rules' (`audit_log.security-alerts.ts`) plus `permission.denied`,
  `auth.login_anomaly`, `security.global_admin_access` and `tenant.session.geo_anomaly`, `api_key.verify.failed`,
  `api_key.anomaly.detected`, which `tenant_session` and `api_key` write as literals (named through AuditActions since phase 55 00.4,
  never imported from the writers).
- **Active address bans** (`IpStrikeService.listBans`, SCAN over `ip-ban:*`, bounded), the one that ends last first.

A store that is down blanks only its own section (`unavailable`); the rest of the page still shows.

## Signal intake (01 §1.2–1.4)

Every signal reaches the firewall in one shape, `SecuritySignal` (`common/server/common.firewall-contracts.ts`: id, at, tenantId or null for
the platform, lane, kind, actor, subject, outcome, severity, attrs, source). Strings a request controls are truncated to 256 characters
and wrapped as `{ untrusted: true, text }`. The contract also holds the shapes of the points this module will declare
(`FirewallActionContribution` with a required `undo`, `FirewallActionResult`, `HoneytokenContribution`, `FirewallAnalyst`), so a
contributor imports `common`, never this module.

Three intakes, all fail open (FWA-7); the consumer of §1.7 (below) stores what they write:

| Intake | How | Kind |
|---|---|---|
| Audit rows | `server/intake/ai_firewall.audit-sink.ts` on `audit_log:record_sink` (every row, after it committed, detached); the actor is the key, the person or the node of the row, else the record the kind declares (`systemRowActor`, D443: a gateway's created and refused children fold on the gateway as a `device`), else the address or `anon` | the audit action (`auth.login_failed`) |
| Domain events | `server/intake/ai_firewall.event-sink.ts` on `webhook:event_sink` (every event but `audit.*`; payload identifiers and codes only) | `event.<name>` |
| Not audited, high volume | `emitSecuritySignal()` from the producing module (a misbehaviour division, a decoy touch, an accepted invitation) | the producer's |
| Not audited, once per request under attack | `tallySecuritySignal()` (`common/server/common.firewall-tally.ts`, 02.6, D55-57): counted in process, ONE signal per key (kind, tenant, lane, actor, subject, outcome, severity and its code attributes) every 10 s with `count` and `windowSeconds`, through `emitSecuritySignal`; at most 1 500 keys a window, 600 per kind, 300 of them kept for `high` and `critical` signals, an occurrence of a further key dropped and counted (`ai_firewall_signal_tally_overflow_total{budget}`), a flush never handing the intake more than its buffer takes (the rest carried, D55-66, D55-67); a few microseconds per call (micro-benchmark test). Rate-limit refusals, CSP reports, refused callbacks and refreshes, codes and verification mails sent, authenticator setups, unknown invitation tokens, blocked sign-ups | the producer's |

All three end in `emitSecuritySignal()`: synchronous, never throws, a bounded buffer per process (2 000, the last 200 of it only for `critical` signals such as a decoy touch, D55-66), written every 50 ms (or at 200)
as one pipeline of `XADD fw:signals MAXLEN ~ 100000 * v 1 s <json>`. A signal that is invalid, too large, finds the buffer full, finds
Redis not ready or is refused by it is dropped and counted, never retried: `ai_firewall_signals_dropped_total{reason}`, beside
`ai_firewall_signals_written_total` and `ai_firewall_signals_buffered` (`server/intake/ai_firewall.intake-metrics.ts`, a runtime boot task:
observability's registry in the web process, process_host's in the worker). The mapping of rows and events is
`server/intake/ai_firewall.signal-mapping.ts` (ROOT tenant = platform, `tenantId` null).

## Storage and the consumer (01 §1.7)

Three tenant tables (migration `server/migrations/001_ai_firewall_store.sql`, entities in `server/entities/`), tenant RLS (the generated
policy pair of tenant migration 127, and FORCE from birth):

| Table | What | Retention |
|---|---|---|
| `ai_firewall_events` | One row per stored `SecuritySignal`, append-only. Key (`tenantId`, `at`, `signalId`). A TimescaleDB hypertable through `db:time_series` (1-day chunks, behind `ai_firewall_events_v`, a 365-day chunk-drop backstop); a plain table with a BRIN index where TimescaleDB is absent | by `at` |
| `ai_firewall_incidents` | One row per incident (03): an actor's signals as one case | closed ones by `closedAt`; an open one never |
| `ai_firewall_actions` | One row per action proposal (05): `proposed` -> `executed` -> `undone` / `expired`, or `rejected`, `refused`, `failed`, `noop` (`canTransition`) | ended ones by `endedAt`; a waiting or running one never |

**The platform** (a signal's `tenantId` null) is stored under the ROOT tenant's id: the hypertable key cannot hold a NULL tenant, and the
policy pair then shows those rows to the ROOT tenant only (a NULL row would be visible to every RLS-bypassing system read and to no tenant).
`storeTenantOf` / `signalTenantOf` (`server/store/ai_firewall.store.ts`) map between the two.

**The consumer** (`server/store/ai_firewall.signal-consumer.ts`, a `scheduler` boot task with `parallel: true`: every worker process, the
consumer group `ai-firewall-store` shares the entries): every second it reads `fw:signals` without blocking (up to 500 entries, again at
once while full batches come, at most 10 reads a turn), checks each entry again as data (`parseSecuritySignal`, a uuid tenant), keeps one
row per signal id, writes one transaction per tenant on the tenant's own DataSource (`INSERT … ON CONFLICT DO NOTHING` through the
access view, so a redelivery stores nothing twice) and acknowledges after the write. A malformed entry is acknowledged at once and
counted, never retried. Only a tenant that exists is stored (D55-71): the tenants of a read are checked against the tenants table (one
query for the ids not in the process cache, a minute each way), and the entries of a tenant that does not exist (an anonymous producer
stamps the URL's tenant segment) are acknowledged unstored and counted as `unknown_tenant`. A write that throws leaves its entries pending: claimed again after 60 s by any worker, at most 5 times, then
acknowledged unstored and counted. Nothing is deleted from the stream (the writer caps it; the feature store of 02 reads it with a group of
its own). Series on the worker's `/metrics`: `ai_firewall_store_signals_total{result=stored|duplicate|malformed|dropped|unknown_tenant}`,
`ai_firewall_store_write_failures_total`. The kinds are not checked against `ai_firewall:signal` yet (the kinds are registered since 1.6; counting the unregistered ones is
02's): every well-formed signal is stored.

**Retention** (`server/store/ai_firewall.retention.job.ts`, nightly at 03:50, the leader only): per tenant the setting
`aiFirewallRetentionDays` (7..365, default 90; `server/ai_firewall.settings-policy.ts`; the ROOT tenant's value for the platform's rows),
deleted in batches of 5 000 rows, one transaction each, at most 100 batches per table and tenant per run. Tenants under a legal hold,
migrating or relocated are skipped (`tenant.sweep`). The setting is owned by this module (`tenant_setting.key-owners.ts`): the generic
settings API reads and writes it only with `ai_firewall.settings.manage` (ADMIN). Its settings page comes with 01 §1.8.

**Personal data** (actor ids: user ids and addresses; subject ids; the address and user agent in `attrs`; `closedBy`, `decidedBy`,
`undoneBy`; the feature store's baselines, D55-27): `tenant_export:collection` (`aiFirewallEvents`, the newest 10 000; `aiFirewallIncidents`;
`aiFirewallActions`; `aiFirewallBaselines`, whose actor key and countries, ASNs and devices `redactPii` takes out; with
`redactPii` redaction follows the personal-data classes the kinds declare in `ai_firewall:signal` (`server/ai_firewall.personal-data.ts`):
an event keeps only its `none` attributes, an unregistered kind none; person, credential and address actor ids, person subject ids, the
deciders `closedBy` / `decidedBy` / `undoneBy` (D55-19) and an action's undo data are blanked; `ipAddress` is blanked by the export),
`privacy:erasure` (D55-13: the person's own events, as the user or through one of their session rows whatever their status, expiry or
idleness (user_session `sessionIdsOfUser`, D55-18), deleted; events about them, whatever the subject type, lose the subject and its identifier / contact /
content attributes; any other event loses an attribute holding their user id or e-mail; incidents and ended actions anonymised; an action
still waiting or in force is retained until it ends; an address or API-key actor's rows stay; the person's baseline deleted by the keyed hash of
the user id), `tenant:purge_step` (all four tables).

The activity page does not show stored events yet: a cross-tenant section of its own (types, service, a DataTable, strings) is more than
one small change, and comes with the pages of 01 §1.8 / 05.7.

## The registries (01 §1.5)

Four points, declared here, each contributed from the owning module's own folder with the shapes of
`common/server/common.firewall-contracts.ts` (a contributor imports `common`, never this module; this module imports no contributor):

| Point | Pattern | A contribution is | `metadata` |
|---|---|---|---|
| `ai_firewall:signal` | catalog, `lazyContributors` | `FirewallSignalContribution` (or an array): kind, lanes, actor kinds, outcomes, severity, default weight, `attrs` with a personal-data class each (`none`, `identifier`, `network`, `device`, `location`, `contact`, `content`) | `label`, `ids` (the kinds), `routes` (the human auth routes they record) |
| `ai_firewall:action` | catalog, `lazyContributors` | `FirewallActionContribution` (or an array): id `<module>.<verb>`, rung, lanes, actor kinds, TTL, minimum mode, hourly budget, evidence, `execute`, `undo` | `label`, `ids` |
| `ai_firewall:honeytoken` | catalog, `lazyContributors` | `HoneytokenContribution` (or an array): id `<module>.<decoy>`, kind, label (and description) key, `detector.signalKind` (critical), `plant(tenantId)` -> `{ ref, bait?, where? }` | `label`, `ids` |
| `ai_firewall:analyst` | select, fallback none | `FirewallAnalyst` (Pro `ai`, 06) | `label` |

`ids` is `uniqueMetadata`: the snapshot refuses an id two manifests list. **The boot guard** `ai-firewall-registries`
(`server/registry/ai_firewall.registry.ts`, a `common:boot_task` of phase `guard`) loads every contribution in a system context and
refuses the boot (exit 1, before anything serves) on any problem `server/registry/ai_firewall.registry.validate.ts` finds:

- signal: a kind registered twice; an attribute without a personal-data class; a malformed declaration; `ids` that differ from what
  the export registers;
- action: no `undo` (FWA-4); a human rung (`step_up`, `end_session`, `end_all_sessions`, `lock`) on a machine or device lane, a step-up on a
  lane whose `LANE_POLICY.stepUp` is off, an address actor on a lane that never bans addresses (FWA-6: a lane is a person's when the limiter
  keys it per address); `ttl.maxMs` above `FIREWALL_ACTION_TTL_CAP_MS` (30 days); `end_all_sessions` / `lock` without evidence bound to the
  actor (FWA-5); an evidence kind no signal contribution registers; an id that names another module; a duplicate id;
- honeytoken: no detector, a detector kind no signal contribution registers, or one registered below `critical` (02.5);
- analyst: more than one (the firewall would not know which one triages);
- any contribution that cannot be loaded.

`firewallRegistry()` answers the process's verdict and catalogue for the later steps (02 checks kinds, 05 runs actions).

**The first contributions (01 §1.6).** Each owning module registers what it emits and what it can do, in its own folder
(`server/<module>.firewall-signals.ts`, `server/<module>.firewall-actions.ts`), importing only the contract; this module imports none of
them (`ai_firewall.first-contributions.test.ts` loads them all from their manifests and puts them through the boot checks together).

- Signals: 124 kinds from 25 modules (02 §2.3 adds `ai_firewall.request_pattern` and `user_session.refresh_reused`, emitted, not audit rows), the audit actions of inventory §1, §2, §4 and the rows of phase 00.3–00.5. A kind is the audit
  action, registered once by the module that owns it (auth's `auth.login` also stands for an SSO sign-in, which auth_sso writes with
  `method: 'sso'`). `auditRowSignal` in the contract adds the row's own attributes (`AUDIT_ROW_SIGNAL_ATTRS`: actor type, address
  `network`, user agent `device`, on-behalf-of, actor tenant, sealed) and the metadata fields as `m.<field>` (strings `untrusted`, as the
  intake marks them); the refusal rows of 00.3 add `REFUSAL_ROW_METADATA` (count, window, overflow). Since 02.6 the kinds a module emits
  itself are registered too (`emitted: true`): `limiter.rate_limited` (tallied) and `limiter.address_divided`, `seo.csp_violation` (tallied,
  Pro), auth's `auth.callback_refused`, `auth.refresh_refused`, `auth.otp_sent`, `auth.verify_email_sent`, `auth.totp_setup_started`,
  `auth.signup_blocked` (tallied), `tenant_invitation.accepted` and `tenant_invitation.token_refused` (tallied), and tenant_member's audit
  rows `tenant_member.review_held` / `review_released`. Not registered: 4xx bursts (the request metadata of 2.1's feature store), and the
  `event.*` kinds of domain events, which repeat audit rows.
- Actions (16): `auth.session_step_up`; `user_session.end_session`, `.end_all_sessions`, `.force_password_change`;
  `user_security.security_lock`, `.revoke_trusted_devices`; `tenant_member.suspend`; `limiter.ip_ban`, `.throttle`; `api_key.throttle`,
  `.revoke`; `auth_impersonation.end_session` (Enterprise); `iot_device.disable`, `.kick`, `.revoke_credential` and
  `iot_pki.revoke_certificate` (IoT add-on). Each execute and undo calls the module's own function as the firewall (`actorId: null`,
  `source: 'firewall'`), keeps to its scope (account-wide and installation-wide actions are the platform's, a membership is a tenant's,
  a session, key or device of another tenant is left alone), never lays itself over a standing control (an administrator's lock, ban,
  suspension or throttle) and undoes only what its own run set (a revoked key only while its deactivation stamp `deactivatedAt` is the
  run's, D55-16; a disabled device only while its status-change stamp `statusChangedAt` is, D55-15: a usage stamp or a disconnect moves
  `updatedAt` and no longer blocks the undo; the address throttle in its own divisor key, D55-11, and only while the run key names the
  run, D55-20). An action that cannot restore declares `reversible: false`, its undo
  answers `noop` with the reason (an ended session, revoked trusted devices, a revoked credential or certificate, a kick), and it is
  Suggest-only (FWA-4, D55-9: boot refuses it with `minimumMode: 'auto'`, the mode write refuses Auto for it). Not
  registered, with the reason: the global blocklist (no end, the operator's alone, 00.2 review), "end every impersonation" (the
  administrator's own emergency button names the acting administrator), page on-call (paging needs an escalation policy, which is the
  alert pipeline's routing: the firewall's incidents enter it through `observability:alert-source` with 02's incidents, and the seeded
  Security route sends them to on-call), quarantining an existing device (OD-1: only provisioning creates a quarantined device; the
  exclusion is DISABLED).

**Signal coverage** (`npm run check:firewall-signal-coverage`, `scripts/registry/firewall-signal-coverage.mjs`, test
`ai_firewall.signal-coverage.test.ts`): every human auth route (`/api/auth/**`, but not the account pages under `/api/auth/me/` that neither
prove nor change how one signs in) is covered by a signal contribution's `metadata.routes`, or listed in
`scripts/registry/firewall-signal-coverage.json`: `exempt` (reviewed, with a reason: routes that prove, change and refuse nothing) or
`pending` (waiting for 01.6, **shrink-only**: `npm run firewall:signal-coverage` removes covered and gone entries and lowers
`pendingCeiling`, never adds; the check fails above the ceiling). A contribution whose routes end in kinds another module registers
names them in `metadata.records` (a passkey sign-in ends in `user_session.login`); each must be registered. On 2026-11-03, after 01.6: 69
routes, 35 covered, 28 exempt, 6 pending (the token refresh, the cookie callback, sending a code or a verification mail, the TOTP setup:
they wrote no row). After 02.6: 41 covered, 28 exempt, **0 pending, ceiling 0** (auth's emitters, D55-60).

## Covering a new module (the coverage gate)

One gate answers "does the firewall see this module?" for every module: **`npm run check:firewall-coverage`**
(`scripts/registry/firewall-coverage.mjs`, D55-150 to D55-158, test `ai_firewall.coverage-gate.test.ts`). It reads the route surface
(`tests/security/drift/route-surface.snapshot.json`), the manifests, the modules' server sources and their entities; it boots nothing.
Per module:

| Check | Passes when |
|---|---|
| `surface` | the route surface snapshot is fresh: every module.json `apiRoutes` handler is in it, and it names no handler the manifests dropped (never ratcheted; `node scripts/check-drift.mjs --update` rewrites it) |
| `routes` | every route reaches the request observer: a module API route through the tenant API dispatcher (which observes every answer), a file route by calling `observeRequest` itself or through the proxy (a page path: not `MACHINE_PATH`, not a static-asset path `isExcluded` counts as an asset load only, not `API_PATH` of `proxy/observe.ts`, inside the matcher of `proxy.ts`; the gate reads those rules from the code and stops when `observeProxyAnswer`'s early returns change) |
| `signals` | every audit action the module writes (`action: '…'`, `action: AuditActions.KEY`, a constant, `OBJ[key]` with plain or quoted keys, an action helper (a function named `*action*` or typed `*AuditAction*`: what it returns), both sides of a ternary, the positional string arguments of a call named `*audit*`, the action argument of a wrapper (a function that passes a parameter as the row's action, or a name typed with a hook type such as `onMove: NodeMoveHook`), every action a `*AuditAction*` type lists) is a kind some `ai_firewall:signal` contribution registers; `scripts/` counts as the module `scripts`; a template (`approval.${decision}`) is never a finding |
| `stale-signals` | no kind registered with `auditRowSignal` is left that nobody writes any more (a template's fixed prefix counts as a write) |
| `auth-routes` | `check:firewall-signal-coverage` holds (imported and run as it is; its file keeps its own exemptions and ceiling) |
| `probe` | the fw-probe authorization matrix (`scripts/fw-probe/lib/expectations.ts`) has an expectation for the route, or skips it for a reason that holds by design (GUEST or public, its own protocol, an allowed write not sent); an alternative or dynamic permission, a mixed, derived or unknown scope, an UNEXPLAINED unguarded route and a guarded file route are findings |
| `actions` | a module that owns a credential, session, device or membership (a table whose last word, plural or singular, is a session, credential, key, passkey, token, certificate, secret, client, grant, factor, device or member, a `secret` word anywhere, an identity link; or a subject in the file's `declared` map) contributes an `ai_firewall:action` |

Gaps of today sit in `scripts/registry/firewall-coverage.json` under `ratchet.<check>.<module>`, each "pre-existing at ee760f0c6"; the
reviewed ones under `exempt.<check>.<module>` with a reason of 20 characters or more that says why (a reason reading "pre-existing…" is
the ratchet's and fails; the test pins the exemption count per check, so each new one is a reviewed diff). The ratchet only shrinks: a gap
listed nowhere is NEW and fails; an entry no longer needed fails (`npm run firewall:coverage -- --write` deletes those and lowers
`ceilings`, it never adds one); a ratchet entry naming another sha than the baseline fails; more entries than a check's ceiling fail, and
fewer too (an entry deleted by hand frees no slot: the ceiling goes down with it). On 2026-11-03: 2968 routes, 2931 observed, 7 exempt
(health, ready, metrics, caddy-ask, tls-cert, the CA's challenge, the plugin broker), 30 ratcheted (fleet's internal API, the plugin
proxy, the cookie and Fleet ID callbacks); 1214 audit actions written, 124 registered, 1099 module and action pairs ratcheted; 0 stale
kinds; 0 auth-route findings; 126 probe routes ratcheted; 40 credential subjects, 9 covered, 8 exempt (encryption and signing keys the
server holds, HR family members, a till's shift, time-series key names), 23 ratcheted (the review of the gate added 23 written actions
and 3 credential tables the first scan missed, all there at the baseline). On 2026-11-04 (lane A, D55-163 to D55-165): routes 0
ratcheted (the plugin proxy and the callbacks observe in their module files, which the gate reads behind the generated `app/(modules)/`
re-exports; the node's 20 loopback fleet endpoints exempt), probe 0 (108 guards read by hand into the matrix's `REVIEWED_GUARDS`, refusal
side only; 11 exempt), actions 10 ratcheted (13 more exempt: a person's sign-in credentials are acted on through the person).
Then actions lane 1 (D55-200 to D55-204): Fleet ID clients, node enrollment tokens, on-call links and SIP identities got actions with
real undos, node certificates none (nothing refuses a node by its certificate); actions 5 ratcheted, 18 exempt.

**"Look at the commits and cover the new ones too"** is one command:

```bash
npm run firewall:coverage -- --since <the last commit covered>    # e.g. --since ee760f0c6, or --since origin/main
```

It prints every NEW gap of every module (`[new]`, fails the gate), because a change in one place opens gaps in another (the dispatcher,
the proxy, the audit enum, this gate's file, one module's kinds that another writes), and the older debt (`[ratchet]`) of the modules
whose files changed since that commit (committed, uncommitted and untracked, both sides of a rename; `app/`, `proxy/` and `proxy.ts`
count as `app`, `scripts/` as `scripts`), each with the step to take. `--module <id>` narrows everything to those modules; `--check`
with `--since` is the whole gate.

**The steps for a module**, as 01.6, 01.8 and 02.5 did them:

1. **Signals.** `server/<module>.firewall-signals.ts` default-exports a `FirewallSignalContribution[]`, built with `auditRowSignal` from
   `@kuraykaraaslan-labs/common/server/common.firewall-contracts` (the contract only; never import `ai_firewall`): `kind` is the audit
   action itself, with `severity`, `defaultWeight`, `outcomes`, `lanes`, `actorKinds` and every `metadata` field with its personal-data
   class (`signalAttr`: `untrusted(class, note)`, `number()`, `flag()`; classes `none`, `identifier`, `network`, `device`, `location`,
   `contact`, `content`). A kind the module emits itself (no audit row) is a plain contribution with `emitted: true`. module.json gets the
   `ai_firewall:signal` extension (`key: firewall_signals`, `export: <module>/server/<module>.firewall-signals`, `scope: system`,
   `metadata.label`, `metadata.ids` listing every kind). Labels in the module's own `dictionaries/en.json` and `tr.json` under
   `<module>.firewallSignal.<slug>` (the id with every character outside `[A-Za-z0-9_]` as `_`, D55-7). A benign bookkeeping row (a layout
   saved, a draft renamed) is exempted instead: `exempt.signals.<module>["<action>"]` with its reason.
2. **Actions.** A module that owns a credential, session, device or membership contributes `server/<module>.firewall-actions.ts`
   (`FirewallActionContribution`: id `<module>.<verb>`, rung, lanes, actor kinds, TTL, minimum mode, hourly budget, evidence, `scope`,
   `execute` and `undo` through the module's own functions as the firewall, `actorId: null`, `source: 'firewall'`; never over a standing
   control, undoing only what its own run set; `reversible: false` and Suggest-only when the undo cannot restore), the `ai_firewall:action`
   extension with `metadata.ids`, and labels `<module>.firewallAction.<slug>.label` / `.description` in en and tr. A subject that is no
   actor's (an encryption or signing key the server holds) is exempted: `exempt.actions.<module>["<table>"]`. A subject that lives in no
   table of its own goes to `declared.<module>["<subject>"] = { kind, where }`.
3. **Decoys.** A module that owns credentials, or records an insider walks by id, contributes `ai_firewall:honeytoken`
   (`server/<module>.firewall-honeytokens.ts`: id `<module>.<decoy>`, kind, label key, `detector.signalKind` naming a `critical` kind it
   registers, `plant(tenantId)`), keeps the decoy out of every list, count and export, answers a touch exactly as the real thing's miss and
   reports it with `emitHoneytokenTouch` (see Decoys).
4. **Auth routes.** A route under `/api/auth` is listed in the signal contribution's `metadata.routes`; when its outcome is recorded by
   another module's kind (a passkey sign-in ends in `user_session.login`), that kind goes to `metadata.records`; a route that proves,
   changes and refuses nothing goes to `scripts/registry/firewall-signal-coverage.json` `exempt` with its reason.
5. **Routes and probe.** Serve the API through module.json `apiRoutes` (the dispatcher observes it; a file route calls `observeRequest`
   itself or is exempted with a reason), with one fixed scope and one plain permission id, so the probe matrix derives its expectations.
   A module-owned app route (`appRoutes`) calls `observeRequest` in its module file. A guard the surface cannot decide (an alternative or
   dynamic permission, a mixed scope) is read by hand into `REVIEWED_GUARDS` (scripts/fw-probe/lib/expectations.ts, D55-164).
6. **Run the gate.** `npm run registry:snapshot`, `node scripts/check-drift.mjs --update` after reviewing the new routes (it rewrites the
   route surface snapshot the gate reads; `--module <id>` only checks it, and the gate's `surface` check fails while a new handler is
   missing from it), then
   `npm run check:firewall-coverage` and `npm run check:firewall-signal-coverage`. A ratchet entry the work covered now fails the gate:
   `npm run firewall:coverage -- --write` deletes it and lowers the ceiling.

## The feature store (02 §2.1)

Per-actor features for the rule scorer (2.2), the dataset export (03) and the request cascade (04.8), in `server/features/`.

**Two catalogues, defined once** (`ai_firewall.feature-catalogue.ts`, D55-26): `behaviour.v1` (LightGBM, 21 features: the actor against its own
baseline or its role's prior: volume per route class, unusual hour, new countries / ASNs / devices, subjects, addresses, exports and admin
writes against usual, fingerprint switches, account age, MFA, baseline age) and `attack.v1` (XGBoost, 49: status mix, route sensitivity mix,
sequential ids, path and parameter shape, indicator tokens, user agent family, header anomalies, timing regularity, asset loads, sign-in
outcomes, distinct accounts per address, endpoints, paging, refusals; no baseline). They share only `lane` and `actor_kind`. A feature is
data: name, actor kinds, window, type, owning model and a declarative source; the catalogue's content hash is pinned per version
(`CATALOGUE_HISTORY`), and a changed feature needs the next version (`ai_firewall.feature-catalogue.test.ts`).

**Where the data comes from** (fail open, FWA-7):

| Half | How |
|---|---|
| Requests | The proxy (`proxy/observe.ts`: pages, assets, its own answers) and the tenant API dispatcher (every answer, route template and status) call `observeRequest` (`common/server/request-observer.ts`). The runtime boot task `startRequestFeatures` registers the fold (`ai_firewall.request-fold.ts`): `requestMetaOf` (`ai_firewall.request-meta.ts`, pure, counts and classes only) and per-actor counters in process; a 5 s timer flushes them as one pipeline (at most 40 000 commands, 5 000 actors per process). No Redis call, await or signal on the request path; a failed flush is dropped and counted (D55-21). The caller comes from the guard's note (`noteRequestPrincipal` in `authorizeRequest`, D55-25; during an impersonation the operator, never the person, D55-47). Pages count as `page` only for document navigations (D55-44); an IPv6 address is keyed by its /64 (D55-48); the id cache, the device tag and a day profile are bounded (D55-45, D55-49). |
| Signals | The worker's boot task `startSignalFeatures` (`ai_firewall.signal-fold.ts`): its own consumer group `ai-firewall-features` on `fw:signals` (the store's group is untouched), the same consumer code; counts by kind and outcome for the actor and for the address in the signal, distinct accounts per address and addresses per account, subjects, the day profile (hour, `m.country`, `m.asn`, device tag). A batch it cannot write is counted and acknowledged (D55-28). |

**Redis layout** (`ai_firewall.feature-windows.ts`; ids are keyed hashes, `ai_firewall.feature-id.ts`, D55-22; addresses in the platform scope
`p`, people and keys in `t:<tenantId>`, D55-23): four windows (1 min, 5 min, 1 h, 24 h) as two-bucket sliding estimates (`fw:fc:*` counter
hashes, `fw:fd:*` HyperLogLogs for accounts, addresses, subjects, endpoints), the known-endpoint set `fw:fk:*` (new endpoints), the day profile
`fw:fp:*` / `fw:fpd:*`, the day's work list `fw:fa:<day>` and an erased actor's mark `fw:fx:*` (D55-46). Every key has an expiry (an address's known-endpoint set 24 h, D55-48). One writer (`ai_firewall.feature-writer.ts`: two Lua
scripts loaded at the head of each pipeline) and one reader (`ai_firewall.feature-read.ts`: 25 commands, one round trip, 50 ms bound, null on
any failure).

**Baselines** (`ai_firewall_baselines`, migration 002; `ai_firewall.baseline.ts`, `.baseline.store.ts`, D55-27): per person and API key of a
tenant, the EWMA (14-day span) of usual UTC hours, countries, ASNs, devices, volume per route class, export bytes, subjects, admin writes and
addresses per day; per role the cold-start prior (no countries, ASNs or devices). The daily job `scheduleBaselineJob` (00:20 UTC, the leader;
`ai_firewall.baseline.job.ts`) folds yesterday's profiles once. Exported with redaction, erased by the keyed hash of the user id, purged with the
tenant.

**Assembling** (`ai_firewall.feature-store.ts`, `actorFeatures`): an actor, its lane and role in; both vectors (`ai_firewall.feature-vector.ts`,
one number per feature in catalogue order, NaN when unknown), `coldStart` (no own baseline of 3 days yet) and whether the windows could be read
out.

Series: `ai_firewall_features_observed_total{phase}`, `ai_firewall_features_written_total`, `ai_firewall_features_dropped_total{reason}`,
`ai_firewall_feature_hints_total{result}` (web process), `ai_firewall_feature_signals_total{result}` (worker).

## The rule scorer and the detectors (02 §2.2, §2.3)

Observe only (2.7): everything is scored and handed to the incident grouping (below); nothing acts or is proposed. In `server/detect/`.

**The shape** (`ai_firewall.risk.ts`, D55-30): `RiskScore { model: 'rules' | 'behaviour' | 'attack', score 0..100, space, contributions }`,
one `FeatureContributions` per catalogue in tree-shap.ts's layout (one value per feature in catalogue order, the bias last). The rules answer
in `points` (bias 0; the values of all catalogues add up to the score); a tree model of 04 answers in `margin` through `treeContributions`,
which takes a TreeSHAP row as it is. `topContributions` gives the features an explanation names (04.10).

**Rule scorer v0** (`ai_firewall.rule-scorer.ts`, `scoreActor`): 28 weighted single-feature rules (behaviour deviations from the actor's own
baseline or its role prior, the unusual hour, new countries / ASNs / devices, fingerprint switches; attack indicator tokens, CSRF and 429
refusals, odd methods, high-severity signals; the registry-weighted signal mass; a gateway's created and refused children over a day, D443) and the detections, combined as a noisy-OR:
`score = 100 × (1 − Π(1 − pᵢ))`, each reason's share `score × λᵢ / Λ` (λ = −ln(1 − p)) spread over its features.

**Detectors** (`ai_firewall.detectors.ts`): pure functions over the vectors; per actor kind a gate (the pattern's necessary condition, in
counts) and weighted terms that ramp one feature each; a detection needs strength 0.2. A missing feature is no evidence.

| Detector | Actors | Reads |
|---|---|---|
| `credential_stuffing` | address | failures per address, distinct accounts (1 h, 5 min), failure ratio, a sign-in after failures |
| `password_spray` | address | distinct accounts over 24 h with few failures each |
| `enumeration` | person, session, key, address, anonymous | sequential-id steps, 404 / 403 ratios, distinct subjects, `permission.denied`, new endpoints |
| `session_hijack` | person, session | `user_session.refresh_reused`, `tenant.session.geo_anomaly`, fingerprint switches, new country with a new device, addresses against usual |
| `data_exfiltration` | person, session, key | export bytes, export / list volume and subjects against the baseline, deep paging |
| `admin_misuse` | person, session | platform-admin grants, bulk role / policy / membership changes, impersonations, security downgrades, admin work off hours |
| `api_key_abuse` | key; address | 403 ratio and denials (scope probing), new ASN, new places, use after dormancy (`api_key.anomaly.detected`, volume against the baseline); an address guessing keys |
| `public_bot` | address, anonymous | timing regularity, header anomalies, script or empty user agents, rate; no asset loads as evidence only, page loads only for an address no account signed in from (D55-44) |
| `signup_abuse` | address; person | sign-ups and new workspaces per address; a new account creating keys, exporting or administering at once |
| `device_lane` | device, node; address | one device from several addresses, event floods; `iot_gateway.auth_blocked`, `iot_pki.recovery.attempted` (alerts only, FWA-6) |

**rules.v1** (`features/ai_firewall.rule-catalogue.ts`, D55-32; version 2 adds `gateway_children_created_24h` and `gateway_child_refusals_24h`, D443): 25 features only the rules read (never a model's input), names disjoint
from `behaviour.v1` / `attack.v1`, content hash pinned in `RULES_HISTORY`; `actorFeatures` returns it beside the two model vectors.

**Where they run** (D55-31): the feature group's consumer (`signalFeatureStore`) names each folded batch's actors and the addresses its
rows carry to the worker's queue (`ai_firewall.detection-queue.ts`: 5 000 at most, 2 s settle, one scoring per actor per 30 s); the boot task
`startDetectionEvaluator` (`ai_firewall.detection-evaluator.ts`, every worker process) scores at most 100 actors per 2 s tick, 10 at a time.
Request-only actors are nominated by the request fold at its flush: one `ai_firewall.request_pattern` signal (counts only, weight 0) per
actor whose flush counters clear a bar (`ai_firewall.request-pattern.ts`), at most once per actor per 30 s and 50 per flush.

**The hand-off to 2.4** (D55-33): `onScoredDetection(listener)` receives a `ScoredDetection` for every actor with a detection or a score of
25 and more: store tenant, `platform` (an address, an anonymous caller or a ROOT actor: shown in ROOT only, D55-24), lane, risk,
detections (strength, points, evidence shares), cold start, `alertsOnly` (device lane, devices and nodes). Series (worker):
`ai_firewall_detection_evaluations_total{result}`, `ai_firewall_detections_total{detector}`, `ai_firewall_detection_queue{state}`.

Open (D55-35): form fill speed, near-identical e-mails and disposable domains (2.6), invitations (no kind), impersonation length (an
attribute), telemetry floods (no device producer), ASNs (no producer, D55-29); the evaluator knows no account age or MFA.

## Incidents, the alert pipeline and privacy (02 §2.4, §2.7, §2.8)

Observe (2.7): an incident is scored, grouped, shown and, over a bar, alerted; nothing acts on anyone and nothing is proposed to the
responder from here (05 builds that).

**Grouping** (`server/incidents/`, D55-36): the boot task `startIncidentRecorder` (`ai_firewall.incident-recorder.ts`, worker, every process)
subscribes to the detectors' hand-off (`onScoredDetection`) and writes each `ScoredDetection` into its actor's incident
(`recordDetection`, `ai_firewall.incident-store.ts`) in the detection's store tenant (the platform's under ROOT). One actor (tenant, kind,
id) has at most ONE active (open or acknowledged) incident: the partial unique index `uq_ai_firewall_incidents_active` (migration 003)
deduplicates across worker processes (`INSERT … ON CONFLICT DO NOTHING`, then the scoring joins the incident the other worker opened). A
scoring joins while the incident is live (its last scoring at most 24 h ago and opened at most 7 days ago); otherwise the old one is closed as
`expired` and a new one opens. Fail open (FWA-7): a write that fails is counted (`ai_firewall_incident_recordings_total{result}`) and logged
at most once a minute, never retried.

**What an incident holds** (pure rules in `ai_firewall.incident-model.ts`, D55-38): the latest score and the peak (score, time, reason, the
peak's explanation), the severity of the peak (low < 40 ≤ medium < 60 ≤ high < 80 ≤ critical; it never drops), per detector how often it
held, its strongest strength and when, a bounded score timeline (`history`: the first scoring and the newest 49, each with its detectors and
top three contributions), `platform`, `alertsOnly` (FWA-6), `coldStart`, who acknowledged and who closed it. The explanation and the timeline
hold feature names and numbers only, never an id, path or header value. An acknowledged incident whose severity rises is open again.

**Life** (D55-37): open -> acknowledged -> closed (`resolved` or `false_positive` by a person; `expired` by the grouping or the nightly run;
`erased` by the erasure); closed -> open (reopen, which restarts the quiet window; refused while the actor has a newer active incident). The
nightly retention run closes every active incident quiet for 24 h or older than 7 days as `expired` at the time it went quiet
(`expireQuietIncidents`), so the retention deletes it one retention after its last activity.

**Routes** (D55-40; FWO-5 open, D55-24 applied):

| Route | Customer tenant | Root tenant (the platform's rows) |
|---|---|---|
| `GET /api/ai-firewall/incidents` | TENANT, `ai_firewall.incidents.read` | GLOBAL (KD-13 admin gate), `ai_firewall.platform.read` |
| `GET /api/ai-firewall/incidents/[incidentId]` | TENANT, `ai_firewall.incidents.read` | GLOBAL, `ai_firewall.platform.read` |
| `PATCH /api/ai-firewall/incidents/[incidentId]` `{ action: acknowledge \| resolve \| reopen, closeReason? }` | TENANT, `ai_firewall.incidents.manage` | GLOBAL, `ai_firewall.incidents.manage` |
| `GET /api/ai-firewall/actors?kind=&id=` | TENANT, `ai_firewall.events.read`; an address or anonymous caller 404 (`AI_FIREWALL_PLATFORM_ACTOR`) | GLOBAL, `ai_firewall.platform.read` |

Every read and write runs in the URL tenant's own transaction (RLS; another tenant's incident id is a 404). The list answers the newest 500 by
last activity; an incident's timeline is its record plus the actor's stored events from an hour before it opened to its last activity (200 at
most), **without addresses** (the incidents permission does not open them); the actor view (the events permission) shows the actor's
incidents and its events of the last 7 days with the address. A change writes `ai_firewall.incident_status_changed` (from, to, close reason,
actor kind; best effort, after the write), also a registered signal kind of this module (closing the firewall's cases in bulk is what an
attacker with an admin account would do). 409s: `AI_FIREWALL_INCIDENT_CLOSED`, `AI_FIREWALL_INCIDENT_NOT_CLOSED`,
`AI_FIREWALL_INCIDENT_ACTIVE_EXISTS`. Service: `ai_firewall.incident.service.ts`; shapes `ai_firewall.incident.types.ts`; input
`ai_firewall.incident.dto.ts` (strict).

**The page** (`/admin/ai-firewall/incidents`, `ui/ai-firewall-incidents.page.tsx`; menu label a placeholder, FWO-8): a DataTable of the
incidents (sort; filters: status, severity, detector, about, traffic; search; a column chooser), a row opens a Drawer with the incident: its
summary and commands (acknowledge; resolve and false alarm each behind a ConfirmDialog; reopen), **Why it was flagged** (the detectors that
held with their description, strength, points and evidence; the largest contributions as sentences from the dictionaries, with their
points and share, D55-41), the score timeline and the actor's events. **Actor history** opens the actor view inside the same Drawer (back
button), from which another incident of the actor opens. No tabs, no accordions. Words: `ui/ai-firewall-explain.labels.ts` (every feature of
the three catalogues, every detector, lane, actor kind, status and close reason; en and tr, checked by `ui/tests/ai-firewall-explain.labels.test.ts`).

**Alerts** (2.7, `server/ai_firewall.alert-source.ts`, `observability:alert-source`, D55-39): per tenant and minutely sweep, the open
incidents whose peak reached 60 (the highest 50) as alerts labelled `category=security` (the Security route observability seeds, phase 55
00.4), `source=ai_firewall`, `detector`, `actorKind`, `lane`, `scope` (tenant / platform), `alertsOnly`; severity low/medium/high/critical ->
WARNING/MINOR/MAJOR/CRITICAL; key `incident.<id>` (a rising score updates the same alert). Titles and labels name the detector and the kind
of actor, never the actor's id (it would travel to every notification target). An acknowledged, closed or expired incident is no longer
listed and its alert resolves. The ROOT tenant's sweep lists the platform's incidents.

**Privacy** (2.8, D55-42): feature counters and baselines are keyed by the keyed hash (D55-22); an incident keeps the raw actor id because the
actor view and the responder (05) must name the person, key or device, and it lives in the tenant's RLS rows like the events. Addresses: an
incident about an address is closed by the nightly run once quiet for a day (dated when it went quiet) and deleted one retention later; the events carrying addresses go
with the retention. Export: incidents with every new column (`acknowledgedBy` redacted with `redactPii` like the other deciders). Erasure: an
incident about the person or one of their sessions loses the actor (`erased`) and, when active, is closed as `erased` (so the one-active
index never holds a dead actor); `acknowledgedBy` / `closedBy` are cleared; the timeline and explanation stay (names and numbers only). The person's baseline row and their feature-store keys in Redis go too, and a mark keeps the baseline job from rebuilding it (D55-46); baselines whose last day is older than the retention are deleted nightly. The
settings page carries a short privacy note (legitimate interest, what is stored, retention, export and erasure).

## Labels and feedback (03 §3.1, §3.2)

The examples the tree models of 04 learn from: what a source whose truth we know says about one incident or one stored event.

**The store** (`ai_firewall_labels`, migration 004, tenant RLS + FORCE; platform labels under the ROOT tenant; D55-75): the reference
(`refKind` incident | event, `refId` the incident's uuid or the event's signal id, `refAt` when the behaviour happened), the labelled actor
and lane (copied, so the dataset export of 3.5 needs no row the retention may have deleted), the event's kind or the incident's detectors
(strongest first, `score.rules` when none held), the class (closed list: `benign`, the ten detector ids of 02, `honeytoken_touch`, `other`),
a person's `verdict` (true_positive | false_positive | unsure), the `source` (honeytoken | admin | ban_confirmed | synthetic | benign_traffic),
`confidence` 0..1 (D55-77), `labelledBy` (a person) or `labelledBySystem` (a producer), `labelledAt`. At most one label per reference and
source (`uq_ai_firewall_labels_ref`): a system source writes once, a person's later verdict replaces their earlier one.

**Labels without a person** (D55-76, `labels/ai_firewall.label-producer.ts`): the fw:signals consumer hands each tenant's stored rows to the
producer right after their write and acknowledgement (its own transaction; a failure counted as `ai_firewall_labels_produced_total{result="failed"}`
and dropped; no database call for a batch with nothing to label):

| Event | Label |
|---|---|
| a decoy touch (a kind of `honeytokenDetectorKinds`) | honeytoken, `honeytoken_touch`, confidence 1, about whoever touched it |
| `security.ip_banned` by a person (a manual ban; a firewall proposal an operator approved) | ban_confirmed, the class of the address's latest incident (else `other`), 0.9, about the address, labelled by the operator |
| `security.ip_unbanned` by a person, the lifted ban `auto` or `firewall` | ban_confirmed, `benign`, 0.8, about the address |
| an automatic ban, a run without a person, a manual ban lifted | nothing (no one confirmed it, or the operator changed their mind) |

**Feedback** (D55-78, D55-79): `PUT /api/ai-firewall/incidents/[incidentId]/label` `{ verdict: true_positive, labelClass } | { verdict:
false_positive | unsure }` (strict; the class only an attack class: a detector's or `other`), TENANT with `ai_firewall.incidents.manage`, on
the root tenant GLOBAL with the same permission (who may change an incident may label it, D55-40). The incident's `admin` label is written
in the URL tenant's transaction with the incident locked; a verdict changes no status; the same one again writes and audits nothing. Audit
row and signal kind `ai_firewall.incident_labelled` (verdict, class, the verdict it replaced, actor kind; medium for a false positive). The
false alarm close writes the false-positive label with the close (audited by the close's row); reopening a false alarm withdraws it. The
incident's detail carries its `label`. The drawer's **Your verdict** section: a kind-of-attack select and three buttons (Real attack, False
positive, Unsure), no confirmation (nothing closes).

**The counter for 04.8** (D55-80): `detectorVerdictCounts(tenantId)` answers per detector the tenant's true positives, false positives and
unsure verdicts (each verdict once under every detector of its incident), a read only: no calibration, no route.

**Privacy** (D55-81, D55-97): the nightly retention deletes labels whose behaviour (`refAt`) or giving (`labelledAt`) is older than the
tenant's retention (by `refAt` first: a re-given verdict rewrites `labelledAt` and must not keep a label a further retention; migration 007
indexes it); the export's
`aiFirewallLabels` redacts the actor's id and `labelledBy` with `redactPii`; the erasure deletes the labels of the person's own events,
anonymises the labels of their incidents (`erased`) and clears their `labelledBy`; the purge deletes the tenant's labels.

## The probe lane and benign traffic (03 §3.3, §3.4)

**The run-id trust rule** (D55-82 to D55-85). The probe runner (`scripts/fw-probe`, its README) and the benign-traffic sources mark each
request with `x-fw-probe-run` (the run id), `x-fw-probe-class` (the label class the request produces) and `x-fw-probe-key`: a proof of the
runner's own credential for that run and class, never the credential (D55-95: `p1.` + HMAC-SHA256 of `nb.fw-probe/1\n<run>\n<class>` under
the credential's SHA-256, so a header that reaches a wrong host is good for that one run and class only). The tenant API dispatcher asks
`common.firewall-probe-gate.ts` once per request: the mark is believed only when the install is a staging install (`INSTALL_ROLE=staging`,
an explicit env setting, default `production`, never inferred from a hostname; any other value, a misspelt or blank one included, is
`production` and never stops the boot, D55-98) and the proof is the one made under `AI_FIREWALL_PROBE_RUNNER_SHA256` (any class), or, on
`staging` or `demo`, under `AI_FIREWALL_BENIGN_RUNNER_SHA256` with the class `benign` only (both digests are secrets of those environments). The credential is no account, session or API key and opens no route. Anywhere else the headers are ignored and counted
(`ai_firewall_probe_marks_total{result}`: accepted, not_staging, no_credential, bad_credential, malformed, class_refused). An accepted request
runs inside a probe-run context (`common.firewall-probe-run.ts`, AsyncLocalStorage); `emitSecuritySignal` stamps every signal emitted in it
with `probe.run` and `probe.class` (first, so the attribute cap never cuts them) and drops any `probe.*` attribute a producer passed; the stamp
holds 5 s after the answer (detached audit sinks) and at most 6 minutes; the answer watcher (the limiter's 401 / 403 / 404 counting and trap
touches) runs inside it (D55-94); the tally's flush, the refusal aggregator's and the second-factor guard's minute flushes run outside it
(D55-93). The accepted answer carries
`x-fw-probe-accepted: <run id>`, the runner's handshake.

**The collector** (D55-86, `labels/ai_firewall.probe-labels.ts`): the label producer of 3.1 takes every stored event that carries a stamp, reads
the install role (only for such a batch) and writes, on staging, a `synthetic` label of the declared class (confidence 1, labeller
`probe_run`) or for `benign` a `benign_traffic` one (0.9, `benign_run`), on the demo only the benign ones, with the run id in the label's
`runId` (migration 005) so one run's labels are found or withdrawn together; on production nothing (counted `not_staging`), and a class
outside LABEL_CLASSES or a malformed stamp neither (`ai_firewall_probe_labels_total{result}` on the worker). Open: signals the proxy answers
alone (a ban's 403), tallied ones and the aggregated refusal rows (CSRF, second factor; D55-93) carry no stamp. Benign marks from a browser go
to the install's origin only (`fw:probe:benign-headers --format playwright --origin …`, a `context.route` recipe, D55-96).

## The dataset export (03 §3.5)

**The labelled vectors are kept where they exist** (D55-88, migration 006, `dataset/ai_firewall.vector-capture.ts`): the windows live a day
at most, so an incident keeps the behaviour.v1 and attack.v1 vectors of its peak scoring (`ai_firewall_incidents."peakVectors"`, written by
the incident grouping with the scoring that opened the incident or raised its peak; the evaluator attaches them to the scored detection), a
person's verdict copies them into its label in the same INSERT (`ai_firewall_labels."vectors"`), and an event label made without a person
(a decoy touch, an operator's ban decision, a probe or benign-traffic run) gets its actor's vectors read when it is produced, before the label
transaction (fail open: a failed read is a label without vectors). Only on `INSTALL_ROLE=staging` or `demo`, and an incident's peak vectors on
`staging` only (D55-92: the demo exports benign traffic only, so a demo verdict carries none): a production install keeps none. Numbers only (catalogue name, pinned hash, one value per feature, null = missing); they go with their rows (retention, purge), and the
erasure clears them on the erased person's incidents and their labels.

**The export** (D55-89 to D55-91): `npm run ai-firewall:export-dataset -- [--out <new dir>] [--days <n>]`
(`scripts/export-dataset.mts`, pure core `dataset/ai_firewall.dataset-export.ts`, reads `dataset/ai_firewall.dataset-source.ts`), run on
the install's own host with its environment. Refused unless `INSTALL_ROLE` is `staging` or `demo` and every database it opens is named for
that role (`…staging` / `…demo`, on the URLs and again on the live connections), and unless the install has its feature-id key. Reads every
tenant a retention sweep may touch in its own tenant transaction (RLS, no bypass), at most 200 000 labels per tenant, only the columns the
core turns into allow-listed values, and only the label sources its role exports (D55-92, `EXPORT_SOURCES`: staging every source, the demo
`benign_traffic` only, since its prospects' and testers' verdicts, decoy touches and bans have no known truth; enforced in the SQL, again
in the core as `source_not_allowed`, named in the manifest's `sourcePolicy`). Writes `manifest.json`, `behaviour.v1.jsonl` and `attack.v1.jsonl` (0600, in a new 0700 directory,
default `.fw-dataset/<YYYYMMDDTHH>`, git-ignored); nothing is sent anywhere (moving the files to the build host is a person's step; FWO-7
stays open for customer installs).

| Column | What |
|---|---|
| `ref`, `tenant`, `actor`, `run` | re-keyed ids: HMAC-SHA256(export key, `<domain>:<value>`), base64url, 22 characters; the actor's value is its keyed feature id of 02; the export key is 32 random bytes per export, never stored, so ids group rows within one export and join to nothing else |
| `refKind`, `actorKind`, `lane`, `source`, `labelClass`, `verdict` | closed lists (`verdict` true_positive / false_positive / null; `unsure` is skipped) |
| `hour` | when the labelled behaviour happened, truncated to the UTC hour (04.1's time split) |
| `confidence`, `coldStart` | 0..1 (three decimals); no own baseline yet |
| `x` | the catalogue's vector as 02 assembled it, in the catalogue's order, `null` = missing |

The manifest names the format (`nb.ai_firewall.dataset/1`), the columns, the id scheme, per dataset the catalogue (name, version, pinned
hash, library, feature names), rows and the label counts per class, source and verdict, the hour range, and every skip by reason (unsure,
erased, no_vectors, malformed, no_actor_id; per dataset catalogue_mismatch, not_applicable, no_windows). One row per label and per catalogue
whose own features describe the actor's kind (behaviour.v1: people, sessions, API keys; attack.v1: every kind). Never in a file: an address,
a raw or install-keyed id, a name, an e-mail address, a tenant name, a signal kind, a detector, an attribute, the labeller, the exact time,
free text. `datasetRowProblem` checks every row against the allow-list and the export is refused on the first failure; the schema test
plants e-mail addresses, addresses, names, tenant names and free text in every source field and in columns never selected
(`ai_firewall.dataset-export.test.ts`).

## Settings (01 §1.1, `/admin/settings/ai-firewall`)

Settings -> AI firewall (a card on the settings overview, `tenant_setting.settings.links`): `ModuleSettingsPage` over
`server/ai_firewall.settings.fields.ts`. Read with `ai_firewall.settings.manage`, written with it **and** `ai_firewall.actions.manage`
(`tenant_setting.key-owners.ts`, also for the generic settings API).

| Key | What | Read as |
|---|---|---|
| `aiFirewallKillSwitch` | the tenant's kill switch: every action of the tenant observed only | `true` only; the tenant's own row, never ROOT's (TENANT_OWN_KEYS); in ROOT it is the platform runs' switch, changed only by ROOT's OWNER or a platform administrator (D55-17) |
| `aiFirewallPlatformKillSwitch` | the platform's: every tenant at once (root tenant page only) | `true` only; platform-only key, read from ROOT |
| `aiFirewallDefaultMode` | the mode of an action the tenant has not chosen one for | `observe` (install) or `suggest`; anything else, `auto` included, is `observe` (refused on write); in ROOT OWNER or platform administrator only (D55-17) |
| `aiFirewallMode:<actionId>` | the tenant's mode for one action; written **only** by `PUT /api/ai-firewall/actions` (the catalogue page, below): the generic settings API refuses the family (`ROUTE_ONLY_SETTING_PREFIXES`, MS-21) | `observe` / `suggest` / `auto`; never inherited from ROOT |
| `aiFirewallRetentionDays` | retention of the store (above) | 7..365, default 90 |
| `aiFirewallSignupHardBlock` | 02.6: the tenant's opt-in for the hard block of sign-ups (`auth.signup_block`); off on install; read by auth by its key | `true` only; the tenant's own (TENANT_OWN_KEYS); in ROOT the platform runs' opt-in, OWNER-only (ROOT_OWNER_ONLY_SETTING_KEYS, D55-63) |

`effectiveActionMode(policy, action)` (`server/ai_firewall.settings-policy.ts`): `observe` while a kill switch holds or the settings cannot
be read (`killed: 'unreadable'`: a firewall that cannot read its own policy acts on nothing); else the tenant's choice for the action, else
its default mode; an action whose `minimumMode` is `suggest`, or whose run cannot be undone, never runs as Auto. `getFirewallActionPolicy(tenantId | null, actionIds)` reads
it (null = the platform, as ROOT).

## The catalogue page (01 §1.8, `/admin/ai-firewall`)

Security -> AI firewall (menu label a placeholder, FWO-8), every tenant (the module is core; TENANT scope, the root tenant's mode write at
GLOBAL scope behind the KD-13 admin gate, D55-10), page and menu item behind
`ai_firewall.actions.manage`. One request per load, `GET /api/ai-firewall/actions`. Plain sections, no tabs; related views open from header
buttons: **Signals** opens the signal catalogue in a drawer (`GET /api/ai-firewall/signals`, `ai_firewall.events.read`; read when the drawer
opens), **Decoys** opens the canary list in a drawer (02.5, below), **Kill switch and settings** links to Settings -> AI firewall (the kill
switches live there).

- **Actions** (a DataTable, sorted by rung then id; filters: runs as, strength, traffic, undo, module; a column chooser for evidence, lanes,
  module): each registered action with its name and one-line description, strength (rung), the tenant's mode (a select: Default (the
  tenant's default mode), Observe, Suggest, and Auto only when `minimumMode` is `auto` and the run can be undone), the mode it runs as now (`effectiveActionMode`: the
  kill switches, the default, the floor), oversight, how long it holds (default, at most), its hourly budget and whether its undo restores.
  **Every switch to Auto opens a ConfirmDialog** (with an acknowledgement); the request then
  carries `confirmAuto: true`, which the server requires. Other changes are saved at once. Banners: a refused registry, the platform's or the
  tenant's kill switch, unreadable settings (nothing editable then).
- **Where a mode is chosen** (`scope` on the action, new in the contract: `platform` | `tenant`, absent = both, checked at boot and against
  each execute's `outOfScope`): a platform action (account-wide lock, address ban, trusted devices, the forced password change) shows on a
  customer tenant without a mode ("chosen on the root tenant"); a tenant-only action (suspend a membership) shows on the root tenant without one.
  The root tenant's page sets the platform's modes (a run with `tenantId` null reads ROOT's settings) and names the platform cap of any
  action's time limit (30 days).
- **Signals** (the drawer, a paginated DataTable; filters: severity, about, traffic, outcomes, personal data, module): every registered kind with
  its name, severity, starting weight, actor kinds, lanes, outcomes, the personal-data classes of its attributes and the attributes themselves
  (column chooser).

`PUT /api/ai-firewall/actions` `{ actionId, mode: observe | suggest | auto | null, confirmAuto? }` (strict; null = back to the default,
the row removed): 404 an id nobody registered, 409 a mode the tenant cannot choose (`AI_FIREWALL_PLATFORM_ACTION`,
`AI_FIREWALL_TENANT_ACTION`) or Auto on a Suggest-only action (`AI_FIREWALL_AUTO_NOT_ALLOWED`), 400 Auto without the confirmation. The write
goes through `TenantSettingService.updateMany` / `delete` (history and the `setting.*` audit row) and adds `ai_firewall.action_mode_changed`
(from, to; severity high for Auto; best-effort, after the write), which is also a registered signal kind of this module. An unchanged value
writes and audits nothing. The tenant's maker-checker gate (`tenantSettingMakerChecker`) does not hold this write, as for the other
route-only keys (marketplace); the permission, the confirmation and the audit row do.

**Labels**: the page names kinds and actions through keys built from the registering module and the id (`firewallSignalLabelKey`,
`firewallActionLabelKeys` in the contract): `<module>.firewallSignal.<kind slug>`, `<module>.firewallAction.<id slug>.label | .description`,
in the registering module's own dictionary (en and tr; `ai_firewall.catalogue-labels.test.ts` checks every registered one). The extractor
keeps these keys (`isRuntimeFirewallKey`). A module whose dictionary is not shipped to the tenant shows the bare id.

## Decoys (02 §2.5, honeytokens)

Decoys look like the real thing, open nothing, and are shown nowhere but in the firewall's **canary list** (the **Decoys** header button of
the catalogue page, a drawer with a DataTable; `GET /api/ai-firewall/honeytokens`, TENANT scope, `ai_firewall.actions.manage`, never
cached). Each owning module contributes its decoys to `ai_firewall:honeytoken`, keeps them out of every list, count, export and listing a
customer reads, answers a touch exactly as it answers what the decoy pretends to be, and reports the touch through the contract's
`emitHoneytokenTouch` (one `critical` signal, outcome `deny`; bounded per kind, tenant and actor (3 a minute) and per process (600 a
minute), counted over the bounds; synchronous, never throws: FWA-7). The ROOT tenant's decoys are the platform's (`tenantId` null).

| Decoy | Owner | What it is | A touch |
|---|---|---|---|
| `api_key.decoy_key` | api_key | One key per tenant shaped like a real one (`sk_<env>_<tenant prefix>_<48 hex>`: the tenant id under AES-128 of one block + an HMAC tag, keys derived from the field key). No row: no key list, quota or export sees it | `verify` refuses it on the unknown-key path, exactly like a wrong key (same lookups, audit row, 401), even if a row with its hash existed; `api_key.decoy_touched` about the address (lane `public-anon`: the decoy is no credential) |
| `api_key.decoy_record` | api_key | A canary key id per tenant, no row | `/api/api-keys/<id>` (GET, PUT, DELETE, rotate) answers the missing key's 404; `api_key.decoy_record_touched` about the caller |
| `tenant_member.decoy_record` | tenant_member | A canary member id per tenant, no row (member records are what any member can read by id, the first thing an insider walking ids reaches) | `/api/members/<id>` (GET, PUT, DELETE) answers the missing member's 404; `tenant_member.decoy_record_touched` about the caller |
| `limiter.trap_routes` | limiter | Eight plausible old admin and backup API paths (`/api/admin/backup`, `/api/internal/env`, …) no module declares | The dispatcher's own missing-route 404 (they are no routes, so no sitemap or listing can name them); the limiter's answer watcher reports the 404 on a trap path as `limiter.trap_route_touched` about the signed-in person, else the address |

The canary ids and the decoy key are derived per tenant (`common/server/common.firewall-decoys.ts`: HMAC-SHA256 under the HKDF subkey
`firewall.decoy.v1` of SETTINGS_ENCRYPTION_KEY, never a bare hash), never stored, and checked in microseconds without a lookup; without a
field key there are no decoys and every path behaves as before. A rotation of the field key changes them (bait placed before it is no
longer recognised). `honeytokenDetectorKinds(verdict)` is the set of detector kinds 03 takes as high-precision labels. Observe only: a touch
is scored and shown, nothing acts on it (05).

## Sign-up protection (02 §2.6)

Soft by default, each an `ai_firewall:action` of the module that owns the path, observed on install like every action (nothing acts in 02),
each with an execute and a real undo (D55-61 to D55-64):

| Action | Owner | What | Scope |
|---|---|---|---|
| `auth.signup_hold` | auth | a new (under 7 days), unverified account held until its e-mail is verified: user_security's security lock with the sign-up marker, every sign-in method answers `EMAIL_VERIFICATION_REQUIRED`, verifying lifts it; no lock mail; a fresh verification mail first, and the hold ends with that link (D55-68) | platform (account-wide) |
| `auth.signup_captcha` | auth | a CAPTCHA from an address's first sign-up, refused cleanly without a CAPTCHA provider (38 A-5) | the tenant's sign-up, or every tenant's |
| `auth.signup_block` | auth | the hard block of an address's sign-ups (403 `SIGNUP_BLOCKED`), only where the tenant opted in (`aiFirewallSignupHardBlock`) | the tenant's sign-up, or every opted-in tenant's |
| `tenant_member.signup_review` | tenant_member | a membership that joined this week (a self sign-up or an accepted invitation) waits as PENDING for an administrator's approval | the tenant |

The invitation path is covered by the account hold, the membership review and tenant_invitation's signals (`tenant_invitation.accepted`,
`tenant_invitation.token_refused`). Open: a review queue of its own (today the members page lists the PENDING members; an administrator
approves by setting one ACTIVE); the register page cannot show a CAPTCHA challenge yet (38 2.4), so a CAPTCHA mark reads as "a security
check is required".

## Permissions

All with an ADMIN floor, group "AI firewall" (en and tr labels in the dictionaries):

| Id | For |
|---|---|
| `ai_firewall.events.read` | the tenant's stored security events: the actor view with addresses (02 §2.4) and the signal catalogue (01 §1.8) |
| `ai_firewall.incidents.read` / `.manage` | the incident list and timeline (no addresses); acknowledging, resolving, false alarm, reopening (02 §2.4; labels 03) |
| `ai_firewall.actions.manage` | the modes, the kill switch, approving, rejecting and undoing actions (01 §1.8, 05); with the ROOT OWNER role at GLOBAL scope, holding a tree model in shadow (04.7) |
| `ai_firewall.settings.manage` | the settings page |
| `ai_firewall.platform.read` | ROOT (GLOBAL scope): the platform's own events, incidents (02 §2.4) and actions, the registries (05.7) |
| `ai_firewall.activity.read` | ROOT (GLOBAL scope): the activity page (kept as it was) |

## The request cascade (04.8, FWD-7)

```
request ──► LightGBM (behaviour, every request) ──► normal ──► allow
                                                └─► suspicious ──► XGBoost (attack class) ──► benign ──► allow
                                                                                          └─► challenge / block,
                                                                                              end the session, exclude the device
```

- **LightGBM**, the behaviour model, reads `behaviour.v1`: how far an actor is from its own baseline. **XGBoost**, the attack model,
  reads `attack.v1`: endpoint, HTTP metadata and attack indicators. The two catalogues are disjoint (04.4).
- A cold-start actor (anonymous, new address, new account, fresh key) skips stage 1; it is challenged at most, because a block
  needs both models (two keys).
- A small audit sample of "normal" requests is scored by XGBoost in shadow to measure what stage 1 misses.
- At the top of the scale the cascade **proposes** ending the session and excluding the device; the responder runs them through the
  owning modules under the tenant's mode (FWD-8). The cascade never writes a session or a device itself.
- Fail open: a model that is refused, absent or over budget allows the request; the deterministic rules apply regardless.
- Shadow until promotion: before a model is promoted the cascade records what it would do and allows.

**In the request path** (4.8, D55-116..D55-122). `Limiter.checkRateLimit` asks one synchronous gate (`common/server/request-gate.ts`)
about every `api` and `auth` request its own controls let through (once per request); a refused request never reaches it (FWA-2). The
runtime boot task `ai_firewall_request_cascade` (`server/cascade/ai_firewall.request-cascade.runtime.ts`) registers the gate only when a
model loaded (none is shipped yet, so today nothing is registered and no request pays anything).

| Piece | What |
|---|---|
| `server/cascade/ai_firewall.request-cascade.ts` | The gate: the actor (the signed-in person on a human lane, by the token's signature; else the client address), the two stages timed against their budgets (0.5 ms, 1 ms; over budget allows), the breaker (over 1 % of 1 000 requests above 2 ms: stand aside 30 s), `decideCascade` (the person's own attack row can block; the address's row beside it can only challenge, D55-124), what the limiter is told (block, step-up, delay, allow) |
| `server/cascade/ai_firewall.cascade-cache.ts` | The actor cache: fresh 5 s, stale up to 60 s, a miss allows and queues; refreshed off the path (250 actors a second per process, 16 at a time, `actorFeatures`); 20 000 actors, 5 000 waiting; the models' rows kept ready |
| `server/cascade/ai_firewall.cascade-recorder.ts` | Counts, one `ai_firewall.cascade_decision` signal per actor and 5 s flush (weight 0, the support references), the terminate proposals as `proposed` rows of `ai_firewall_actions` (never executed here) |
| `server/cascade/ai_firewall.cascade-thresholds.ts` | The platform's thresholds from the metas; per tenant only `suspicion` and `block` move, from the tenant's verdict counts, within the platform's bounds |
| `server/cascade/ai_firewall.cascade-hover.ts` | 4.11: actors scoring just under a threshold (8 near-misses in 10 minutes, none above), one scoring per snapshot refresh, never per request (D55-126) |

- **Mode**: enforcing only with both models promoted for the files this process loaded, no platform switch (or ROOT's own, or unreadable)
  and the tenant's own switch read as off; else shadow. Re-read every 30 s off the path; a tenant not read yet, or whose switch was last
  read over 60 s ago, is shadow; tenants already known are refreshed before new ones (D55-127). A promotion the gate has not re-checked
  within 36 h, or two files that are not the pair measured together, are shadow too (`promotedStages`, D55-128, D55-130).
- **Outcome**: machine, cron, webhook and device lanes allow and signal (FWA-6). A signed-in person below the block threshold gets auth's
  session step-up refusal (401 `SESSION_STEP_UP_REQUIRED`: the browser's step-up banner), never on the step-up, sign-out and session routes
  and not again within an hour of a step-up proved on THAT session (the fold's `sup:<session tag>` counter; another session of the person
  is asked as before, D55-125); an anonymous caller a progressive delay (250 ms doubling, at most 2 s); no CAPTCHA in the API path. Above
  it: a 403 whose only detail is the support reference (`fw-…`, also in the actor's signal). The limiter never counts the gate's own 403 or
  401 as the address's miss (D40-10(d), D55-129).
- **Proposals** (FWD-8): at the terminate threshold, both keys turned and enforcing, `user_session.end_session` (the session) and
  `user_security.revoke_trusted_devices` (the person, a platform action under ROOT) are written as `proposed` with the tenant's mode for the
  action (both Suggest-only), once per tenant, action and actor per 10 minutes. The responder (05) runs them.
- **Audit sample**: 1 % of the requests stage 1 calls normal are scored by stage 2 in shadow; a miss (an attack class leading at or above
  `challenge`) is counted.
- **Series**: `ai_firewall_cascade_decisions_total{mode,verdict}`, `_applied_total{action}`, `_skipped_total{reason}`,
  `_audit_total{result}`, `_stage_time_total{stage,le_us}`, `_over_budget_total{stage}`, `ai_firewall_cascade_cache{state}`,
  `ai_firewall_cascade_signals_total{result}`.
- **Load**: the 3 333 req/s run is a siege-server plan, never run here ([04-cascade-siege-plan.md](../../docs/phases/55-ai-firewall/04-cascade-siege-plan.md)).

**Explanations** (4.10, D55-123): each history entry of an incident keeps each model's three largest raising contributions, and the score
timeline says them as one sentence per model ("Behaves unlike itself: …", "Looks like enumeration: …") from the dictionaries
(`ui/ai-firewall-explain.sentences.ts`, `ai_firewall.explain.<feature>` in en and tr).

**Evasion** (4.11, D55-121): the hover watch above; stage 2 counts the address's row beside the person's, for a challenge only
(D55-124: every caller behind a shared address writes it, FWA-5); training weighs down what a client shapes for free (`server/training/training.evasion.ts`: LightGBM `feature_contri`, XGBoost `feature_weights`, 0.5).

## Files

| File | What |
|---|---|
| `server/trees/tree-ensemble.types.ts` | The one tree shape both formats parse into; `ModelRefusedError` |
| `server/trees/lightgbm.parse.ts` | LightGBM 4.x text model → ensemble; refuses categorical splits, linear trees, random forest, other objectives |
| `server/trees/xgboost.parse.ts` | XGBoost 3.x JSON model → ensemble; base score to margin; refuses dart, gblinear, forests, categorical, multi-output |
| `server/trees/tree-ensemble.predict.ts` | Each library's split rule (`nextNode`), raw scores, sigmoid / softmax |
| `server/trees/tree-shap.ts` | Path-dependent TreeSHAP (a port of LightGBM's), each library's bias; local accuracy holds |
| `server/cascade/cascade.ts` | `decideCascade`: the two stages, cold start, audit sample, lanes, shadow, two keys, proposed actor actions, hovering (4.11) |
| `server/cascade/ai_firewall.request-cascade*.ts`, `ai_firewall.cascade-*.ts` | The cascade in the request path (4.8): the gate, its runtime boot task and series, the actor cache, the recorder, the thresholds, the hover watch |
| `ui/ai-firewall-explain.sentences.ts` | 4.10: a model's raising contributions as one sentence from the dictionaries |
| `server/training/training.evasion.ts` | 4.11: the features weighed down in training |
| `server/models/shipped-models.ts` | Loads a shipped model: sha256, parse, feature and output checks; never throws |
| `server/models/shipped-models.generated.ts` | The shipped models as code (generated, do not edit) |
| `server/models/shipped-models.meta.ts` | The meta shape check, shared by the loader and the embed script |
| `server/engines/lightgbm.wasm.ts`, `xgboost.wasm.ts` | Wrappers of the vendored libraries' C APIs: train (with optional row weights), load, predict, contributions, save |
| `vendor/lightgbm/`, `vendor/xgboost/` | The official libraries as WebAssembly (`*.mjs`), `build.sh` (pinned, `--check` reproduces), `BUILD.json`, licences |
| `server/intake/ai_firewall.signal-mapping.ts` | Audit rows and domain events as `SecuritySignal` input (kinds, actors, lanes, outcomes, untrusted strings, allow lists) |
| `server/intake/ai_firewall.audit-sink.ts`, `ai_firewall.event-sink.ts` | The `audit_log:record_sink` and `webhook:event_sink` contributions: map and `emitSecuritySignal` |
| `server/intake/ai_firewall.intake-metrics.ts` | Runtime boot task: the intake's `ai_firewall_signals_*` series on both `/metrics` |
| `server/store/ai_firewall.store.ts` | The store's tables, signal -> row, platform = ROOT tenant, action statuses and `canTransition` |
| `server/store/ai_firewall.event-store.ts` | One tenant's batched `INSERT … ON CONFLICT DO NOTHING` of event rows |
| `server/store/ai_firewall.signal-consumer.ts` | The `fw:signals` consumer (boot task `startSignalConsumer`) and its metrics |
| `server/store/ai_firewall.retention.job.ts` | The nightly per-tenant retention (boot task `scheduleFirewallRetentionJob`) |
| `server/entities/` | `AiFirewallEvent`, `AiFirewallIncident`, `AiFirewallAction` (migration 001; the incident's grouping columns migration 003), `AiFirewallBaseline` (migration 002) |
| `server/ai_firewall.timeseries.ts` | The `db:time_series` declaration of the events table |
| `server/ai_firewall.setting.keys.ts`, `.settings.fields.ts`, `.settings-policy.ts` | The settings: retention, kill switches, default mode, per-action modes; `effectiveActionMode` |
| `server/registry/ai_firewall.registry.validate.ts` | The boot checks of the four registries (pure) and the catalogue of what passed |
| `server/registry/ai_firewall.registry.ts` | Loads the four points (system context), the boot guard `assertFirewallRegistries`, `firewallRegistry()` |
| `server/ai_firewall.export-collection.ts`, `.privacy-erasure.ts`, `.tenant-purge.ts` | Export, erasure and purge of the store |
| `server/ai_firewall.activity.types.ts` | The activity response, shared by the route, the service and the page (types and constants only) |
| `server/ai_firewall.activity.service.ts` | Assembles the activity response: model cards, cascade mode, security counts and events, bans |
| `server/ai_firewall.cascade-mode.ts` | `cascadeMode`: off / shadow / enforcing from the two stages' loaded and promoted state |
| `server/ai-firewall-activity.route.ts` | `GET /api/ai-firewall/activity` (GLOBAL, `ai_firewall.activity.read`) |
| `server/ai_firewall.catalogue.types.ts`, `.catalogue.dto.ts`, `.catalogue.service.ts` | The catalogue pages: the two catalogues, the tenant's modes, the mode write and its audit row |
| `server/ai-firewall-actions.route.ts`, `ai-firewall-signals.route.ts` | `GET` / `PUT /api/ai-firewall/actions` (TENANT, `ai_firewall.actions.manage`), `GET /api/ai-firewall/signals` (TENANT, `ai_firewall.events.read`) |
| `server/ai_firewall.firewall-signals.ts` | This module's own signal kinds: `ai_firewall.action_mode_changed`, `ai_firewall.incident_status_changed`, `ai_firewall.incident_labelled`, `ai_firewall.request_pattern`, the promotion store's four kinds, `ai_firewall.cascade_decision` (4.8) |
| `server/ai_firewall.honeytoken.service.ts`, `server/ai-firewall-honeytokens.route.ts` | The canary list (02.5): each registered decoy's state, reference and bait for the tenant; `honeytokenDetectorKinds` |
| `server/features/ai_firewall.feature-catalogue.ts` | The two catalogues `behaviour.v1` / `attack.v1` as data, their pinned content hashes |
| `server/features/ai_firewall.feature-windows.ts` | Windows, scopes, the Redis key layout, bucket math and expiry, the closed field sets |
| `server/features/ai_firewall.feature-id.ts` | The keyed hash of actor ids and tags (HKDF from the settings key) |
| `server/features/ai_firewall.request-meta.ts` | A request as counts and classes (route class, status class, shape, indicators, user agent family, anomalies) |
| `server/features/ai_firewall.request-fold.ts` | The request half: the observer, the in-process fold, the flush timer (runtime boot task `startRequestFeatures`) |
| `server/features/ai_firewall.signal-fold.ts` | The signal half: `fw:signals` rows as updates, the feature group's consumer (boot task `startSignalFeatures`) |
| `server/features/ai_firewall.feature-writer.ts` | The one bounded pipeline: the fold and profile scripts, PFADDs, the work list |
| `server/features/ai_firewall.feature-read.ts` | An actor's windows and today's profile in one bounded round trip |
| `server/features/ai_firewall.feature-vector.ts` | The vector of a catalogue from windows, baseline, prior and context (pure) |
| `server/features/ai_firewall.feature-store.ts` | `actorFeatures`: both vectors of an actor, cold start, fail open |
| `server/features/ai_firewall.baseline.ts`, `.baseline.store.ts`, `.baseline.job.ts` | Baselines and role priors: EWMA, the table, the daily job (`scheduleBaselineJob`) |
| `server/entities/ai_firewall_baseline.entity.ts` | `AiFirewallBaseline` (migration 002) |
| `server/features/ai_firewall.rule-catalogue.ts` | `rules.v1`: the features only the rules and detectors read, pinned |
| `server/detect/ai_firewall.risk.ts` | The scorers' shape (`RiskScore`, contributions per catalogue), `ScoredDetection`, detector ids |
| `server/detect/ai_firewall.detectors.ts` | The ten detectors (pure) |
| `server/detect/ai_firewall.rule-scorer.ts` | Rule scorer v0: weighted rules + detections, noisy-OR, additive contributions |
| `server/detect/ai_firewall.detection-queue.ts` | The detectors' bounded work list, the batch's actors, the hand-off listeners |
| `server/detect/ai_firewall.detection-evaluator.ts` | The periodic evaluator (boot task `startDetectionEvaluator`) and its series |
| `server/detect/ai_firewall.request-pattern.ts` | The request fold's nomination: the bars and the counts-only signal |
| `server/incidents/ai_firewall.incident-model.ts` | Incidents as pure rules: grouping, peak, severity, timeline, transitions, alert specs |
| `server/incidents/ai_firewall.incident-store.ts` | The grouping's statements (join, open, expire; the one-active index) and the row shape |
| `server/incidents/ai_firewall.incident-recorder.ts` | The worker's recorder (boot task `startIncidentRecorder`) and its series |
| `server/ai_firewall.incident.types.ts`, `.incident.dto.ts`, `.incident.service.ts` | The incident pages: shapes, strict input, list / timeline / actor view / change |
| `server/ai-firewall-incidents.route.ts`, `ai-firewall-incident.route.ts`, `ai-firewall-actor.route.ts` | The incident and actor routes (table above) |
| `server/ai_firewall.alert-source.ts` | `observability:alert-source`: open incidents with a peak of 60 or more; on ROOT's sweep the models' demotion, drift and staleness (4.7, 4.9) |
| `server/migrations/003_ai_firewall_incident_grouping.sql` | The grouping's columns and `uq_ai_firewall_incidents_active` (expand) |
| `server/migrations/004_ai_firewall_labels.sql`, `server/entities/ai_firewall_label.entity.ts` | The label store `ai_firewall_labels` (expand; RLS + FORCE from birth) and `AiFirewallLabel` |
| `server/labels/ai_firewall.label-model.ts` | Labels as pure rules: the closed lists, a verdict / decoy touch / ban decision as a row, the counter's shape |
| `server/labels/ai_firewall.label-store.ts` | The label statements (write once or replace, read, withdraw) and `detectorVerdictCounts` |
| `server/labels/ai_firewall.label-producer.ts` | The consumer's label producer: decoy touches, bans an operator placed or lifted, the probe lane's and benign traffic's stamped events |
| `server/labels/ai_firewall.probe-labels.ts` | The run-id rule's second half: a stamped event as a `synthetic` / `benign_traffic` label by the install role, and its counters |
| `server/migrations/005_ai_firewall_label_runs.sql` | The label's `runId` and `idx_ai_firewall_labels_run` (expand) |
| `server/migrations/006_ai_firewall_label_vectors.sql` | The labelled vectors: `ai_firewall_incidents."peakVectors"`, `ai_firewall_labels."vectors"` (expand) |
| `server/migrations/007_ai_firewall_label_ref_at.sql` | `idx_ai_firewall_labels_ref_at` (tenant, refAt): the label retention by the behaviour's time, the export's reads (expand) |
| `server/dataset/ai_firewall.vector-capture.ts` | The kept vectors' shape, staging / demo only, an event label's actor read when it is produced |
| `server/dataset/ai_firewall.dataset-export.ts` | The export's pure core: the install guard, the allow-list, the re-keyed ids, the rows, the manifest |
| `server/dataset/ai_firewall.dataset-source.ts` | The export's reads: each tenant's labels with vectors in its own transaction, bounded |
| `common/server/common.firewall-probe-gate.ts`, `common.firewall-probe-run.ts` (in `common`) | The trust rule at the dispatcher and the request's stamp that `emitSecuritySignal` applies |
| `server/ai-firewall-incident-label.route.ts` | `PUT /api/ai-firewall/incidents/[incidentId]/label` (a person's verdict) |
| `ui/ai-firewall-incidents.page.tsx`, `ui/ai-firewall-incidents.helpers.ts`, `ui/ai-firewall-explain.labels.ts` | Security -> AI firewall incidents: the list, the incident and actor drawer; its rules; the words of an explanation |
| `ui/ai-firewall-catalogue.page.tsx`, `ui/ai-firewall-catalogue.helpers.ts` | Security -> AI firewall: actions and modes, the signals drawer, the decoys drawer (02.5); the page's pure rules |
| `ui/ai-firewall.page.tsx` | Platform -> AI firewall, root tenant only |
| `ui/ai-firewall-settings.page.tsx`, `ui/ai-firewall-settings-link.component.tsx` | Settings -> AI firewall (with the privacy note, 02 §2.8) and its card on the settings overview |
| `dictionaries/` | Every page string as `ai_firewall.*` keys (en, tr) |
| `scripts/embed-models.mts` | `npm run ai-firewall:embed-models [-- --check]`: `models/` → the generated file |
| `scripts/export-dataset.mts` | `npm run ai-firewall:export-dataset -- [--out <dir>] [--days <n>]`: the PII-free dataset of a staging or demo install (03 §3.5) |
| `server/training/training.classes.ts` | The label classes onto the attack model's classes (one table), the behaviour target |
| `server/training/training.dataset.ts` | Reading the export: manifest, pinned catalogue, allow-list, row count; the rows a model learns from |
| `server/training/training.split.ts` | The holdout by time: train, calibration, test, at hour boundaries |
| `server/training/training.constraints.ts` | The 4.1 constraints: parameter checks, the trained model loaded as the request path loads it |
| `server/training/training.parity.ts` | Library against evaluator on edge and holdout rows before a model is written |
| `server/training/training.metrics.ts`, `training.independence.ts` | Losses, early stopping, AUC, threshold choices, actor-day FPR; the independence report |
| `server/training/training.train.ts` | The training run: both models, metas, the report (`runTraining`) |
| `server/training/training.synthetic.ts`, `training.synthetic-marks.ts`, `training.random.ts` | The synthetic dataset and its marks; the seeded generator |
| `scripts/train-models.mts`, `scripts/synthetic-dataset.mts` | `npm run ai-firewall:train`, `npm run ai-firewall:synthetic-dataset` |
| `server/shadow/ai_firewall.shadow-score.ts` | 04.6: both models score an actor's vectors in shadow (verdicts at the meta's thresholds, contributions) |
| `server/shadow/ai_firewall.shadow-tally.ts` | 04.6: the HyperLogLogs of active and flagged actors per day and the drift histograms per week; the gate's reads |
| `server/promotion/ai_firewall.promotion-model.ts` | 4.7: the gate's criteria (`evaluateGate`), the transitions, the hold and release, `stagePromoted` (pure) |
| `server/promotion/ai_firewall.promotion-evidence.ts` | 4.7: what shadow saw over 28 days across every tenant (incidents, verdicts, labels' vectors) |
| `server/promotion/ai_firewall.promotion-store.ts`, `.promotion.service.ts`, `.promotion-view.ts` | 4.7: the state rows and their audit rows, the override, the page's view |
| `server/promotion/ai_firewall.promotion.job.ts` | 4.7: the daily and boot run (boot task `schedulePromotionGate`) |
| `server/promotion/ai_firewall.drift.ts` | 4.9: bins, PSI, the report, ISO weeks, the model's age |
| `server/ai-firewall-models.route.ts`, `server/ai_firewall.models.dto.ts` | `PUT /api/ai-firewall/models`: the ROOT owner's hold and release |
| `server/entities/ai_firewall_model_state.entity.ts`, `server/migrations/008_ai_firewall_model_states.sql` | The promotion store and the incidents' `models` (expand; RLS + FORCE from birth) |
| `ui/ai-firewall-promotion.helpers.ts` | The activity page's gate section: overrides until a later read, the criteria and drift rows |
| `models/` | Trained model files and their `<name>.meta.json` (none yet: the first come from a training run on a real export) |

## Shadow, the promotion gate and drift (04.6, 4.7, 4.9; FWD-12)

**Shadow** (D55-106, D55-115). The worker's detection evaluator scores every actor it takes with both shipped models next to the rules
(`server/shadow/ai_firewall.shadow-score.ts`): the behaviour model (LightGBM) people, sessions and API keys with a baseline of their own,
the attack model (XGBoost) every actor kind; the same vectors, the shared `RiskScore` (margin contributions by TreeSHAP for a scoring that
is handed on), the verdict at the meta's thresholds (behaviour `normal` / `suspicious` / `step_up`; attack `benign` / `below` /
`challenge` / `block` / `terminate`) and the model file's short sha. Nothing acts on them. A flag (step-up or above) is handed to the
incident grouping even without a rule (reason `model.attack` / `model.behaviour`); the alert source alerts on the rules' peak only. The
incident keeps each model's track (`models`, migration 008) and its history the models' scores; the incident drawer shows the three
scorers side by side. The tally (`server/shadow/ai_firewall.shadow-tally.ts`): per model file and UTC day HyperLogLogs of the actors
scored and flagged (`fw:sh:a:*`, `fw:sh:f:*`, 40 days), per ISO week the drift histogram (`fw:sh:h:*`, 70 days), written once a minute per
worker, members a 16-hex hash. Series `ai_firewall_shadow_scorings_total{model,result}`.

**The gate** (`server/promotion/`, D55-107 to D55-113). Daily at 04:30 UTC and once at boot on the leader (boot task
`schedulePromotionGate`). A model is **promoted with no human step** when every criterion holds, and **demoted back to shadow on its own**
when a later evaluation fails one:

| Criterion | Holds when |
|---|---|
| `loaded` | the shipped file loaded: sha256 verified against its meta, parsed under the evaluator's constraints |
| `not_synthetic`, `trained_by_pipeline`, `thresholds_met`, `independence_ok` | the meta's part (`promotionRefusals`, 04.1, 04.4); independence `ok` against a bound no looser than 0.5 (D55-131) and measured on this very pair: the model's meta and the loaded other stage's name each other's sha256 (`independencePaired`, D55-130) |
| `parity_green` | the trainer's parity record within the library's tolerance (D55-108) |
| `shadow_period` | at least 14 days in shadow on this install, since this model file was first seen |
| `evidence_complete` | every tenant and the shadow counts were read (D55-109) |
| `false_positive_rate` | flagged actor-days nobody confirmed as an attack ≤ 0.1 % of active actor-days, on at least 3 000 (last 28 days) |
| `precision` | behaviour: ≥ 0.5 true positives among the flagged incidents people judged (with at least 10) |
| `class_metrics` | attack: per class with at least 20 probe labels, precision ≥ 0.9 and recall ≥ 0.8 (where present) |
| `benign_false_positives` | attack: ≤ 0.1 % of the benign-traffic labels flagged (where present) |
| `no_confirmed_false_positive` | no flagged incident called a false positive by a person (step-up or above) |
| `drift_quiet` | the latest weekly drift check is quiet |
| `not_held` | no ROOT owner holds the model in shadow |

The store is `ai_firewall_model_states` (migration 008; one row per model under ROOT, tenant RLS + FORCE; no personal data, D55-111):
the model file's sha256, shadow / promoted, the shadow start, the last promotion and demotion with the failing criteria, the hold, the
last verdict and the drift reference and report. Every change is an audit row (`ai_firewall.model_promoted`, `.model_demoted`,
`.model_held`, `.model_released`; also signal kinds). A stage counts as promoted only for the file this process loaded, when not held and
when the gate evaluated it within the last 36 h (`stagePromoted`; a gate that cannot run demotes to shadow on its own, D55-128); the
cascade enforces only with both promoted, the two files the pair measured together (`promotedStages`) and no kill switch. The 4.8 request
path reads the same (every 30 s).

**The override** (D55-112): `PUT /api/ai-firewall/models { model, action: hold | release, reason }`, GLOBAL scope with the ROOT
membership role OWNER and `ai_firewall.actions.manage`. A hold demotes a promoted model at once and keeps it in shadow until released
(across model files); a release only lifts the hold, the next evaluation decides. There is no promote action.

**Drift** (`server/promotion/ai_firewall.drift.ts`, D55-110): each feature binned at the model's own split thresholds (at most 9) plus a
missing bin, ten score bins; the reference is the model's first week in shadow here with 500 scorings (kept in its row), each later
complete week compared with it; PSI above 0.25 for the score or any feature is drifting (keeps shadow, alert), a model older than 180 days
is stale (alert only). **Alerts** (ROOT's `observability:alert-source` sweep, D55-114): `model.<name>.demoted` (MAJOR, WARNING for a
release that changed the file) for 7 days while in shadow, `model.<name>.drift` (MINOR), `model.<name>.stale` (WARNING),
`model.<name>.gate_not_run` (no evaluation in 36 h: MAJOR while promoted, WARNING in shadow; D55-128).

## The libraries inside the module (D55-2)

`vendor/lightgbm/lightgbm.mjs` and `vendor/xgboost/xgboost.mjs` are the official LightGBM 4.7.0 and XGBoost 3.4.2 C libraries compiled
from their release sources to WebAssembly (one ES module each, the wasm inside). `build.sh` beside each pins the source tarball by
sha256 and Emscripten 6.0.13, and `build.sh --check` proves the vendored file is byte-for-byte reproducible; `BUILD.json` records the
inputs and the output hash; the licences (LightGBM MIT; Eigen MPL-2.0 part, fmt, fast_double_parser, nanoarrow; XGBoost and dmlc-core
Apache-2.0) are in each folder. `server/engines/lightgbm.wasm.ts` and `xgboost.wasm.ts` wrap their C APIs (train, load, predict,
contributions, save).

They train the models and are the parity reference: `lightgbm.parity.test.ts` and `xgboost.parity.test.ts` train real models and
check the TypeScript evaluator against the library on edge rows. The request path uses the evaluator (microseconds per row, no wasm
instance), so the 3 MB modules are loaded only by training and tests.

## Training (04.1, 04.4)

`npm run ai-firewall:train -- --dataset <export dir> --out <new dir>` trains both models offline on the build host with the vendored
libraries (single-threaded wasm, fixed seed), from a 03.5 export (`npm run ai-firewall:export-dataset` on staging or the demo) or the
synthetic dataset (`npm run ai-firewall:synthetic-dataset -- --out <dir>`, CI and smoke runs only). Options: `--only behaviour|attack`,
`--seed`, `--rounds` (500), `--patience` (30), `--max-error-correlation` (0.5, at most 0.5: a stricter bound only, D55-131).

- **Input checks**: the manifest's format and columns, each dataset's catalogue name, version, features and pinned hash against today's
  catalogue, every row against the export's allow-list, the row count against the manifest. Anything else: exit 2, nothing written.
- **Rows** (D55-101): one per labelled reference (most confident label; equally confident labels that disagree drop it), cold-start rows
  out of the behaviour set, weight = balanced class weight × label confidence. The label classes reach the attack model's classes through
  one table, `training/training.classes.ts` (D55-99).
- **Time holdout** (D55-100): train 70 %, calibration 15 % (early stopping, thresholds), test 15 % (metrics, independence); never cut
  inside an hour.
- **Constraints** (4.1, D55-102): the parameters are checked before training; the model about to be written is loaded with
  `loadModelSource` (the parsers' refusals, objective, features, outputs, sha256) plus LightGBM's recorded parameters, and checked against
  the library (parity); a failure writes nothing.
- **Output** in `--out` (never `models/`): `behaviour.model.txt`, `attack.model.json`, `<name>.meta.json` (the loader's fields plus
  `catalogueHash`, `synthetic`, `thresholds`, `thresholdTargetsMet`, `independence`, `training`: dataset, window, parameters, seed, rounds,
  class weights, metrics, parity; D55-105) and `training-report.json` (both models' metrics, the independence report).
- **Independence** (4.4, D55-103): on the joint test references, the error correlation pooled within class against the bound, the
  mistakes' correlation, the false-positive overlap and the ablation; `ok`, `flagged`, `insufficient` or `not_run`, in the report and both
  metas, each meta naming the other model's sha256 (`independence.peerSha256`, D55-130); exit 1 unless `ok`.
- **The one-class attack variant** (`binary:logistic` with one attack class): its P(benign) is 1 − P(attack), so a row under one half is
  benign in the cascade and in the trainer's threshold choice alike (D55-132).
- **Synthetic** (D55-104): a dataset is synthetic by its manifest or its tenant marks; its models carry `synthetic: true` and are refused
  by the embed step, the loader (`synthetic`) and `promotionRefusals` (the meta's part of the 4.7 gate).

## Shipping a model

1. Train offline (`npm run ai-firewall:train`, above), review `training-report.json`, and copy `behaviour.model.txt` /
   `attack.model.json` with their meta files into `models/`.
2. `npm run ai-firewall:embed-models`.
3. Commit both; the staleness test fails when they disagree.
