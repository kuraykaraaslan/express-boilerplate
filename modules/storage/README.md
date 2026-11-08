# Storage Module

Multi-provider, tenant-aware cloud storage abstraction. A unified S3-compatible API for upload (multipart `File` or from URL), delete, and URL generation across AWS S3, Cloudflare R2, DigitalOcean Spaces and MinIO and the server's own disk (`local`, plugin `@local/storage`), every one a sandboxed plugin. Each tenant resolves its own provider, bucket and credentials from Setting rows; every successful upload is recorded in a per-tenant `UploadedFile` audit ledger and metered against the tenant's storage quota.

---

## Entities

| Entity | Table | DB | Description |
|---|---|---|---|
| `UploadedFile` | `uploaded_files` | tenant | Immutable audit row per successful upload (`key`, `bucket`, `provider`, `size`, `mimeType`, `url`, `userId`). Soft-deleted (`deletedAt`) on delete; joined with `TenantUsage.storageBytes` for billing/quota. Indexed on `tenantId`, `userId`, `key`. `retainUntil` / `retentionReason` are null while the tenant lives; a tenant purge sets them on the files a module must still retain (`storage.purge-retention.ts`, migration `001_uploaded_files_retention.sql`, docs/phases/37-extensions/11). |

---

## Files

| File | Purpose |
|---|---|
| `storage.service.ts` | Core: per-tenant provider resolution, feature-gating, upload (`uploadFile` / `uploadFromUrl`), `deleteFile`, `getFileUrl`, audit persistence |
| `storage.types.ts` | `UploadOptions`, `UploadFromUrlOptions`, `ProviderUploadResult`, `UploadResult`, `S3Config` |
| `storage.dto.ts` | `UploadFileDTO`, `UploadFromUrlDTO`, `DeleteFileDTO`, `GetFileUrlDTO` |
| `storage.enums.ts` | `StorageProviderType`, `StorageFolder`, `StorageExtension`, `StorageMimeType` |
| `storage.folders.ts` | Runtime folder registry (`registerStorageFolder`, `isValidStorageFolder`) — modules add folders without editing the core enum |
| `storage.mime-groups.ts` | MIME group definitions + `expandMimeGroups` (group → MIME types) |
| `storage.validation.ts` | Pre-upload validation: size, extension allowlist, magic-byte sniffing, EXIF strip, content-derived MIME (`deriveMimeType`) + `allowedMimeTypes` allowlist; the declaration checks of direct uploads (`validateDeclaredName`, `assertDeclaredSize`, `contentMatchesExtension`) |
| `storage.sigv4.ts` | Dependency-free SigV4 query presigning: `presignS3GetUrl`, `presignS3PutUrl` (Content-Type / Content-Length bound), `presignS3Url` (any method, extra signed headers) |
| `storage.direct-upload.ts` | Browser-direct uploads: `presignUpload`, `completeUpload`, `sweepStagingUploads` (see "Browser-direct uploads") |
| `storage.direct-upload.store.ts` | Redis state of direct uploads: sessions (by `sha256(uploadId)`), the single-use claim, completed answers, the staging-object index |
| `storage.upload-sweep.job.ts` | BullMQ repeatable job (every 30 min) deleting staging objects of uploads that never completed |
| `storage-uploads-presign.route.ts` / `storage-uploads-complete.route.ts` | The presign and complete routes |
| `storage.bucket-cors.ts` | Bucket CORS for direct uploads: `getBucketCorsStatus`, `applyBucketCors` (merge), the tenant's app origins, CORSConfiguration XML build / parse (see "Bucket CORS") |
| `storage-bucket-cors.route.ts` | The bucket CORS status (GET) and apply (POST) route |
| `ui/storage-upload.client.ts` | Re-exports `common/ui/direct-upload.client` (`uploadFileDirect`, `uploadToStorage`, `uploadErrorMessage`): presign, PUT, complete, with the multipart fallback; its test keeps common's presign answer type identical to `PresignUploadResult` |
| `providers/isolated.provider.ts` | `IsolatedStorageProvider`: the host facade of a bucket plugin (validation, keys, URLs host-side; PutObject/DeleteObject in the isolate) |
| `providers/local-disk.provider.ts` | `LocalDiskProvider`: the host facade of the local disk plugin (`@local/storage`): writes through the plugin, signed app URLs and `getServerPath` host-side |
| `storage.local.fs.ts` | The disk layer: key checks, symlink-safe resolve, atomic write, delete, free-space floor (used by the facade's reads and the broker's `localfs` capability) |
| `storage.local.signing.ts` | The HMAC-signed object URLs of the disk and their verification |
| `storage.local.serve.ts` / `storage-local-object.route.ts` | `GET`/`HEAD /api/storage/local/object`: serves a disk object to the holder of a signed URL |
| `storage.local.config.ts` / `storage.local.setting.keys.ts` | `storageLocalDir` / `storageLocalMinFreeMb` (ROOT only), `STORAGE_LOCAL_DIR`, the default directory; `STORAGE_LOCAL_KEYS` |
| `storage.messages.ts` | Error/success message strings |
| `storage.setting.keys.ts` | `STORAGE_KEYS` setting key constants |
| `storage.scan.setting.keys.ts` | `STORAGE_SCAN_KEYS` virus-scan setting key constants |
| `storage.scan.enums.ts` | `VirusScanProvider`, `VirusScanStatus`, `VirusScanMode`, `VirusScanInfectedAction` |
| `storage.scan.types.ts` | `ScanConfig`, `ScanResult` |
| `storage.scanner-factory.ts` | `getScanConfig(tenantId)` + `createScanner(config)` |
| `storage.scan.service.ts` | `scan(config, bytes, filename)` + `handleInfected(...)` (quarantine/delete) |
| `storage.scan.job.ts` | BullMQ async scan queue/worker + `enqueueVirusScan` |
| `scanners/base.scanner.ts` | Abstract `FileScanner` base class |
| `scanners/virustotal.scanner.ts` | VirusTotal v3 adapter |
| `storage.seed.ts` | Demo seed for the `UploadedFile` ledger (5 providers, 1 soft-deleted) |
| `entities/uploaded_file.entity.ts` | `UploadedFile` audit entity |
| `providers/base.provider.ts` | Abstract `BaseStorageProvider` base class |
| `providers/aws-s3.provider.ts` | AWS S3 |
| `providers/cloudflare-r2.provider.ts` | Cloudflare R2 |
| `providers/digitalocean-spaces.provider.ts` | DigitalOcean Spaces |
| `providers/minio.provider.ts` | MinIO (self-hosted) |

