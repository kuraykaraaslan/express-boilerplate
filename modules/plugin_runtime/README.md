# Plugin Runtime Module

Sandboxed execution runtime for untrusted community plugins. A plugin bundle runs inside a V8 isolate (`isolated-vm`) in a **separate, credential-less host process**; it can only reach data, network, storage, and crypto through a frozen `host.*` capability object whose every call is forwarded over token-authenticated RPC to a **broker** that re-enforces scope and runs the real operation with credentials the isolate never sees.

For how to *author* a plugin (bundle contract, manifest schema, contribution points, local dev workflow), see **[`PLUGIN_AUTHORING.md`](./PLUGIN_AUTHORING.md)**. This README describes the runtime itself.

---

## Runtime architecture (three execution tiers)

Within the unified module workspace, this package supplies runtime pieces that
three separate execution tiers compose. Tenant-facing routes and pages are
declared through module manifests and dispatched by the app catchalls:

```
browser ──HTTP──► web/dispatch tier ──run RPC──► plugin-host (V8 isolate, NO creds)
                        │                              │  host.<cap>.<method>()
                        │                              ▼
                        └───────────────────► broker tier (HOLDS creds: db / http / secrets)
                                              POST /internal/api/plugin-broker  (Bearer brokerToken)
```

1. **Web/dispatch tier** — calls `runOnHost(...)` (`server/rpc/host-client.ts`) to run a plugin's `http` / `event` / `provider` handler. Imports no `isolated-vm`.
2. **Plugin-host process** (`server/index.ts`, default `:4500`) — a standalone Node HTTP server holding **no** DB/storage credentials. It owns the isolate pool and runs untrusted bundle code. Started with `--no-node-snapshot` (required by `isolated-vm`).
3. **Broker tier** (`server/broker/broker.service.ts`) — the **only** tier with DB/storage credentials. It receives each `host.*` call over RPC, re-validates the capability grant + scope, and executes by reusing first-party services. Imports no `isolated-vm`, so it never enters the untrusted path.

Both RPC hops (web→host `/run`, host→broker `/internal/api/plugin-broker`) are Bearer-token authenticated (`tokensMatch`, constant-time-ish) and meant for a private/loopback interface.

---

## Entities

| Entity | Table | Description |
|---|---|---|
| `PluginKv` | `plugin_kv` | Per-`(tenantId, pluginId, collection, key)` KV / document store — the **only** persistence a sandboxed plugin gets (`host.data`). Value is `jsonb`. Plugins never touch a DataSource; the broker reads/writes this table on their behalf. Composite primary key includes `tenantId` so a marketplace uninstall can purge a tenant's plugin data. |

Lives in the **tenant DB**, resolved per request via `tenantDataSourceFor(tenantId)`; every row is isolated by `tenantId`.

Plugin **settings** and **secrets** are not stored here — they live in the `setting` module under namespaced keys (`plugin:<pluginId>:*` plaintext, `plugin_secret:<pluginId>:*` encrypted).

---

## Runtime / Sandbox

`server/host/` (loaded only inside the plugin-host process):

- **`sandbox.ts`** — one V8 `Isolate` per plugin **version**, compiled bundle cached. No `process`, `fs`, `require`, `fetch`, or module system leaks into the isolate; a minimal `btoa`/`atob` shim is injected because isolates lack the web/Node globals. Each isolate handles **one call at a time**; the per-call tenant context (`_ctx`) is set host-side under the borrow lock, so a plugin can neither read nor spoof its tenant/plugin/grants.
- **`isolate-pool.ts`** (`SandboxManager`) — a pool of warm sandboxes per version (`PLUGIN_POOL_SIZE`, default 4). Borrow → run → release; a crashed/timed-out/OOM sandbox is disposed and recreated, never reused.
- **`isolate-bootstrap.ts`** — generates the in-isolate bootstrap: the frozen `host.*` shim (built from `CAPABILITY_SURFACE`) plus the `__invokeHttp` / `__invokeEvent` / `__invokeProvider` dispatch helpers. Only granted capabilities are present on `host`; accessing an ungranted one throws.

