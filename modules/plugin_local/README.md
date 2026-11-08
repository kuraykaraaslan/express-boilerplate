# Local Plugins (`plugin_local`)

The Core source of sandboxed plugins (owner decision OD-139, `docs/phases/35-editions-licensing/README.md`).
`plugin_runtime` is Core, but until this module the only way a sandboxed plugin reached a tenant was the
Enterprise marketplace. With `plugin_local` the platform operator (the ROOT tenant's admins) uploads a plugin
bundle, approves what it may do, and installs it for tenants directly: for example a payment gateway plugin
for `payment:gateway` on a Pro deployment.

Edition `core`, tier `platform`. It requires only Core modules (`npm run check:editions`).

## How it works

```
ROOT operator                           tenant
  upload manifest.json + plugin.js        (admin) Settings → Local plugins: settings + secrets
  approve the sandbox grant
  install for tenant X ──► installs ledger row  artifactType 'plugin', artifactId 'local:<pluginId>'
                           plugin.local.<pluginId>.{version,active}  (projection the resolver reads)
                                         │
host point (payment:gateway …) ─► listExternalContributions ─► plugin_local.source ─► runOnHost (isolate)
```

Every operator route is GLOBAL scope: the root-tenant super-admin behind the KD-13 admin gate (IP allowlist + MFA),
like the operator's per-tenant module install and the marketplace review of third-party code, and 404s on any URL
tenant other than ROOT.

1. **Upload** (`POST /api/plugin_local/plugins`, GLOBAL): JSON `{ manifestJson, bundleBase64, scopedName?, bundleSha256?, signature?, signerKid? }`,
   the same JSON + base64 shape as the marketplace's version submission. The manifest goes through the strict
   `parseSandboxedManifest` (plugin_runtime): `sandbox.runtime === 'isolated'`, capabilities within
   `CAPABILITY_SURFACE`, `httpAllowlist` entries are hostnames, `httpAllowlistFromSettings` names declared config
   settings, limits are bounded integers, unknown keys are refused, `block.serverHandler` and `widget.script` are
   refused, and every extension point must declare `external: true` (EXT-8). The bundle is capped at 5 MB, hashed by
   the server (a declared checksum must match), and stored with `StorageService.uploadServerBuffer(ROOT, { folder:
   'plugin-bundles', scan: true })`: an infected file is refused. The body is counted as it is read (a chunked upload
   with no `content-length` is cut off at the cap, 413). Versions are semver and strictly increasing per plugin;
   concurrent uploads of one plugin serialise on the advisory lock `plugin_local:upload:<scopedName>`, and the loser
   gets a 409 with its stored bundle deleted. The bundle needs a storage backend under the ROOT tenant, and the
   storage backends are plugins themselves: on a fresh platform (or an on-premise install with no bucket) run
   `npm run storage:local` first. It registers the built-in local disk plugin `@local/storage`, whose bundle ships with
   the platform (bundle key `builtin:@local/storage`, loaded from code: `registerBuiltinVersion`, no upload, no scan),
   approves its `localfs` grant, installs it for ROOT and selects `storageProvider=local`. Then upload the S3 plugin or
   any other, and keep the disk if no bucket is wanted. A built-in version passes `pluginLocalRequireSigned` as the
   platform's own code, only while its checksum is the one this platform ships (`stillTrusted`). Bundles already stored on the disk are
   not moved when the provider is switched later: upload them again.
2. **Signatures.** Optional Ed25519 signature over the SHA-256 digest bytes, verified ONLY against keys the operator
   registered in the ROOT setting `pluginLocalTrustedKeys` (`[{ kid, publicKey }]`, SPKI base64). An unknown kid or a
   signature that does not verify is refused. With `pluginLocalRequireSigned` (default false) an unsigned version is
   refused at upload, approval, install and on every dispatch, and removing a key stops the versions it signed.
3. **Approve** (`PUT /api/plugin_local/versions/[versionId] { action: 'approve', grant? }`, GLOBAL): the operator is
   the reviewer. The grant defaults to what the manifest requests and may only narrow it: capabilities, hosts and
   endpoint settings must be ones the manifest asked for, and a limit the manifest declared may only be lowered (a
   limit it left out is the operator's call). Every limit is capped at the platform maximum:
   `loadRuntimeConfig().defaultLimits`, lowered (never raised) by the ROOT setting `pluginLocalMaxLimits`, and
   re-capped on every dispatch; changing that ceiling evicts the approved versions' warm isolates (the host fixes an
   isolate's memory at first load). The approved grant is stored in `sandboxJson`; the runtime never reads
   capabilities from the live manifest. Approval and install need a finished, passing scan: `clean`, or `skipped`
   when scanning is off. `pending` and `error` are refused (409) until the scanner answers, `infected` is refused
   (422), and a late `infected` verdict stops the version on every tenant at the next dispatch (cached 60 s).
4. **Yank** (`{ action: 'yank', reason? }`): the version is never installable or runnable again, warm isolates are
   evicted (`evictPluginVersions`). **Disable** (`PUT /api/plugin_local/plugins/[pluginId] { status }`) stops a plugin
   on every tenant without removing installs.
5. **Install per tenant** (`PUT /api/plugin_local/plugins/[pluginId]/installs { tenantId, action, versionId? }`,
   GLOBAL): `install` takes the current approved version (or a pinned one), re-hashes the stored bundle, refuses a
   version that provides a `point#key` another local plugin installed in that tenant already provides (hosts pick a
   provider by key; a marketplace plugin with the same key is not visible to Core, so the operator page lists each
   version's points), then writes the ledger row and the projection settings together under the advisory lock
   `plugin_local:install:<tenant>:<plugin>`, audits `plugin_local.install` and emits `plugin.installed`.
   `activate` / `deactivate` flip the row and the projection under the same lock. `uninstall` deletes the row and the
   projection under the lock, then the plugin's settings and secrets in that tenant (prefix match is literal: `a_b`
   never purges `a-b`), its `plugin_kv` rows and the files it stored (`<tenant>/plugins/local/<scopedName>/…`), and
   emits `plugin.uninstalled`.
6. **Run.** `plugin_local.source.ts` is a default-exported `external:contributions` source mirroring the marketplace's:
   for each installed, active, runnable plugin of the tenant that declares the asked point it returns
   `{ key, metadata, configured, invoke, version }`. `invoke` runs the op in the isolate (`makeProviderInvoke`) with a
   `SandboxConfig` built by `resolveLocalPlugin` from the approved grant, `getBundle` re-checks the SHA-256, and a
   quarantined version (EXT-7) becomes `ProviderUnavailableError(…, 'quarantined')`.
7. **Config** (`GET|PUT /api/plugin_local/installed/[pluginId]/config`, tenant admin): the marketplace's storage scheme
   (shared `plugin_runtime/server/config/plugin-config.service`): settings at `plugin:local/<scopedName>:<key>`,
   secrets encrypted at `plugin_secret:local/<scopedName>:<key>`, write-only. Only declared keys are written; changing
   an endpoint setting clears the secrets not re-entered with it. These are the only writers of an endpoint setting:
   the generic settings API refuses every `plugin:` / `plugin_secret:` key (`isPluginConfigKey`), and the plugin's
   own `settings.set` refuses the grant's `httpAllowlistFromSettings` keys (`SandboxConfig.protectedSettingKeys`), so
   neither a tenant admin nor the plugin can point the egress allowlist, and the `{{secret:…}}` it carries, at another
   host. A tenant never inherits ROOT's `plugin_secret:` values.

## Decisions

- **Operator-controlled installs.** Only GLOBAL routes install, switch or remove a local plugin for a tenant. A tenant
  admin configures the settings and secrets of what was installed for it, nothing else. Every key under
  `plugin.local.` and the trust settings are refused by the generic settings API (`tenant_setting.write.maker-checker`
  `isLedgerProjectionKey`) and are never inherited from ROOT; the readers accept only `plugin.local.<uuid>.version`
  with a uuid value, so a stray key can never break the tenant's other local plugins.
- **Webhooks share the marketplace's event names.** `plugin.installed`, `plugin.activated`, `plugin.deactivated` and
  `plugin.uninstalled` carry `source`: `'marketplace'` with `{ listingId, versionId }` (uninstall: `{ listingId,
  scopedName }`), or `'local'` with `{ pluginId, scopedName, versionId }` (activate/deactivate: `{ pluginId,
  versionId }`; uninstall: `{ pluginId, scopedName }`). A subscriber that reads `listingId` should check `source`.
- **The module must also be enabled for the tenant.** The common bridge asks a source only while its module is
  enabled for the tenant (`contributionsFor('external:contributions', tenantCtx(tenantId))`), so a plugin runs for a
  tenant when the operator installed and activated it there AND `plugin_local` is enabled there. That is why the module
  is placed `tenant` with root parts (`placement`, docs/phases/46-module-placement): a root or fleet module is never on for
  a customer tenant, so its source would never run there. The operator page shows, per install, whether the module is on for that tenant.
- **Namespaces cannot collide with the marketplace.** Ledger `artifactId` is `local:<pluginId>` (marketplace rows are
  bare listing uuids; the marketplace's ledger sweeps skip `local:` rows), settings use `plugin.local.*` (not
  `plugin.community.*`), and the runtime plugin id is `local/<scopedName>` (marketplace scoped names start with `@`), so
  KV, settings, secrets and storage of a local plugin never mix with a marketplace plugin's.
- **No duplicated logic.** Bundle integrity, bundle scan verdict, bundle loader, the manifest contract, plugin config
  and the provider invoke live in Core `plugin_runtime`; the marketplace modules re-export them from their old paths.
- **No HTTP proxy yet.** Local plugins serve provider points (`external:contributions`). The marketplace's
  `/api/plugins/<listingId>/*` HTTP dispatch and `dashboard:listing_activity` still understand only marketplace installs.

## Data

| Entity | Table | Scope |
|---|---|---|
| `LocalPlugin` | `plugin_local_plugins` | System, ROOT-only (RLS-exempt like `marketplace_listings`): `pluginId`, unique `scopedName`, `name`, `status` (`active`/`disabled`), `currentVersionId`, `createdBy` |
| `LocalPluginVersion` | `plugin_local_versions` | System, ROOT-only: `version` (unique per plugin), `manifestJson`, `sandboxJson` (approved grant, null until approved), `bundleKey`, `bundleUploadedFileId`, `bundleSha256`, `signature`, `signerKid`, `signatureVerified`, `uploadedBy`, `approvedBy/At`, `yankedAt/Reason` |

Per-tenant state lives in Core tables it does not own: the `installs` ledger (`module_lifecycle`), the settings
(`tenant_setting`) and `plugin_kv` (`plugin_runtime`).

## Routes and permissions

| Route | Scope | Permission |
|---|---|---|
| `GET, POST /api/plugin_local/plugins` | GLOBAL (404 on any URL tenant but ROOT) | `plugin_local.plugins.manage` |
| `PUT /api/plugin_local/plugins/[pluginId]` | GLOBAL | `plugin_local.plugins.manage` |
| `GET, PUT /api/plugin_local/plugins/[pluginId]/installs` | GLOBAL | `plugin_local.plugins.manage` |
| `PUT /api/plugin_local/versions/[versionId]` | GLOBAL | `plugin_local.plugins.manage` |
| `GET, PUT /api/plugin_local/trust` | GLOBAL | `plugin_local.plugins.manage` |
| `GET /api/plugin_local/installed` | TENANT | `plugin_local.config.read` |
| `GET, PUT /api/plugin_local/installed/[pluginId]/config` | TENANT | `plugin_local.config.read` / `.write` |

All three permissions have `minRole: ADMIN`. Pages: `/admin/platform/local-plugins` (root operator: trust policy,
upload, versions with requested and approved grants, approve, yank, disable, installs per tenant) and
`/admin/local-plugins` (tenant: settings and secrets of the installed local plugins).

## Settings (ROOT)

| Key | Default | Meaning |
|---|---|---|
| `pluginLocalTrustedKeys` | `[]` | `[{ kid, publicKey }]`, Ed25519 SPKI base64 |
| `pluginLocalRequireSigned` | `false` | refuse unsigned versions |
| `pluginLocalMaxLimits` | `{}` | lower ceiling than the runtime's for `memoryMb`, `timeoutMs`, `httpTimeoutMs`, `httpMaxBytes` |

Written only through `PUT /api/plugin_local/trust` (validated, audited `plugin_local.trust.update`).

## Tests

`server/tests/`: the store (strict manifest, size, base64, checksum, signatures required / invalid / unknown kid,
infected / pending / failed scan, version order and the upload lock, scoped-name rules, approval narrowing of
capabilities, hosts and limits, capping), install + resolve + source + config (approval before install and run, yank,
disable, tampered bundle, key removal, late infected verdict, protected endpoint settings, junk projection keys,
`point#key` clash, the RLS-bypassing tenant lookup, `local/` namespace, tenant isolation of installs, settings and
secrets, uninstall purge of config, KV and files), `plugin_local.routes-authz.security.test.ts` (the REAL guard: GLOBAL
scope, the KD-13 MFA gate, tenant roles refused) and `plugin_local.routes.test.ts` (non-root URL tenant, guard
refusal, mass assignment, declared and chunked size cap, secret never returned). The shared fixes have their own
tests: `plugin_runtime/server/broker/capabilities/tests/storage-settings.capability.security.test.ts` and the
tenant_setting write/read path and security tests.