---

## Service / Responsibilities

`StorageService` (default export) is fully tenant-scoped — every public method takes `tenantId`:

| Method | Responsibility |
|---|---|
| `uploadFile(tenantId, data)` | Feature-gate, resolve the tenant's provider, upload a `File`, persist the audit row, return `UploadResult` (with `uploadedFileId`). |
| `uploadFromUrl(tenantId, data)` | Same as above but fetches the bytes from a remote URL. |
| `deleteFile(tenantId, data)` | Delete the object from the bucket and soft-remove the matching `UploadedFile` audit row. |
| `getFileUrl(tenantId, data)` | Return the object URL from the tenant's resolved provider. |

Private helpers:

- `getStorageSettings(tenantId)` — reads `STORAGE_KEYS` via `SettingService.getByKeys` and builds the per-tenant `S3Config` (provider, bucket, region, credentials, endpoint).
- `createProvider(name, config)` — maps the resolved provider name to the concrete provider class.
- `getProvider(tenantId, providerName?)` — resolves the tenant default provider unless the request explicitly overrides it.
- `persistUploadAudit(...)` — best-effort: writes the `UploadedFile` row into the tenant DataSource and increments `TenantUsageService.incrementStorageBytes`. Failures are logged, never thrown.
- `assertStorageFeatureAccess(tenantId)` — defense-in-depth billing gate (see *Security*).

---

## Providers

The active provider is resolved per tenant from the `storageProvider` setting (or overridden per request via the DTO `provider` field). Each provider extends `BaseStorageProvider` and implements `uploadFile`, `uploadFromUrl`, `deleteFile`, `getFileUrl`.

`StorageProviderType` values: `aws-s3`, `s3`, `cloudflare-r2`, `digitalocean-spaces`, `minio`, `local`. Every backend is a sandboxed plugin, the local disk too (`@local/storage`, see "Local disk (on-premise)"); no provider is built in. The service `createProvider` switch routes `aws-s3`, `cloudflare-r2`, `digitalocean-spaces` and `minio` to their classes (an unmapped name throws `PROVIDER_NOT_FOUND`).

### Adding a New Provider

1. Extend `BaseStorageProvider` in `providers/`
2. Add the value to `StorageProviderTypeSchema` in `storage.enums.ts`
3. Register it in the `createProvider` switch in `storage.service.ts`
4. Add any new setting keys in `storage.setting.keys.ts`

---

## Local disk (on-premise)

A sandboxed plugin like every other backend: `@local/storage` (`modules/marketplace/examples/@local/storage`), key `local` of `storage:provider`. An isolate has no filesystem, so the plugin hands each object to the broker capability `localfs` (`write`, `delete`; plugin_runtime `localfs.capability.ts`), the same split the SMTP plugin makes with `smtp`. The plugin chooses nothing about where the bytes land: the directory and the floor are the platform's settings, and the broker refuses a key outside the calling tenant's subtree. What a bucket plugin's facade builds host-side (its public URL) the disk facade (`LocalDiskProvider`) builds host-side too: the signed app URL, and the real path for server readers. `getProvider` gives a plugin under the key `local` that facade instead of the bucket one, and is otherwise unchanged: plugins only, strict, an uninstalled backend is an error, never a switch to the disk.

**Installing it.** Its bundle ships with the platform (bundle key `builtin:@local/storage`, `plugin_runtime/server/bundle/builtin-bundles.ts`, generated from the example by `npm run gen:builtin-bundles`), so it installs on a platform that has no storage yet. `npm run storage:local` (TENANT_ID defaults to ROOT) registers it in the local plugin store (`plugin_local`), approves the grant its manifest asks for (`localfs` only), installs it and sets `storageProvider=local`; an operator can do the same on /admin/platform/local-plugins. The writes run in the plugin-host, so it must be running.

**What it is.** A directory on the server's own disk. Objects are files at `<dir>/<tenantId>/<folder>/<file>`, the key scheme every provider uses, so tenants are isolated by the same prefix check as on a bucket (`assertTenantObjectKey`, F.storage.01). It exists for two reasons: on-premise installs that have no bucket and never will, and bootstrapping a fresh platform. A plugin upload writes its bundle to storage and `loadBundleCode` reads it back, so with no storage backend the S3 plugin itself could not be uploaded; with the local disk plugin installed it can (`npm run storage:local`).