- **`plugin-host.process.ts`** (`runPluginHostProcess`, the entry `server/index.ts` calls it): the HTTP face (`createPluginHostServer`) and the process, supervised or not (docs/phases/14-docker/07 task 7, kind `plugin-host`). With `PROC_PLUGIN_HOST_ENABLED=true` (the plugin-host image default since task 8; `npm run plugin-host:start` stays one process) it is process_host's credential-less **local supervisor**: `node:cluster` children of the same entry all serve `PLUGIN_HOST_PORT` (4500, so `PLUGIN_HOST_URL` does not change; each child has its own sandbox pools), scaled by the p95 of the **wait for a free sandbox** over the last 10 s (`SandboxManager` `onWait`: 0 for a free or new sandbox, the queue time otherwise, the borrow timeout for a call that gave up): up when it holds > 50 ms for 30 s, down when it stays < 10 ms and the children's CPU < 30 % of a core for 10 min. The supervisor serves `/healthz`, `/metrics` and `/supervisor` on `PLUGIN_HOST_SUPERVISOR_PORT` (4501); the worker relays `/supervisor` into the Scaling view (process_host `supervisor.relay.ts`, from the host of `PLUGIN_HOST_URL`). A drained child (process_host's shared drain protocol: a scale-down gets the 60 s grace, a supervisor shutdown `SHUTDOWN_GRACE_MS`) closes its listener, answers every request it already received (`SandboxManager.inflight` reaches 0) with `Connection: close`, waits for its last connection to end (process_host `trackHttpDrain`: connections are cut only past the grace), disposes its sandboxes and exits. Tests: `host/isolate-pool.test.ts` (the wait and the in-flight count), `host/plugin-host.process.test.ts` (one process, the drain, and the entry supervised with two real cluster children).

Three call kinds cross the boundary as JSON (everything must be JSON-serializable):

- `http` — route key `"GET path"` (with a `'*'` catch-all fallback) → the plugin's `http` handler, given a **sanitized** `PluginRequest` (never a raw NextRequest / cookies / auth header).
- `provider` — `"<point>#<op>"` → the plugin's `providers[point][op]` op-set (contribution into a host extension point).
- `event` — event name → the plugin's `events[name]` handler.

---

## Capabilities (the `host.*` surface)

`sdk/types.ts` → `CAPABILITY_SURFACE` is the single source of truth; the isolate shim, the broker registry, and the `Capability` type all derive from it. Each capability is implemented in its own file under `server/broker/capabilities/` and registered in `broker.service.ts`'s `CAPABILITIES` table (the build fails if a declared capability has no implementation). Every method is `async` (it crosses isolate→broker).

| Capability | Methods | Broker implementation |
|---|---|---|
| `data` | `get` · `put` · `delete` · `list` | `PluginKv` table, auto-scoped to `(tenant, plugin)`. No SQL exposed. |
| `http` | `fetch` | SSRF-guarded, allowlisted egress with host-side secret injection (see *Security*). |
| `settings` | `get` · `getMany` · `set` | Plugin-namespaced plaintext config via `SettingService` (`plugin:<id>:*`). |
| `secrets` | `get` | Read-only, decrypted host-side (`decryptFieldOpt`); no list/enumerate. |
| `storage` | `put` · `getUrl` · `delete` | Blob storage via `StorageService`, scoped under `plugins/<pluginId>/`: `getUrl` and `delete` refuse a key outside `<tenant>/plugins/<pluginId>/` (`ownStorageKey`). |
| `events` | `log` · `emit` | Structured logging (`Logger`) + scoped audit entries (`AuditLogService`, action `plugin.<id>.<event>`). |
| `crypto` | `verifyJwks` · `signJwt` · `signData` · `hmac` · `signXml` · `hash` · `randomBytes` · `verifyEd25519(message, sigHex, publicKeyHex)` · `verifyRsa(data, sigBase64, publicKeyPem)` | Verification/signing done host-side; private keys stay in the broker. |
| `saml` | `generateAuthUrl` · `validateResponse` | SP keys never enter the isolate. |
| `smtp` | `send` | Host-side mail send. Attachments: a `message/*` or `multipart/*` content type is refused; every file goes base64 with an explicit disposition. |
| `webpush` | `send` | Host-side web-push send. |
| `localfs` | `write`, `delete` | Host-side disk I/O for the local disk storage plugin (`@local/storage`): the object goes under the platform's `storageLocalDir` (ROOT setting, never the plugin's), in the calling tenant's own subtree only, through storage's path checks and atomic write (`storage.local.fs.ts`); at most 16 MB per write. The same trust as a bucket key. |