**Settings** (platform level: read from the ROOT tenant only, refused in any other tenant; Settings > Storage, card "Storage Provider", visible to the platform tenant):

| Key | Meaning |
|---|---|
| `storageProvider` | `local` selects it (per tenant, inherited from the platform like every storage setting). |
| `storageLocalDir` | Absolute base directory, no `..`, not the filesystem root. Empty: env `STORAGE_LOCAL_DIR`, else `<working directory>/.local-storage` (gitignored). Created with mode 0700 if missing; files are 0600. |
| `storageLocalMinFreeMb` | A write that would leave less than this free on the volume is refused with 507. Default 512, `0` switches it off. |

**Directory, permissions, Docker.** The app's user needs read/write on the directory and nobody else should (0700). In Docker mount a volume and point the setting or `STORAGE_LOCAL_DIR` at it, e.g. `-v nb_files:/var/lib/nb/storage -e STORAGE_LOCAL_DIR=/var/lib/nb/storage`; without a volume the files die with the container. Back up the directory together with the database (the `uploaded_files` rows name the keys); a restore of one without the other leaves rows without files or files without rows.

**Single node.** The directory is on one machine (the broker that writes runs in the web app, the same process that serves the signed URLs). Several app nodes need it to be a shared mount (NFS, a clustered volume), or they will not see each other's files; for several nodes with separate disks use a bucket plugin. The store identity a migration compares is `file://<host name><dir>`, so two machines with the same path are two stores, never one shared bucket.

**Serving.** A browser never reaches the disk: it gets an app-signed URL, `GET /tenant/<id>/api/storage/local/object?key=&exp=&sig=` (HMAC-SHA256 over version, tenant of the path, key and expiry; the key is derived from `ACCESS_TOKEN_SECRET`; constant-time compare; no session). Lifetimes: `getPresignedUrl(tenantId, key, seconds)` expires as asked (at most 7 days); `getFileUrl` and the `url` an upload result carries last 7 days; objects under `branding/`, `avatars/` and `headers/` (logos, wallpapers, profile images: public by nature, and a column stores their URL) get a URL that never expires, and the verifier accepts `exp=0` for no other key. A bad, expired, other-tenant or missing object, and a symlink out of the directory, all answer the same 404. Only images, audio and video are served inline (a PDF is a download: browsers do not run their PDF viewer under the sandbox CSP); html, svg, xml and unknown types are always an attachment, with `nosniff` and a `sandbox` CSP. `Range` is supported. Rate limited per IP.

**Server-side readers.** Code that reads an object back into the server (plugin bundle loader, `downloadBuffer`, telephony prompts, the scan job, the migration copy and the download links) uses `getServerReadUrl`, which for the disk is the `file://` URL of the real path (a missing object, or a symlink that leaves the directory, is a 404) and for a bucket provider the presigned URL as before. Never hand a `file://` URL to a browser.

**Safety.** Keys are checked lexically (no `.`, `..`, separators, NUL) and against the real filesystem: the directory a write lands in and an object that is read must resolve inside the real base directory, so a planted symlink reaches nothing outside it; a symlink at the target of a write is replaced, not followed. Writes are atomic (temporary file in the destination directory, fsync, rename). The same validation as for a bucket applies (folder registry, extension and MIME allowlists, size caps, EXIF strip, scanning).

**Limits to know.** Browser-direct uploads are not offered (the client falls back to the multipart route, `reason: local_provider`); the bucket CORS panel does not apply. A `url` stored in a row at upload time expires after 7 days (except `branding/`, `avatars/`, `headers/`): resolve with `getFileUrl` at render time rather than persisting the URL. Switching `storageProvider` does not move objects: the ones already written stay in the old store and are unreadable through the new one until migrated or uploaded again (for the plugin store: re-upload the bundles after switching).

## API Routes

| Method | Path | Scope | Description |
|---|---|---|---|
| POST | `/tenant/[tenantId]/api/storage` | tenant, authenticated | Multipart upload (`FormData`: `file`, optional `folder` default `general`, optional `provider`). Rate-limited (`api`). Returns `uploadedFileId`, `url`, `key`, `bucket`, `size`, `provider`. |
| POST | `/tenant/[tenantId]/api/storage/uploads/presign` | tenant member (`storage.files.upload`, TENANT scope) | Browser-direct upload, step 1. JSON `{ name, size, type?, folder?, provider? }`. Answers `{ mode: 'direct', uploadId, method, url, headers, expiresAt, maxBytes, multipartMaxBytes }` or `{ mode: 'multipart', reason, maxBytes }`. |
| POST | `/tenant/[tenantId]/api/storage/uploads/complete` | tenant member (`storage.files.upload`, TENANT scope) | Browser-direct upload, step 3. JSON `{ uploadId }`. Verifies and records the object; answers what the multipart route answers. |
| GET | `/tenant/[tenantId]/api/storage/bucket-cors` | tenant admin (`tenant_setting.config.read`, TENANT scope) | Does the bucket allow the direct-upload PUT from every app origin? `{ state, bucket, origins, missingOrigins, code?, httpStatus? }`. Read-only. |
| POST | `/tenant/[tenantId]/api/storage/bucket-cors` | tenant admin (`tenant_setting.config.update`, TENANT scope) | Merge the direct-upload CORS rule into the bucket (other rules kept). `{ applied, status }`. Audited (`storage.bucket_cors.applied`). |
| GET / HEAD | `/tenant/[tenantId]/api/storage/local/object` | tenant, no session (the signature is the credential) | An object of the local disk store for the holder of its app-signed URL (`?key=&exp=&sig=`); plugin `@local/storage`; uniform 404; `Range`; see "Local disk (on-premise)". |
| GET / HEAD | `/tenant/[tenantId]/api/storage/links/[token]` | tenant, no session (token is the credential) | App-signed machine download link; `Range`, `?aud=`; see "Links for machines". |