> Note: the client-facing `PluginHost` interface in `sdk/types.ts` types the common subset (`data`, `http`, `settings`, `secrets`, `storage`, `events`); `CAPABILITY_SURFACE` is the authoritative, fuller grant list the runtime actually exposes.

---

## SDK

`sdk/` is pure types + tiny browser helpers — no Node, no `isolated-vm`, no DB — so it can be shipped to plugin authors and imported by both the host and the broker.

- **`sdk/types.ts`** — the authoring ABI: `CAPABILITY_SURFACE`, `Capability`, `PluginHost` and the per-capability sub-APIs, `PluginRequest` / `PluginResponse`, `HttpHandler` / `EventHandler` / `ProviderOpSet`, and the `PluginModule` entrypoint (`http` / `events` / `providers` / `register`).
- **`sdk/client.ts`** — the tiny UI client a plugin's **iframe** bundle imports: `pluginFetch()` (postMessage → parent proxies to `/api/plugins/<listingId>/*`), `pluginResize()`, `fireAction()`, `setHostOrigin()`. It never holds app credentials. `fireAction()` posts a payload-free `{ type: 'pluginAction' }`: on a dashboard placement (iframe render tier) the host runs the action the board editor configured for that card; elsewhere it does nothing.

---

## RPC / wire protocol

`server/rpc/protocol.ts` defines the wire types and reads config straight from `process.env` (no env-schema coupling, keeping the host process self-contained and creds-less):

- `RunRequest` / `RunResult` — web→host. Bundle code is sent only on a host cache miss (`needBundle`); `host-client.ts` fetches the approved bundle lazily and retries once.
- `BrokerRequest` / `BrokerResult` — host→broker, one capability call.
- `SandboxConfig` — capabilities, `httpAllowlist`, and `limits` (`memoryMb`, `timeoutMs`, `httpTimeoutMs`, `httpMaxBytes`), all bound from the **reviewed manifest** host-side.

`server/broker/broker-client.ts` (`makeBrokerDispatch`) is the host-side dispatcher that forwards each `host.*` call to the broker; `server/broker/install-keys.ts` exposes neutral setting-key helpers (`plugin.community.<listingId>.version` / `.active`) shared by the marketplace (writer) and runtime resolver (reader) with no cross-dependency.


`server/broker/install-keys.ts` also holds the namespace of the second bundle source, the operator's local store (`plugin_local`, OD-139): `localPluginArtifactId` (`local:<pluginId>` in the `installs` ledger), `isLocalPluginArtifact` (the marketplace's ledger sweeps skip those rows), `localRuntimePluginId` (`local/<scopedName>`, the `SandboxConfig.pluginId` no marketplace scoped name can be) and `localInstallKeys` (`plugin.local.<pluginId>.{version,active}`).

## Shared bundle-source helpers (Core since OD-139)

Everything a bundle source needs that is not about marketplace commerce lives here, so the Enterprise `marketplace*` modules and the Core `plugin_local` source run the same code (the old marketplace paths re-export these):

- `server/bundle/bundle-integrity.ts` — `sha256Hex`, `assertDeclaredChecksum`, `verifyBundleSignature` (Ed25519 over the digest, SPKI base64), `validateSigningPublicKey`, `assertBundleMatches`, `parseSbom`, `MAX_BUNDLE_BYTES` (5 MB).
- `server/bundle/bundle-loader.ts` — `loadBundleCode(bundleKey, sha256)`: reads the ROOT-stored bundle and re-hashes it on every cold load.
- `server/bundle/bundle-scan.ts` — `getBundleScanStatus`: the storage virus-scan verdict of a stored bundle.
- `server/bundle/builtin-bundles.ts` (+ `builtin-bundles.generated.ts`, `npm run gen:builtin-bundles` / `check:builtin-bundles` from `scripts/gen-builtin-bundles.mts`) — plugins whose bundle ships with the platform (today `@local/storage`). A version row names one as `builtin:<scopedName>`; `loadBundleCode` answers it from code (never storage) and still checks the recorded checksum; `getBundleScanStatus` answers `skipped`. This is what lets the local disk storage plugin install on a platform that has no storage yet.
- `server/manifest/plugin-manifest.ts` — the manifest contract: `parseManifest` + `nonExternalPoints` (EXT-8), the block/widget schemas and their rejections, semver helpers, and the STRICT `parseSandboxedManifest` / `validateSandbox` (`runtime: 'isolated'`, capabilities within `CAPABILITY_SURFACE`, hostname-only allowlist, declared endpoint settings, bounded integer limits, unknown keys refused) plus `capLimits`.
- `server/config/plugin-config.service.ts` — per-tenant plugin settings and encrypted, write-only secrets (`plugin:<pluginId>:<key>`, `plugin_secret:<pluginId>:<key>`), the endpoint-change secret clearing, and `egressHostsFromSettings`.
- `server/rpc/provider-invoke.ts` — `makeProviderInvoke`: the `invoke` of an `external:contributions` contribution (isolate call, EXT-7 quarantine mapped to `ProviderUnavailableError`).

---

## API Routes

This module defines the runtime and broker logic; the tenant-facing HTTP surface (marketplace lifecycle, per-plugin config, and `/tenant/{tenantId}/api/plugins/{listingId}/{...path}` dispatch) is wired by the `marketplace` module + `app/`, and the internal broker endpoint (`POST /internal/api/plugin-broker`, Bearer `brokerToken`, loopback-only) is served host-side. See the *HTTP endpoints* section of [`PLUGIN_AUTHORING.md`](./PLUGIN_AUTHORING.md) for the full route list.

The plugin-host process itself exposes two internal HTTP endpoints (not for browsers): `GET /healthz` and `POST /run` (Bearer `hostToken`).

---

## Admin Pages

- `/tenant/{tenantId}/admin/plugins/[listingId]` (`ui/plugin-host.page.tsx`) — host page for a single community plugin's sandboxed UI, rendered by `PluginFrame`.

`ui/plugin-frame.component.tsx` is the trusted host side of the plugin UI: it renders the plugin's UI from a **separate origin** in an `<iframe sandbox="allow-scripts allow-forms">` (no `allow-same-origin`, so the iframe is an opaque origin and cannot read the app's cookies/storage). The only bridge is `postMessage` — the frame authenticates a message by its source window (`event.source` must be its own iframe's `contentWindow`; the opaque iframe reports `origin === "null"`, which identifies nothing, so the origin is not compared and replies are addressed `'*'` to that window only, as the dashboard template frame does, dashboard `POSTURE.md` §5), strips path traversal, then proxies data calls to the plugin's own scoped API using the logged-in tenant's session. Requires `NEXT_PUBLIC_PLUGIN_UI_ORIGIN` to be set.

`PluginFrame` takes an optional `onAction` (threaded through `ui/plugin-frame-slot.component.tsx`, the `dashboard.plugin_frame` slot contribution). A `pluginAction` message that passes the same source check calls it with no argument; any other field in the message is ignored, and at most one action per `PLUGIN_ACTION_MIN_INTERVAL_MS` (1 s) runs, the rest are dropped. The dashboard passes the placement's card-click runner, so a plugin can ask for its card's configured action but never choose one (dashboard `POSTURE.md` §8).

---

## Security

The trust boundary is enforced at multiple layers:

- **Process isolation** — untrusted code runs in a separate plugin-host process that holds no DB/storage credentials; an OOM/crash there never takes down the app.
- **V8 isolation** — `isolated-vm`, memory + wall-clock limits per call, no Node globals, one call per isolate so no shared-mutable-global races.
- **Capability gating** — enforced twice: in the isolate host-shim (`__hostCall` checks `_ctx.capabilities`) and again in the broker (`requireCap`). Only manifest-granted capabilities exist on `host`.
- **Bound, unspoofable scope** — `tenantId` / `pluginId` / grants / `httpAllowlist` are set host-side per call, never supplied by the bundle.
- **HTTP egress** (`http.capability.ts`) — restricted to the manifest `httpAllowlist` (final substituted host re-checked), `http`/`https` only, DNS-rebinding-safe SSRF check (`assertSafeWebhookUrl`), per-call timeout, response-size cap (`httpMaxBytes`), and `redirect: 'manual'` so a redirect can't escape the allowlist.
- **Secret injection without leakage** — a plugin can place `{{secret:NAME}}` in an `http.fetch` URL/header/body, or use `basic: { username, secretName }`; the broker substitutes the decrypted secret **host-side** (`substituteSecrets` / `resolveSecret`; `{{secret:NAME|form|url|xml|json}}` encodes it for its context) and re-validates the final URL. `host.secrets.get(...)` returns plaintext into the isolate only when the `secrets` capability is granted.
- **Trust-critical crypto host-side** — JWKS/JWT verification, XML-DSig, and signing with private keys run in the broker; keys never enter the isolate.
- **Token-authenticated RPC** — both hops require a Bearer token compared in constant-ish time; the broker endpoint is loopback/private.

`scripts/selftest.mts` (`npm run plugin:selftest`) asserts these guarantees end-to-end: capability round-trips, ungranted caps absent, per-call tenant ctx isolation under concurrency, no Node-global leaks, and timeout enforcement.

---

## Configuration

Read from `process.env` by `loadRuntimeConfig()` (`server/rpc/protocol.ts`):

| Var | Default | Purpose |
|---|---|---|
| `PLUGIN_HOST_PORT` | `4500` | Plugin-host listen port. |
| `PLUGIN_HOST_URL` | `http://127.0.0.1:4500` | Web tier → plugin-host base URL. |
| `PLUGIN_HOST_TOKEN` | none (required) | Bearer token for the `/run` hop. Unset = the hop refuses every call (no public default). |
| `PLUGIN_BROKER_URL` | `http://127.0.0.1:3000/internal/api/plugin-broker` | Plugin-host → broker endpoint. |
| `PLUGIN_BROKER_TOKEN` | none (required) | Bearer token for the broker hop. Unset = the broker refuses every call (no public default). |
| `PROC_PLUGIN_HOST_ENABLED` | off (image: `true`) | Plugin-host: run as the supervisor of node:cluster children sharing `PLUGIN_HOST_PORT` (process_host; also `PROC_PLUGIN_HOST_MIN` / `_MAX` / `_UP_AT` …). |
| `PLUGIN_HOST_SUPERVISOR_PORT` | `4501` | Plugin-host supervisor: `/healthz`, `/metrics`, `/supervisor`. |
| `PLUGIN_POOL_SIZE` | `4` | Sandboxes per plugin version, shared by every tenant on it, so it is the platform-wide concurrency for that version (a storage plugin's uploads, URL builds and deletes all queue on it). Created lazily; worst-case memory is this times the version's `memoryMb`. |
| `PLUGIN_MEMORY_MB` | `128` | Default isolate memory limit. |
| `PLUGIN_BORROW_TIMEOUT_MS` | `10000` | Plugin-host: how long a call waits for a free sandbox of its plugin version. Past it the host answers 503 and the web tier returns a retryable 503 with `Retry-After`. |
| `PLUGIN_HOST_REQUEST_TIMEOUT_MS` | derived | Web tier: abort deadline for one `/run` request to the plugin-host (reported as a timeout). Unset, it is borrow timeout + 3 x the plugin's `timeoutMs` + 5 s, so only a host that stopped answering is cut off. |
| `PLUGIN_TIMEOUT_MS` | `5000` | Default wall-clock limit per call. |
| `PLUGIN_HTTP_TIMEOUT_MS` | `5000` | Default `host.http.fetch` timeout. |
| `PLUGIN_HTTP_MAX_BYTES` | `2000000` | Default `host.http.fetch` response cap. |
| `NEXT_PUBLIC_PLUGIN_UI_ORIGIN` | — | Separate origin serving plugin UI bundles (required for the admin frame). |

Per-plugin limits/capabilities/allowlist come from the reviewed manifest and override the env defaults per call.

---

## Tenant Variability

Every capability operation is scoped to the request `tenantId`: `plugin_kv` rows, plugin settings/secrets (namespaced setting keys), storage folders, and audit entries are all per tenant. The **same** community plugin version runs for many tenants against the same cached isolate bundle, but each call carries its own bound `tenantId`, so a plugin's data, config, and secrets never cross tenant boundaries. Install/activation state is per tenant via `plugin.community.<listingId>.*` (marketplace) and `plugin.local.<pluginId>.*` (plugin_local) setting keys.

---

## Dependencies

Requires (`module.json`): `db`, `env`, `process_host` (the plugin-host's credential-less supervisor and child helpers, which load neither env, logger nor Redis), `setting`, `storage`, `audit_log`, `webhook`, `e_signature`, `common`. The broker composes these first-party services to back capabilities (`setting` → settings/secrets, `storage` → storage, `audit_log` → events, `webhook` → SSRF guard `assertSafeWebhookUrl`, `common` → field encryption). Uses `isolated-vm` for the V8 sandbox (loaded only in the plugin-host process). Closely related to the `marketplace` module, which publishes/installs plugins and serves the tenant-facing lifecycle + dispatch routes, and to `plugin_local` (Core), the operator's own bundle source.