Storage settings are read/written through the shared admin-settings surface (`GET/PUT /tenant/[tenantId]/api/admin-settings`), not a storage-specific route.

---

## Usage

```typescript
import StorageService from '@/modules/storage/storage.service';

// Upload a file (tenantId-first)
const result = await StorageService.uploadFile(tenantId, {
  file,
  folder: 'users',
  filename: `${userId}.webp`,
  tenantId,
});
// result.url, result.key, result.bucket, result.size, result.provider, result.uploadedFileId

// Upload from a remote URL
const fromUrl = await StorageService.uploadFromUrl(tenantId, {
  url: 'https://example.com/avatar.png',
  folder: 'users',
});

// Delete a file (soft-deletes the audit row)
await StorageService.deleteFile(tenantId, { key: result.key });

// Get the object URL
const url = await StorageService.getFileUrl(tenantId, { key: result.key });
```

### Upload Result

```typescript
type UploadResult = {
  url: string;
  key: string;
  bucket: string;
  size?: number;
  provider: StorageProviderType;
  uploadedFileId?: string;
};
```

---

## Browser-direct uploads

The multipart route carries at most 10 MiB per request (see "Upload validation &
MIME"). Direct uploads take the bytes off the app entirely: presign, the browser
PUTs to the bucket, complete. The client lives in common
(`common/ui/direct-upload.client`, re-exported as `ui/storage-upload.client.ts`)
so any module's UI can use it: Drive (its own presign/complete routes), the media
gallery, the schema-form image fields, the page builder's block images and theme
fonts, and `AvatarUpload` (tenant branding, profile pictures) go direct, each with
the multipart route as the fallback. A 413 from any route reaches the caller as
`DirectUploadError('too_large')` (with `details.maxBytes` when the route reports
it), and `uploadErrorMessage` names the file and the limit.

1. **Presign** checks the declaration before anything is signed, with the rules
   the multipart path applies to a received file: plan gate, the tenant's
   extension and MIME allowlists (MIME derived from the extension, never the
   client's), the provider's folder / extension / MIME rules, and the size
   against the tenant's own `maxFileSizeMb` up to `DIRECT_UPLOAD_MAX_BYTES`
   (512 MiB). It reserves a staging key `<tenantId>/_direct-uploads/<uuid>` and
   the final key, stores the session in Redis (4 h, only `sha256(uploadId)` is a
   key) and returns a PUT URL valid for 15 minutes that is bound to the declared
   Content-Type and Content-Length.
2. The browser PUTs the file to that URL with exactly the returned headers.
3. **Complete** HEADs the staged object (size, type, ETag), reads its 16 leading
   bytes for the magic-byte check, then copies exactly those bytes to the final
   key (`x-amz-copy-source-if-match` on the ETag), deletes the staging object
   and records the file as `uploadFile` does: audit row, usage counter, async
   scan. A mismatch (size, type, content, or the object changed during the
   check) is refused and the staged object deleted. Complete is single-use and
   idempotent: only the presigning user in the same tenant (and the same
   consumer, `storage` or `drive`) can finish it, a concurrent call gets 409, and
   a repeated call returns the first answer.

The browser writes only to the staging key, so re-using a still-valid PUT URL
after complete cannot change a recorded file; nothing ever records or links a
staging key (`isObjectDownloadable` refuses them).

**When the answer is `multipart`** (`reason`): the local provider; no signing
credentials in the tenant's `s3*` settings; a provider whose resolved bucket or
endpoint is not the one those settings sign for (the host signs with the tenant
settings, as `getPresignedUrl` and the scan job do); a plain-HTTP endpoint (the
CSP and mixed-content rules would block the PUT); `virusScanMode=sync` (sync mode
promises an infected file is never stored, and a PUT stores first); and a JPEG
that fits the multipart route while `imageStripExif` is on. The client then uses
the multipart route, and it also falls back to it when the PUT cannot reach the
bucket and the file fits that route.

**EXIF.** JPEGs up to the multipart cap keep that path, so their metadata is
stripped exactly as before. A larger JPEG goes direct and complete strips it while
writing the final object (it downloads the staged bytes, at most
`EXIF_REWRITE_MAX_BYTES` = 32 MiB, and PUTs the stripped result); a larger one is
refused while stripping is on.

**Orphans.** Every staging key is indexed in Redis (`storage:uploads:staging`)
from presign on; `storage-upload-sweep` (every 30 minutes, `common:boot_task`)
deletes those past their deadline: presigns never completed (4 h + 15 min) and
staging keys re-PUT after complete (URL expiry + 15 min). It needs background
jobs; as a backstop, add a bucket lifecycle rule expiring objects under
`<tenantId>/_direct-uploads/` after one day.

### Bucket CORS

The browser PUTs cross-origin, so the bucket must allow it from every origin the
app is served on. Without a rule the PUT fails and the client falls back to the
multipart route, capped at 10 MiB again.

**Use the panel.** Settings > Storage shows the bucket's CORS status and an
"Apply CORS rule" button (`GET` / `POST /api/storage/bucket-cors`, guarded like
the storage settings, the apply audited). The check reads the bucket's CORS
configuration (`GET ?cors`, signed with the tenant's storage settings) and
reports whether some rule allows a PUT with a Content-Type header from each app
origin: `configured`, `missing_origins` (listed), `not_configured` (404
`NoSuchCORSConfiguration`), `unsupported` (501 / `NotImplemented`),
`access_denied` (403: the key lacks `s3:GetBucketCORS` / `s3:PutBucketCORS`),
`no_credentials`, `local_provider`, `no_origins` or `error`. Nothing is applied
on its own: the admin presses the button. (Saving the S3 settings does not apply
it either: a save may be parked by the maker-checker approval, and the panel
re-checks after every save instead.)

Apply MERGES: it reads the current configuration, keeps every other rule as it
is, replaces the app's own rule (`<ID>app-storage-direct-uploads</ID>`) where it
stands and appends it when missing, then writes the result (`PUT ?cors` with a
signed `Content-MD5`). When the current configuration cannot be read, nothing is
written. The rule: `AllowedMethod` PUT and HEAD, `AllowedHeader` `content-type`
(the only header the PUT sets; not `*`), `ExposeHeader` ETag, `MaxAgeSeconds`
3000, and `AllowedOrigin` the exact app origins, never `*`:

- the platform host, `APPLICATION_HOST` (and `NEXT_PUBLIC_APPLICATION_HOST`);
- in domain mode (`subdomain` is its alias), the tenant's ACTIVE and VERIFIED
  domains from `tenant_domain`, including its `<slug>.<wildcard>` subdomain, on
  the platform host's scheme;
- for the root tenant, the wildcard apex and `<TENANT_DEFAULT_SUBDOMAIN>.<wildcard>`.

Apply again after adding a domain (the status then lists it as missing).

**Fallback: stores without the API.** Community MinIO (checked on
RELEASE.2025-10-15T17-29-55Z, the last community release) answers `GET ?cors` with
`NoSuchCORSConfiguration` but `PUT ?cors` with 501 `NotImplemented`, so the panel
shows `unsupported` after an apply. MinIO answers CORS for the whole server
instead (`MINIO_API_CORS_ALLOW_ORIGIN`, every origin by default), so uploads work
without a bucket rule; restrict it there to the app origins. For any other store
without the API, add the rule by hand (S3 / Spaces / R2 JSON form):

```json
[{ "AllowedOrigins": ["https://app.example.com", "https://acme.example.com"],
   "AllowedMethods": ["PUT", "HEAD"], "AllowedHeaders": ["content-type"],
   "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000 }]
```

### Live test against MinIO

`server/tests/storage.s3.integration.test.ts` runs the signer, the requests
complete relies on (HEAD, ranged GET, conditional copy, DELETE), the bucket CORS
status / apply and the whole presign -> PUT -> complete flow against a real
S3-compatible store. It is skipped unless `STORAGE_S3_INTEGRATION=1` and the
endpoint and keys are set; it creates a bucket `nb-it-<hex>` and removes it again.
MinIO no longer publishes community binaries (dl.min.io answers 410), so build the
last release from source with Go 1.24 and serve it over TLS (direct uploads need
an https endpoint):

```bash
GOBIN=$PWD/bin go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z
openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout certs/private.key -out certs/public.crt
MINIO_ROOT_USER=nbadmin MINIO_ROOT_PASSWORD=nb-secret-123 \
  bin/minio server ./data --address 127.0.0.1:9000 --certs-dir ./certs &

STORAGE_S3_INTEGRATION=1 STORAGE_S3_ENDPOINT=https://127.0.0.1:9000 \
STORAGE_S3_ACCESS_KEY=nbadmin STORAGE_S3_SECRET_KEY=nb-secret-123 \
NODE_EXTRA_CA_CERTS=$PWD/certs/public.crt \
  npx vitest run modules/storage/server/tests/storage.s3.integration.test.ts
```

`STORAGE_S3_REGION` defaults to `us-east-1`. The same variables point the test
at any other store (R2, Spaces, AWS) with keys that may create and delete buckets.

## Links for machines

Two link types, two audiences (docs/phases/15-storage/01):

| | `getPresignedUrl` | `createDownloadLink` |
|---|---|---|
| Use for | internal server reads (`downloadBuffer`, plugin bundles), browser previews | anything outside the app: a device, a CI job, a partner system |
| Local provider | `file://` (server-side only, unusable remotely) | works: the app streams from disk |
| Shape | SigV4 URL on the bucket host (exposes the bucket) | `/api/storage/links/<token>` on the tenant's host |
| Expiry | caller-chosen (default 15 min) | clamped to the platform ceiling `storageLinkMaxTtlSeconds` (root tenant setting, default 24 h, hard max 7 d) |
| Single-use / audience / revoke / audit | no | yes |

`StorageService.createDownloadLink(tenantId, key, { ttlSeconds, singleUse?, audience?, filename?, contentType?, purpose, redirectAllowed? })`
returns `{ url, expiresAt, linkId }`. Only `sha256(token)` is stored in Redis (`storage:link:<hash>`); `linkId` is that hash.
`revokeDownloadLink(tenantId, linkId)` and `listDownloadLinks(tenantId, { purpose })` use a per-tenant sorted-set index.

- `audience` (e.g. a device id): the fetch must carry `?aud=<audience>`; a guard against forwarded links, not a secret.
- `singleUse`: the first client fingerprint (audience, else IP) claims the link; the same client may resume with ranged
  requests, any other client gets 404. (A literal GETDEL would break resumes, so this is a documented trade-off; OTA uses `audience`.)
- Fetch: S3-compatible providers answer `302` to a fresh 60 s SigV4 URL (unless `redirectAllowed: false`, then the app
  streams and forwards `Range`); the local provider streams from disk with `Range`, `ETag`, `Content-Length`, `Accept-Ranges`.
- Unknown / expired / revoked / wrong tenant / wrong audience are one indistinguishable `404`. Keys must sit under `<tenantId>/`.
- Objects whose scan verdict is `infected` or `pending` get no link (422) and are refused at fetch.
- Each fetch writes one `storage.link.fetched` audit row (linkId, purpose, range, bytes served) to `audit_log` when installed.

## Usage tracking & audit

Every successful upload:

1. Inserts an `UploadedFile` row in the tenant DB (`entities/uploaded_file.entity.ts`) — `key`, `bucket`, `provider`, `size`, `mimeType`, `url`, `userId`, `createdAt`, plus upload origin (`ipAddress`, `userAgent`, `country` inferred from the IP) and scan columns (`scanStatus`, `scanProvider`, `scanResult`, `scannedAt`). The row is keyed by `tenantId` and indexed on `userId`/`key`/`country`.
2. Calls `TenantUsageService.incrementStorageBytes(tenantId, result.size)` so the `storageBytes` quota counter (`tenant_usage`) tracks reality.

`deleteFile` soft-removes the matching `UploadedFile` row (`deletedAt` set) — the byte counter is increment-only (audit-friendly; decrement is a future task).

Audit / usage failures are swallowed — they never break the upload itself (the bytes are already in the bucket at that point).

Applying the bucket CORS rule writes one `storage.bucket_cors.applied` row (actor, bucket, endpoint host, origins, rule counts before / after) to `audit_log` when installed.

---

## Settings

Storage setting keys (`STORAGE_KEYS`, declared in `storage.setting.keys.ts`) are seeded per tenant under the `Storage` group in `setting/setting.seed.ts` and read at runtime by `storage.service.ts` via `SettingService.getByKeys`.

| Key | Type | Default | Read in / Notes |
|---|---|---|---|
| `storageProvider` | string | `s3` (seed) / `aws-s3` (service fallback) | `storage.service.ts` — selects the backend (`aws-s3` \| `s3` \| `cloudflare-r2` \| `digitalocean-spaces` \| `minio`). |
| `s3Bucket` | string | — | `storage.service.ts` — destination bucket. |
| `s3Region` | string | `us-east-1` | `storage.service.ts` — bucket region. |
| `s3AccessKey` | string | — | `storage.service.ts` — credential access key id. |
| `s3SecretKey` | string | — | `storage.service.ts` — credential secret key. |
| `s3Endpoint` | string | — | `storage.service.ts` — custom endpoint (R2 / Spaces / MinIO); undefined falls back to provider default. |
| `maxFileSizeMb` | number | `25` | `getValidationPolicy` — enforced in `validateUpload`, clamped to `MAX_UPLOAD_FILE_BYTES` (just under the 10 MiB request ceiling) on the multipart route; a browser-direct upload gets the setting itself up to `DIRECT_UPLOAD_MAX_BYTES` (512 MiB). Unset or invalid means the multipart ceiling on both, not unlimited. |
| `allowedExtensions` | json | `["png","jpg","pdf"]` | `getValidationPolicy` — enforced in `validateUpload`. |
| `allowedMimeGroups` | csv | `images,documents` | `getValidationPolicy` — group keys expanded to MIME types (see below). |
| `allowedMimeTypes` | csv | — (empty) | `getValidationPolicy` — explicit MIME types added on top of the selected groups. |
| `imageStripExif` | bool | `true` | `getValidationPolicy` — strips JPEG EXIF/metadata unless `'false'`. |

#### MIME allowlist by group (`storage.mime-groups.ts`)

Rather than listing raw MIME strings, tenants pick **groups**; the effective
allowlist is `expandMimeGroups(allowedMimeGroups) ∪ allowedMimeTypes`. Both empty
⇒ unrestricted (provider-level type checks still apply). The content-derived MIME
(`deriveMimeType`) is matched against this set in `validateUpload`.

| Group | Covers |
|---|---|
| `images` | jpeg, png, webp, avif, gif, bmp, ico, svg |
| `documents` | pdf, txt, markdown, html, docx, odt, epub |
| `spreadsheets` | csv, xlsx, ods |
| `presentations` | pptx |
| `archives` | zip, gzip |
| `audio` | mpeg/mp3 |
| `video` | mp4 |
| `data` | json, xml, yaml |

### Virus scanning keys (`STORAGE_SCAN_KEYS`, `storage.scan.setting.keys.ts`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `virusScanEnabled` | bool | `false` | Master switch; also requires `virusScanApiKey` to take effect. |
| `virusScanMode` | enum | `async` | `sync` blocks the upload until scanned; `async` scans in the background. |
| `virusScanProvider` | enum | `virustotal` | Online scanner backend. |
| `virusScanApiKey` | string | — | Provider API key (secret). |
| `virusScanTimeoutSeconds` | number | `30` | Per-scan time budget. |
| `virusScanInfectedAction` | enum | `quarantine` | `quarantine` (move to quarantine folder) or `delete`. |
| `virusScanQuarantineFolder` | string | `quarantine` | Destination folder prefix for quarantined objects. |

The env-credentialed shared client `s3.client.ts` was deleted on 2026-10-17 as dead code (nothing imported it; storage backends are `storage:provider` plugins, docs/phases/37-extensions/12). The audit archive builds its own client (`storage.audit-archive.provider.ts`).

---

## Audit archive (S3 Object Lock)

`storage` contributes the write-once archive of the audit trail to the `audit_log:archive_exporter` extension point (`storage.audit-archive.provider.ts`; `audit_log` imports nothing from here). The retention purge of a SEALED tenant writes its rows there BEFORE it deletes them (see the audit_log README, "Retention checkpoints").

- **Configuration:** `AUDIT_ARCHIVE_BUCKET`, `AUDIT_ARCHIVE_RETENTION_DAYS` (required with a bucket: a half-configured archive throws and the sweep skips sealed tenants rather than deleting rows), `AUDIT_ARCHIVE_LOCK_MODE` (`COMPLIANCE` by default, or `GOVERNANCE`), `AUDIT_ARCHIVE_PREFIX`, `AUDIT_ARCHIVE_REGION`, `AUDIT_ARCHIVE_ENDPOINT` (S3-compatible stores, path-style). Credentials are the AWS provider chain. No bucket = no archive.
- **Fail closed:** the bucket must report Object Lock as enabled (`GetObjectLockConfiguration`) before the first write and again after any failed write; every object is written with a lock mode and a retain-until date, refused rather than overwritten (`If-None-Match: *`), bound to its SHA-256 (`ChecksumSHA256`) and encrypted (`AES256`). An error carries the S3 error NAME only, never the store's message (it can name a bucket, a request id or a principal).
- **What is stored:** the NDJSON of the stored, pseudonymous rows (`actorRef`, never a resolved identity), under `prefix/tenantId/YYYY-MM-DD/<id>.ndjson`. The exporter never reads an object back.
- **Honest limit:** verified with unit tests, a fake client, and the REAL AWS SDK against a local HTTP server that records the wire request (headers, path, body, checksum). It has NOT been run against an S3 bucket with Object Lock, because none is available offline; Object Lock itself, the conditional write and the retention are S3's guarantees, not this module's.

## Security

`assertStorageFeatureAccess(tenantId)` gates `uploadFile` / `uploadFromUrl` before any provider work:

- Short-circuits for the root tenant (`isRootTenant`).
- Asserts the tenant's active plan grants `FEATURE_STORAGE_UPLOAD` (boolean).
- Asserts `FEATURE_STORAGE_QUOTA_BYTES` (limit) is not exhausted, comparing against the tenant's `TenantUsage.storageBytes`.

The quota check is best-effort and non-atomic — the post-upload byte increment can briefly push usage above the ceiling under concurrent uploads.

### Upload validation & MIME

`validateUpload` (`storage.validation.ts`) runs before the bytes reach the bucket:
size (`maxFileSizeMb`), extension allowlist (`allowedExtensions`), magic-byte
sniffing, optional EXIF stripping, and a **content-derived MIME** check. The real
MIME is derived from the verified content (`deriveMimeType`) — never the client's
`file.type` header — and matched against the per-tenant `allowedMimeTypes`
allowlist; the derived MIME is what gets stored on the object and audit row.

One upload request carries at most `UPLOAD_REQUEST_CEILING_BYTES` (10 MiB, Next's
default `proxyClientMaxBodySize`: the proxy's copy of a larger body is cut off and
the route reads a truncated one), so the effective file cap of that route is
`MAX_UPLOAD_FILE_BYTES` whatever `maxFileSizeMb` says. Larger files take the
browser-direct path (see "Browser-direct uploads"). The storage and
Drive upload routes call `StorageService.assertDeclaredUploadSize` before
`request.formData()`, so a request whose Content-Length is already over the cap
(plus `MULTIPART_OVERHEAD_BYTES`) gets a 413 without its body being buffered.

### Virus scanning

When `virusScanEnabled` (+ `virusScanApiKey`) is set, uploads are scanned via a
pluggable online scanner (`scanners/`, first adapter VirusTotal):

- **sync** (`virusScanMode=sync`) — the buffer is scanned before the bucket write;
  an infected file is rejected with `SCAN_INFECTED` and never stored.
- **async** (default) — the object is stored as `scanStatus='pending'` and a BullMQ
  job (`storage.scan.job.ts`) downloads it via a presigned URL, scans it, writes the
  result to the `UploadedFile` scan columns, then quarantines/deletes it if infected
  (`virusScanInfectedAction`). `uploadFromUrl` always scans asynchronously;
  `uploadServerBuffer` (trusted server output) is not scanned. Browser-direct
  uploads only run for tenants in async mode (sync mode keeps the multipart
  route); their row is `pending` until the scan passes, and download links refuse
  a pending object.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

The storage module uploads/deletes files to S3-compatible providers (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO) and is fully tenant-aware: each real tenant has its own provider, bucket, credentials and limits in Setting rows, its own UploadedFile audit ledger, and upload access is gated per-tenant via subscription feature-keys + a storage quota.

### Setting level (phase 53)

**Selectable, default `platform`.** The root tenant chooses where this module's provider settings come from, for the installation (the "Setting level" button on the module's settings page) and per tenant ("Setting levels" on the tenant's page): `platform` (the root tenant's only), `tenant` (the tenant's only) or `tenant_first` (the tenant's whole group if it set any key of it, else the root tenant's). The group is read from one side, never key by key.

- Keys: `storageProvider`, `s3Bucket`, `s3Region`, `s3AccessKey`, `s3SecretKey`, `s3Endpoint`, `virusScanProvider`, `virusScanApiKey`.
- Caps (the lower of the two at `platform`, the tenant's own otherwise): `maxFileSizeMb`.
- Plugin providers at: `storage:provider`.

At `platform` files go to the root tenant's bucket and count against the plan's storage quota. Each `uploaded_files` row records `source`, so a file is read and deleted on the storage it was written to after a level change; rows from before phase 53 have none and follow the provider in force. The cap `maxFileSizeMb` at `platform` is the lower of the root tenant's and the tenant's; the allowed file types stay the tenant's.

Declared in `module.json` (`settings.level`); see [phase 53](../../docs/phases/53-setting-levels/README.md). The tables below predate the levels: where they say a key is read per tenant, the level decides whose row is read.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `storageProvider` | string | `aws-s3` | tenant | Which S3-compatible backend the tenant's uploads go to (aws-s3 \| s3 \| cloudflare-r2 \| digitalocean-spaces \| minio); service default 'aws-s3', seed default 's3'. | `storage.service.ts` |
| `s3Bucket` | string | — | tenant | Destination bucket name for this tenant's objects. | `storage.service.ts` |
| `s3Region` | string | `us-east-1` | tenant | AWS/S3 region for the tenant's bucket. | `storage.service.ts` |
| `s3AccessKey` | string | — | tenant | Access key id for the tenant's storage credentials. | `storage.service.ts` |
| `s3SecretKey` | string | — | tenant | Secret access key for the tenant's storage credentials. | `storage.service.ts` |
| `s3Endpoint` | string | — | tenant | Custom S3 endpoint URL (for R2 / Spaces / self-hosted MinIO); undefined falls back to provider default. | `storage.service.ts` |
| `maxFileSizeMb` | number | `25` | tenant | Intended per-tenant max upload size in MB (seeded/UI-editable but not yet enforced in the service). | `setting.seed.ts` |
| `allowedExtensions` | json | `["png","jpg","pdf"]` | tenant | Intended per-tenant allowlist of upload file extensions (seeded/UI-editable but not yet enforced in the service). | `setting.seed.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Tenant-scoped data

| Entity | Table | Tenant-variable columns |
|---|---|---|
| `UploadedFile` | `uploaded_files` | userId, key, bucket, provider, size, mimeType, url |

All rows isolated by `tenantId` via the per-tenant DataSource.

### Per-tenant behavior

- `storage.service.ts:getStorageSettings` — Reads storageProvider + s3Bucket/region/credentials/endpoint via SettingService.getByKeys(tenantId,...) so the resolved provider and S3Config are entirely per-tenant; each tenant uploads to its own bucket with its own credentials.
- `storage.service.ts:getProvider` — Selects the concrete provider class (AWS S3 / R2 / Spaces / MinIO) from the tenant's resolved storageProvider setting, unless the request explicitly overrides it.
- `storage.service.ts:assertStorageFeatureAccess` — Gates uploadFile/uploadFromUrl per tenant: asserts the tenant's active plan grants FEATURE_STORAGE_UPLOAD and that FEATURE_STORAGE_QUOTA_BYTES is not exhausted (compared against the tenant's TenantUsage.storageBytes). Root tenant is short-circuited (isRootTenant).
- `storage.service.ts:persistUploadAudit` — Writes the UploadedFile audit row into tenantDataSourceFor(tenantId) and increments TenantUsageService.storageBytes for that tenant, so each tenant has its own file ledger and usage counter.

### Candidates (global / hardcoded today → could be per-tenant)

| What | Where | Why per-tenant | Suggested key |
|---|---|---|---|
| Per-tenant max upload size is not enforced; uploadFile/uploadFromUrl accept any file size regardless of the tenant's configured limit. | `storage.service.ts:uploadFile / uploadFromUrl` | The maxFileSizeMb setting is declared in storage.setting.keys.ts, seeded per-tenant (value '25'), and exposed in the settings UI, but it is never read anywhere in the service — uploads are size-gated only by the subscription quota, not this per-tenant ceiling. | `maxFileSizeMb` |
| Per-tenant allowed file extensions are not enforced; any extension/mime type is accepted on upload. | `storage.service.ts:uploadFile / uploadFromUrl` | allowedExtensions is declared in storage.setting.keys.ts and seeded per-tenant (['png','jpg','pdf']) and UI-editable, but no code reads it to validate the uploaded file's extension. | `allowedExtensions` |

---

## Dependencies

Requires `env` and `setting` (per `module.json`). At runtime also uses `tenant_usage` (quota counter), `tenant_subscription` (feature-key gating), `tenant`/`db` (per-tenant DataSource), and `logger`.
