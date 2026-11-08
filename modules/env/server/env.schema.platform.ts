import { z } from 'zod';
import { boolEnv } from './env.schema.shared';

// Platform/ops env fields: cron, misc runtime, rate limiting, e-signature /
// e-identity, observability, secrets manager, deployment region.

/** A numeric setting a blank value leaves UNSET: `z.coerce.number()` reads `''` as 0, which for a cooling-off hours setting would silently mean "no waiting period". */
const blankIsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
/** A map tile server's URL template: https, with {z} {x} {y}, and no quotes, angle brackets, backslashes, spaces or control characters. */
export const isTileTemplate = (v: string): boolean =>
  /^https:\/\/[^\s"'<>\\\u0000-\u001f\u007f]{1,480}$/.test(v) && ['{z}', '{x}', '{y}'].every((p) => v.includes(p));

/** The three install roles (phase 55 03 §3.3). */
export type InstallRoleValue = 'production' | 'staging' | 'demo';
/** An install role from a raw INSTALL_ROLE: exactly `staging` or `demo`, anything else (unset, blank, misspelt, another case) `production`. */
export const installRoleFromRaw = (raw: unknown): InstallRoleValue => (raw === 'staging' || raw === 'demo' ? raw : 'production');
/** INSTALL_ROLE never fails the schema: a typo on a customer install must not stop it booting, and it can only fall to production (D55-98). */
// `.optional()` first: zod 4 refuses a missing key for a bare `z.unknown()` piped through a transform.
const installRoleEnv = () => z.unknown().optional().transform(installRoleFromRaw);
/** The boot warning for a set INSTALL_ROLE that is none of the three (it counts as production); null when there is nothing to say. */
export function installRoleWarning(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '' || raw === 'production' || raw === 'staging' || raw === 'demo') return null;
  return `[env] INSTALL_ROLE=${JSON.stringify(raw.slice(0, 40))} is not production, staging or demo (exact, lower case): this install runs as production`;
}

export const platformFields = {
  // ── Cron ─────────────────────────────────────────────────────────────────────
  CRON_SECRET: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),

  // ── Demo mode ─────────────────────────────────────────────────────────────────
  // When true, the demo-reset cron is allowed to destructively wipe and reseed
  // the database every 15 minutes. MUST stay false on any real database.
  DEMO_MODE: boolEnv().default(false),

  // ── Install role (phase 55 03 §3.3, D55-82) ──────────────────────────────────
  // What this installation is for: `production` (the default, every customer install), `staging` (a staging install the AI
  // firewall's probe lane may attack, on the siege server only, FWA-10) or `demo` (the demo install). Set explicitly; never
  // inferred from a hostname, a database name or DEMO_MODE. Only on `staging` does the firewall believe a probe run's attack mark,
  // and on `staging` or `demo` a benign-traffic mark, each only with the runner's own credential below
  // (modules/common/server/common.firewall-probe-gate.ts); on `production` both are ignored and counted.
  // Lenient (D55-98): exactly `staging` or `demo` is that role; unset, blank, misspelt or another case ('Staging', 'prod') is
  // `production` and never stops the boot (env.service warns about a set value it did not recognise).
  INSTALL_ROLE: installRoleEnv(),
  // The SHA-256 (64 hex) of the probe runner's credential (`scripts/fw-probe/seed-staging.ts` mints it; the runner keeps the
  // credential, the install only its digest). Honoured on a staging install only; any label class. It is the MAC key the runner's
  // per-run proofs are checked with (D55-95), so it is a secret of the staging environment (redacted, secret-class).
  AI_FIREWALL_PROBE_RUNNER_SHA256: blankIsUnset(z.string().regex(/^[0-9a-f]{64}$/i, 'AI_FIREWALL_PROBE_RUNNER_SHA256 is a SHA-256 digest: 64 hex characters')),
  // The SHA-256 (64 hex) of the benign-traffic credential (e2e tester runs, the siege normal scenarios, the demo's scripted
  // traffic). Honoured on a staging or demo install; it may declare the class `benign` only.
  AI_FIREWALL_BENIGN_RUNNER_SHA256: blankIsUnset(z.string().regex(/^[0-9a-f]{64}$/i, 'AI_FIREWALL_BENIGN_RUNNER_SHA256 is a SHA-256 digest: 64 hex characters')),

  // ── Content-Security-Policy ───────────────────────────────────────────────────
  // true: the policy names a per-request nonce instead of 'unsafe-inline' (proxy/csp.ts, which reads it itself
  // because the proxy runs before this schema is loaded). The root layout reads it to nonce its boot scripts.
  CSP_STRICT: boolEnv().default(false),

  // ── Map tiles ─────────────────────────────────────────────────────────────────
  // The installation's basemap for every map (the kit's MapCanvas, the Sites & assets map, the map widget's "Follow the
  // theme" style), read at run time by the root layout and by the CSP (proxy/csp.ts, which reads them itself), so a built
  // image takes them at container start. Unset: OpenStreetMap's standard tiles, darkened in the dark theme; their policy
  // fits light use, so heavy production traffic belongs on a keyed provider (docs/guides/install-config.md "The map's
  // tiles"). The URL is a Leaflet template, https with {z} {x} {y} (and {s} for a subdomain); without MAP_TILES_DARK_URL
  // the dark theme draws the same tiles darkened. MAP_TILES_SUBDOMAINS: the {s} values, `abc` or `t0,t1,t2`.
  MAP_TILES_URL: blankIsUnset(z.string().refine(isTileTemplate, 'MAP_TILES_URL must be an https URL template with {z}, {x} and {y}')),
  MAP_TILES_ATTRIBUTION: blankIsUnset(z.string().max(500, 'MAP_TILES_ATTRIBUTION is at most 500 characters')),
  MAP_TILES_SUBDOMAINS: blankIsUnset(z.string().regex(/^(?:[a-z0-9]{1,10}|[a-z0-9-]{1,20}(?:,[a-z0-9-]{1,20}){1,9})$/i, 'MAP_TILES_SUBDOMAINS is letters or digits (abc), or up to ten comma-separated names (t0,t1)')),
  MAP_TILES_MAX_ZOOM: blankIsUnset(z.coerce.number().int().min(1).max(22)),
  MAP_TILES_DARK_URL: blankIsUnset(z.string().refine(isTileTemplate, 'MAP_TILES_DARK_URL must be an https URL template with {z}, {x} and {y}')),

  // ── dynamic_page in-process block handlers ───────────────────────────────────
  // Tenant-authored block `serverHandler` code runs in a Node `vm`, which is NOT
  // a security boundary — a determined author can escape it to the host process
  // (and thus every tenant's data in a shared deployment). Off by default so this
  // code-execution surface is a deliberate operator opt-in; the safe path for
  // untrusted/community handlers is the plugin_runtime isolate. Leave false unless
  // you fully trust everyone who can author a page block.
  ALLOW_INPROCESS_BLOCK_HANDLERS: boolEnv().default(false),

  // ── Misc ─────────────────────────────────────────────────────────────────────
  BOOK_LANG: z.string().optional(),
  DOTENV_KEY: z.string().optional(),
  NEXT_DEPLOYMENT_ID: z.string().optional(),
  NODE_DISABLE_COLORS: z.string().optional(),
  NODE_UNIQUE_ID: z.string().optional(),
  UNIX: z.string().optional(),
  PATH: z.string().optional(),

  // ── Rate Limiting ───────────────────────────────────────────────────────────
  // Kill-switch for the fixed-window IP limiter (modules/limiter). Local dev
  // convenience: every localhost request lands in one IP bucket, so normal
  // admin-UI traffic alone can exhaust the window. Never set in production.
  RATE_LIMIT_DISABLED: boolEnv().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().default(60 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(500),

  // ── E-Signature / E-Identity (eIDAS, OIDC4IDA) ──────────────────────────────
  EID_DEFAULT_PROVIDER: z.string().optional(),
  EID_PROVIDER_MAP: z.string().optional(),
  EID_REQUIRED_LOA: z.enum(['low', 'substantial', 'high']).optional(),
  EU_LOTL_URL: z.string().optional(),
  LOTL_SIGNER_CERT_PEM: z.string().optional(),
  TR_TRUST_ROOTS_PATH: z.string().optional(),
  TSA_DEFAULT_URL: z.string().optional(),
  MOBIL_IMZA_AGGREGATOR_BASE_URL: z.string().optional(),
  MOBIL_IMZA_AGGREGATOR_API_KEY: z.string().optional(),
  MOBIL_IMZA_AGGREGATOR_CUSTOMER_CODE: z.string().optional(),
  MOBIL_IMZA_CALLBACK_HMAC_SECRET: z.string().optional(),
  SMART_ID_BASE_URL: z.string().optional(),
  SMART_ID_RELYING_PARTY_UUID: z.string().optional(),
  SMART_ID_RELYING_PARTY_NAME: z.string().optional(),
  BANKID_SE_BASE_URL: z.string().optional(),
  BANKID_SE_CLIENT_CERT_PATH: z.string().optional(),
  BANKID_SE_CLIENT_KEY_PATH: z.string().optional(),
  LOGIN_GOV_CLIENT_ID: z.string().optional(),
  LOGIN_GOV_REDIRECT_URI: z.string().optional(),
  // 38-security 5.5: key rotation. The key(s) values were written under BEFORE the current SETTINGS_ENCRYPTION_KEY: comma separated 64-hex keys, read-only
  // (every write uses the current key). Remove once `reencryptField` has rewritten every row and the oldest backup that needs it has expired.
  SETTINGS_ENCRYPTION_KEY_PREVIOUS: z.string().regex(/^[0-9a-fA-F]{64}(,[0-9a-fA-F]{64})*$/, 'SETTINGS_ENCRYPTION_KEY_PREVIOUS must be comma separated 64-hex keys').optional(),
  SETTINGS_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'SETTINGS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)').optional(),
  // Tenant data keys (P7-TDEK, db/server/db.key-provider.ts): who wraps them. `node-key` (default) derives the wrapping key from
  // SETTINGS_ENCRYPTION_KEY: destroying a tenant's key reaches the live database, not its backups. `file` keeps one slot file per key in
  // TENANT_KEYSTORE_DIR (outside the database and its backups), wrapped under the 32-byte region KEK file TENANT_KEYSTORE_KEK_FILE, so a purge
  // shreds the tenant's declared columns in every backup too. `kms` / `vault` are interfaces only so far. X4-7: the KEK file may instead be an
  // age file sealed to the regional partner's X25519 identity, opened with TENANT_KEYSTORE_KEK_AGE_IDENTITY_FILE (when that is set, a
  // cleartext KEK file is refused).
  TENANT_KEY_PROVIDER: z.enum(['node-key', 'file', 'kms', 'vault']).optional(),
  TENANT_KEYSTORE_DIR: z.string().max(512).optional(),
  TENANT_KEYSTORE_KEK_FILE: z.string().max(512).optional(),
  TENANT_KEYSTORE_KEK_AGE_IDENTITY_FILE: z.string().max(512).optional(),

  // ── Storage ─────────────────────────────────────────────────────────────────
  // Local disk storage (plugin @local/storage, written through the broker capability `localfs`): the base directory when the `storageLocalDir` setting is unset (absolute path; default <cwd>/.local-storage).
  STORAGE_LOCAL_DIR: z.string().max(512).optional(),

  // ── Observability ───────────────────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  // Comma-separated substrings; an error whose name/message/digest contains one is dropped before it reaches Sentry.
  SENTRY_IGNORE_ERRORS: z.string().optional(),
  // Comma-separated path fragments that are never traced (health/ready/metrics are always excluded).
  SENTRY_TRACES_IGNORE_ROUTES: z.string().optional(),
  // JSON `{"<tenantId>": 0..1}` — per-tenant trace sampling overrides, e.g. full tracing for one tenant under investigation.
  SENTRY_TRACES_TENANT_RATES: z.string().optional(),
  METRICS_ENABLED: boolEnv().default(false),
  METRICS_SECRET: z.string().optional(),
  // 38-security 7.6: TLS to Postgres. Default (unset): required for any host that is not local or compose-internal, off for those. A URL's own
  // `sslmode=` wins. `verify-ca` / `verify-full` verify the server certificate, against DATABASE_SSL_CA_FILE (a PEM bundle) when set.
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-ca', 'verify-full']).optional().catch(undefined),
  DATABASE_SSL_CA_FILE: z.string().optional(),
  // marketing.03: the key that signs tracking links (unset: derived from another server secret, see marketing.tracking.ts).
  MARKETING_TRACKING_SECRET: z.string().optional(),
  // The key of the audit-log pseudonyms written for erased users (audit_log.pseudonym.ts).
  AUDIT_LOG_PSEUDONYM_KEY: z.string().optional(),
  // common.17: the key of the v2 (keyed) audit hash chains (unset: derived from SETTINGS_ENCRYPTION_KEY / ACCESS_TOKEN_SECRET).
  HASH_CHAIN_KEY: z.string().optional(),
  // E-07: take the tenant host from X-Forwarded-Host (its LAST element) only behind an edge that sets it.
  TRUST_X_FORWARDED_HOST: z.string().optional(),
  // common.22: a production process answers the root tenant on localhost only when this is "true" (local smoke runs).
  ALLOW_LOCALHOST_ROOT: z.string().optional(),
  // Webhooks are HTTPS only; plain-http hosts the operator allows (comma-separated host or host:port).
  WEBHOOK_HTTP_ALLOWED_HOSTS: z.string().optional(),
  // redis_idempotency.02: "off" disables the database fallback of Idempotency-Key claims (on by default outside tests).
  IDEMPOTENCY_DURABLE_STORE: z.enum(['on', 'off']).optional(),
  OTEL_ENABLED: boolEnv().default(false),
  // Opt-in OpenTelemetry GenAI spans for NB's own model calls (observability phase 20.6). A tenant must ALSO opt in in its AI settings.
  GENAI_TRACING: boolEnv().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('next-boilerplate'),

  // ── Telemetry store and ingest (observability phases 17 and 18; docs/phases/09-observability/17-otlp-ingest-and-storage.md; 42-telemetry/04) ──
  // `telemetry` (the default, ED-2): metrics on the Core telemetry store (no Prometheus to run); logs and traces answer 501 until a store is configured.
  // `off`: nothing is stored and the ingest and query routes answer 503. `memory`: development only.
  // `reference` = Loki (logs) + Tempo (traces) + a Prometheus-compatible store (metrics), each reached over HTTP; logs or traces without a URL
  // answer 501, metrics without a Prometheus URL go to the Core store.
  TELEMETRY_BACKEND: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() || undefined : v), z.enum(['telemetry', 'off', 'memory', 'reference']).default('telemetry')),
  TELEMETRY_LOKI_URL: blankIsUnset(z.string().url()),
  // Tempo query-frontend, e.g. http://tempo:3200
  TELEMETRY_TEMPO_URL: blankIsUnset(z.string().url()),
  // Tempo OTLP/HTTP receiver for writes; default: the query URL with port 4318.
  TELEMETRY_TEMPO_OTLP_URL: blankIsUnset(z.string().url()),
  TELEMETRY_PROMETHEUS_URL: blankIsUnset(z.string().url()),
  // true when Prometheus runs with --web.enable-admin-api (enables tenant series deletion).
  TELEMETRY_PROMETHEUS_ADMIN_API: boolEnv().default(false),
  // Send the tenant in this header too (Mimir: X-Scope-OrgID).
  TELEMETRY_PROMETHEUS_TENANT_HEADER: z.string().optional(),
  TELEMETRY_BACKEND_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Export NB's own logs as OTLP logs (needs a tenant ingest key, scope telemetry:write; secret-class).
  TELEMETRY_LOG_EXPORT: boolEnv().default(false),
  TELEMETRY_LOG_EXPORT_URL: blankIsUnset(z.string().url()),
  TELEMETRY_LOG_EXPORT_KEY: z.string().optional(),
  // Histogram exemplars (trace id on a latency bucket): switches the metrics scrape to OpenMetrics, so it is a deployment decision.
  TELEMETRY_EXEMPLARS: boolEnv().default(false),
  // The OTLP/gRPC ingest sidecar (process kind `telemetry-gateway`): the gRPC port exporters connect to, the health/metrics port of process_host,
  // the bind address, the largest accepted gRPC message, and optional TLS (paths of mounted files, never the key itself).
  TELEMETRY_GATEWAY_GRPC_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  TELEMETRY_GATEWAY_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4014),
  TELEMETRY_GATEWAY_BIND: z.string().default('0.0.0.0'),
  TELEMETRY_GATEWAY_MAX_MESSAGE_BYTES: z.coerce.number().int().min(1024).max(16 * 1024 * 1024).default(4 * 1024 * 1024),
  TELEMETRY_GATEWAY_MAX_STREAMS: z.coerce.number().int().min(1).max(10_000).default(64),
  TELEMETRY_GATEWAY_TLS_CERT_FILE: z.string().optional(),
  TELEMETRY_GATEWAY_TLS_KEY_FILE: z.string().optional(),
  // Logger (modules/logger). Every field is LENIENT: a value that does not parse falls back to the default instead of failing
  // boot, so a stale or mistyped LOG_* variable on an existing deployment can never stop it from starting.
  //   LOG_LEVEL            only `debug` changes behaviour (global debug lines); the other levels are accepted and ignored.
  //   LOG_FORMAT           unset keeps `text`, except on a node/fleet role with LOG_TO_STDOUT, where the default is `json`.
  //   LOG_SAMPLE_RATE      a fraction in (0,1) keeps that share of info lines; anything else logs everything. Never samples warn/error/event.
  //   LOG_RETENTION_DAYS   days of daily log files kept under logs/ (default 14, 0 = forever).
  //   LOG_REDACT_KEYS      extra key names whose values are replaced by [REDACTED] (comma separated).
  //   LOG_REDACT_MESSAGES  value-pattern redaction (JWT, email, card, IBAN) of the warn/error message text. On by default; false is
  //                        honoured only on the single role (a node or fleet role always redacts).
  //   LOG_TO_STDOUT        write to the console in any NODE_ENV (a container's log driver reads stdout) instead of logs/<date>.log.
  LOG_LEVEL: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['debug', 'info', 'warn', 'error']).optional()).catch(undefined),
  LOG_FORMAT: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['text', 'json']).optional()).catch(undefined),
  LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional().catch(undefined),
  LOG_REDACT_KEYS: z.string().optional().catch(undefined),
  // 38-security 5.6: days the daily files under logs/ are kept (older `<date>.log` files are deleted when a new day's file is opened); 0 keeps all. Default 14.
  LOG_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).optional().catch(undefined),
  LOG_REDACT_MESSAGES: z.preprocess((v) => !(typeof v === 'string' && ['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())), z.boolean()),
  LOG_TO_STDOUT: boolEnv().default(false),
  ENABLE_BACKGROUND_JOBS: boolEnv().default(false),
  // INC-17 (2026-10-26): the scheduler tasks to start where background jobs are on, by name, comma-separated; unset starts every one.
  // Read by modules/common/server/worker-bootstrap.ts (`backgroundJobsOnly`).
  BACKGROUND_JOBS_ONLY: z.string().optional().catch(undefined),
  // docs/phases/14-docker/07 task 4: whether the processes running the boot tasks (the `worker`, a Next server with background jobs)
  // start the generic automation host. Default true (as before); `false` once the `automation-worker` process kind runs it.
  // Read by modules/automation/server/automation.host-boot.ts (`automationHostInWorker`) with the same false/0/no/off rule.
  AUTOMATION_HOST_IN_WORKER: z.preprocess((v) => !(typeof v === 'string' && ['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())), z.boolean()),
  // docs/phases/14-docker/07 task 3: the generic automation host's partition count, one value per cluster, recorded in Redis
  // (`automation:partitions`). Unset or blank follows the recorded count (16 on an install whose data predates the record, 64 on a
  // fresh one); set, a power of two from 1 to 1024 that must equal the recorded count on every process (web producers and workers),
  // or the host refuses to start and producers refuse to write. Changed only by `npm run automation:repartition`. Read by
  // modules/automation/server/host/generic-descriptor.ts (`configuredPartitionCount`) with the same rule.
  AUTOMATION_PARTITIONS: z.string().optional().refine((v) => {
    if (v === undefined || v.trim() === '') return true;
    const n = /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 1024 && (n & (n - 1)) === 0;
  }, 'AUTOMATION_PARTITIONS must be a power of two between 1 and 1024'),
  // docs/phases/08-automation/12-scale-readiness.md AS-6: optional Redis instances of automation's own. Unset or blank = the platform's
  // REDIS_URL, as before. AUTOMATION_REDIS_URL takes every automation key (the generic host's streams and partition state, node
  // state, hooks); AUTOMATION_OBS_REDIS_URL takes only the observability store (run records, logs, debug items) and follows
  // AUTOMATION_REDIS_URL when unset. Every web and worker process must name the same instances. Read by
  // modules/automation/server/automation.redis.ts.
  AUTOMATION_REDIS_URL: z.string().optional().refine((v) => v === undefined || v.trim() === '' || /^rediss?:\/\//.test(v.trim()), 'AUTOMATION_REDIS_URL must be a redis:// or rediss:// URL'),
  AUTOMATION_OBS_REDIS_URL: z.string().optional().refine((v) => v === undefined || v.trim() === '' || /^rediss?:\/\//.test(v.trim()), 'AUTOMATION_OBS_REDIS_URL must be a redis:// or rediss:// URL'),
  // Build identity (docs/phases/02-fleet 10-roadmap Phase 4). The Dockerfile bakes these in as ARG -> ENV; a deployer may
  // override IMAGE_DIGEST at run time (the digest of a pushed image is only known after the push). Empty means unset.
  // They replace APPLICATION_VERSION; read them through common/server/build-info, which normalises empties.
  // An empty value (a Docker `ARG RELEASE_VERSION` passed without a value) falls back to `dev`, so every reader sees a real version.
  RELEASE_VERSION: z.string().default('dev').transform((v) => v.trim() || 'dev'),
  IMAGE_DIGEST: z.string().optional(),
  GIT_SHA: z.string().optional(),

  // ── Secrets manager (AWS SSM / HashiCorp Vault) ─────────────────────────────
  // When set, env.service will call the registered secrets loader at boot.
  SECRETS_MANAGER_PROVIDER: z.enum(['aws_ssm', 'vault', 'none']).default('none'),
  SECRETS_MANAGER_PREFIX: z.string().optional(),
  VAULT_ADDR: z.string().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_PATH: z.string().optional(),

  // ── Telephony ───────────────────────────────────────────────────────────────
  // The SIP realm offered when a tenant has not set `telephonySipRealm`. Only a
  // FALLBACK: a realm is the tenant's identity, gets typed into every handset,
  // and cannot be changed afterwards without visiting each device — so the
  // tenant setting always wins and neither is guessed from anything else.
  TELEPHONY_DEFAULT_REALM: z.string().optional(),

  // ── Deployment region (typed) — drives per-region env overlay + data residency ─
  DEPLOYMENT_REGION: z.enum([
    'local', 'us-east', 'us-west', 'eu-west', 'eu-central', 'uk', 'tr', 'me', 'apac', 'sa', 'af',
  ]).default('local'),

  // ── Fleet role (docs/phases/02-fleet) ───────────────────────────────────────
  // Unset means `single` (standalone). BUILD_ROLE is baked into the image at build
  // time; boot asserts FLEET_ROLE === BUILD_ROLE (checkFleetRoleBaked in
  // modules/common/server/fleet-role.profile.ts). Both are strict enums: a typo
  // fails parsing instead of silently falling back to `single`.
  FLEET_ROLE: z.enum(['single', 'node', 'fleet']).optional(),
  BUILD_ROLE: z.enum(['single', 'node', 'fleet']).optional(),
  // The id the control plane registered the node under: the same pattern the control plane and the agent accept (an operator's slug such as
  // `eu-de-1`, or a uuid). The agent and the app read the same value, so a stricter rule here would stop the app of a node the fleet enrolled.
  FLEET_NODE_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  FLEET_REGION_ID: z.string().optional(),
  FLEET_CONTROL_PLANE_URLS: z.string().optional(),
  FLEET_LOCAL_HMAC_FILE: z.string().optional(),
  // Node only: comma-separated host suffixes a relocated tenant's tombstone may redirect to (docs/phases/02-fleet/05 section 5.1), e.g.
  // "example.eu,example.com.tr". Bootstrap-local and tighten-only; unset = a tombstone never redirects (the node answers 503).
  FLEET_ALLOWED_REDIRECT_SUFFIXES: z.string().max(2048).optional(),
  // Node only: the regional operator / DPO mailbox that is ALWAYS told when a break-glass grant is created (04 §6 step 7).
  FLEET_REGIONAL_DPO_EMAIL: z.string().email().max(254).optional(),
  // Where /etc and /sys are read for the license hardware binding; a container mounts the host's files read-only and points this at them.
  FLEET_HARDWARE_ROOT: z.string().max(512).optional(),
  // Node only: sha256 (hex) of the fleet root CA certificate the operator pinned out of band. The app needs it to accept the FIRST trust bundle the agent pushes.
  FLEET_ROOT_FINGERPRINT: z.string().regex(/^[0-9a-fA-F:]{64,95}$/).optional(),
  // Node only: the app's own copy of the regional operator PUBLIC key (PEM, a 0400 file owned by the app user, never the agent's copy), which the app
  // verifies a regional DR failover order against itself (decision F1). Unset = the regional fallback route answers 503.
  FLEET_REGIONAL_OPERATOR_KEY_FILE: z.string().max(512).optional(),
  // Control plane only: the fleet intermediate CA the node-certificate issuer signs with (files, PKCS#8 key; a KMS
  // KeyProvider replaces these without touching callers). Unset means the verify route cannot issue certificates.
  FLEET_PKI_CERT_FILE: z.string().optional(),
  FLEET_PKI_KEY_FILE: z.string().optional(),
  FLEET_PKI_CHAIN_FILE: z.string().optional(),
  // Control plane only: Ed25519 PKCS#8 key (and its kid) that signs trust bundles. Distinct from the CA key.
  FLEET_BUNDLE_KEY_FILE: z.string().optional(),
  FLEET_BUNDLE_KEY_ID: z.string().max(64).optional(),
  // Control plane only: Ed25519 PKCS#8 key (and its kid, which must appear in the trust bundle's commandKeys) that signs commands.
  FLEET_COMMAND_KEY_FILE: z.string().optional(),
  FLEET_COMMAND_KEY_ID: z.string().max(64).optional(),
  // Control plane only: the WebAuthn relying party operator co-signatures (class-3 approvals) are bound to, e.g. FLEET_COSIGN_RP_ID=fleet.example.com
  // FLEET_COSIGN_ORIGINS=https://fleet.example.com. Published in the trust bundle so nodes verify against the same RP.
  FLEET_COSIGN_RP_ID: z.string().max(253).optional(),
  FLEET_COSIGN_ORIGINS: z.string().max(2048).optional(),
  // Fleet instance only (auth_oidc_provider, Fleet ID, docs/phases/02-fleet/12): the issuer, an https URL ending in /api/fleet-id and compared byte for
  // byte by every node (e.g. https://id.example.com/api/fleet-id); the token signing key (a PKCS#8 EC P-256 or Ed25519 file and its kid; a KMS
  // OidcKeyProvider replaces the file without touching callers); the retired keys still published in the JWKS after a rotation (JSON array of
  // { kid, jwk, retiredAt, publishUntil }, public JWKs only); and the pairwise-subject secret (a file holding base64 of at least 32 random bytes).
  // Unset issuer, key or secret = the provider endpoints answer 503 on a fleet instance; on any other role they do not exist (404).
  // The signing key provider: `file` (default, the PKCS#8 file above; refused with NODE_ENV=production, F15) or `vault-transit` (the key in
  // Vault/OpenBao Transit at VAULT_ADDR with VAULT_TOKEN, transit key FLEET_ID_VAULT_TRANSIT_KEY under FLEET_ID_VAULT_TRANSIT_MOUNT, default `transit`;
  // kid = FLEET_ID_SIGNING_KEY_ID-v<version>, rotation by Vault key versions; FLEET_ID_RETIRED_KEYS then holds only the file key being migrated away
  // from, published for its window).
  FLEET_ID_SIGNING_PROVIDER: z.enum(['file', 'vault-transit']).optional(),
  FLEET_ID_VAULT_TRANSIT_MOUNT: z.string().max(128).optional(),
  FLEET_ID_VAULT_TRANSIT_KEY: z.string().max(128).optional(),
  FLEET_ID_ISSUER: z.string().max(255).optional(),
  // Fleet instance only (phase 6c, F46): the ISO 3166-1 alpha-2 country the Fleet ID hub runs in (OZ-3). `zone.notice_present` asks a transfer
  // notice and basis of every zone whose region lies outside it (the EU/EEA counts as one). Unset = every region counts as outside (strictest).
  FLEET_HUB_JURISDICTION: z.string().regex(/^[A-Z]{2}$/).optional(),
  FLEET_ID_SIGNING_KEY_FILE: z.string().max(512).optional(),
  FLEET_ID_SIGNING_KEY_ID: z.string().max(64).optional(),
  FLEET_ID_RETIRED_KEYS: z.string().max(16384).optional(),
  FLEET_ID_PAIRWISE_SECRET_FILE: z.string().max(512).optional(),
  // Audit archive (storage, extension point audit_log:archive_exporter). Where the rows of a retention purge are written BEFORE they are deleted: an S3 bucket
  // created WITH Object Lock, so the archive cannot be changed or removed for AUDIT_ARCHIVE_RETENTION_DAYS, not even by the application's own credentials.
  // Unset bucket = no archive. The credentials are the ordinary AWS provider chain (never a key in this file's names); the endpoint is for S3-compatible stores.
  AUDIT_ARCHIVE_BUCKET: z.string().max(255).optional(),
  AUDIT_ARCHIVE_PREFIX: z.string().max(200).optional(),
  AUDIT_ARCHIVE_REGION: z.string().max(64).optional(),
  AUDIT_ARCHIVE_ENDPOINT: z.string().max(512).optional(),
  AUDIT_ARCHIVE_RETENTION_DAYS: blankIsUnset(z.coerce.number().int().min(1).max(36500)),
  // How long an uninstalled built-in module stays restorable with its data before the purge job removes it
  // (docs/phases/37-extensions/08, EXT-4). 0 = purge at uninstall, as before.
  MODULE_RESTORE_WINDOW_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
  AUDIT_ARCHIVE_LOCK_MODE: blankIsUnset(z.enum(['COMPLIANCE', 'GOVERNANCE'])),
  // Control plane only. Where the daily signed audit root is also published (an HTTPS append-only log gateway: a transparency log, a public git-log service, a notary).
  // Unset = the roots are kept by the control plane alone. The token is read from FLEET_ROOT_LOG_AUTH_FILE (a file secret like every secret), never from a value here.
  FLEET_ROOT_LOG_URL: z.string().max(512).optional(),
  FLEET_ROOT_LOG_AUTH_FILE: z.string().max(512).optional(),
  // Control plane only: hours a newly registered co-sign credential waits before it may APPROVE a class-3 command (04 §4.1, 7 days = 168, the default).
  // 0 disables the cooling-off: for a development control plane only.
  FLEET_COSIGN_COOLING_OFF_HOURS: blankIsUnset(z.coerce.number().int().min(0).max(24 * 90)),
  // Control plane only: k of the co-sign key set's k-of-n governance (04 "Co-sign key set changes", Phase 9), published in the trust bundle. Unset = bootstrap
  // trust (the control plane alone changes the set). Once a published bundle names it, every change of the set, of the relying party or of k itself
  // (unsetting it included) needs endorsements by k existing operator credentials; nodes refuse the bundle otherwise.
  FLEET_COSIGN_THRESHOLD: blankIsUnset(z.coerce.number().int().min(2).max(16)),
  // Control plane only (fleet_release). Hours a newly registered RELEASE_MANAGER key waits before it may approve a release (04 §1, 7 days = 168, the
  // default; a CI key has no waiting period). 0 disables the cooling-off: for a development control plane only. The same ceiling as the co-sign credentials.
  FLEET_RELEASE_KEY_COOLING_OFF_HOURS: blankIsUnset(z.coerce.number().int().min(0).max(24 * 90)),
  // Control plane only (fleet_release). Hours after a release is published before `agent.update` is a plain class-2 command (07 §5, 24, the default); inside
  // it the update is class 3. Read when a release is PUBLISHED and stored on it, so a later change applies to later releases. The ceiling is
  // MAX_AGENT_UPDATE_COOLING_HOURS of fleet_release (30 days); 0 is for a development control plane only.
  FLEET_RELEASE_AGENT_UPDATE_COOLING_HOURS: blankIsUnset(z.coerce.number().int().min(0).max(24 * 30)),

  // ── Licensing (docs/phases/35-editions-licensing) ──────────────────────────
  // FLEET_LICENSE_FILE: path to the signed license JSON for immutable infrastructure (containers, fleet nodes). When set
  // it wins over a license installed through the admin page. FLEET_LICENSE_TRUST_KEYS: JSON array of
  // { kid, publicKey, productId? } the verifier trusts, in addition to the keys built into the fleet_license module.
  FLEET_LICENSE_FILE: z.string().optional(),
  FLEET_LICENSE_TRUST_KEYS: z.string().optional(),
  // FLEET_LICENSE_UNLICENSED_POLICY (fleet step 3b.8, F22): which module editions may be newly activated when no license under the
  // PLATFORM trust root is installed. `unrestricted` (unset, the default: OD-136, a customer fork runs Enterprise unlicensed) or
  // `core` (only Core modules). Any other value is read as `core` (fails closed). A lapsed platform license always falls back to Core.
  FLEET_LICENSE_UNLICENSED_POLICY: z.string().optional(),

  // ── Observability probe runners (docs/phases/09-observability/10) ──────────
  // Caps on the leases probe runners may hold at once (handed out, not yet resulted or expired). Past a cap the control plane sheds the lowest-priority due
  // checks (they stay due and are leased later; see modules/observability/server/probe.caps.ts). 0 or unset = NO cap, which is today's behaviour.
  // OBSERVABILITY_PROBE_GLOBAL_LEASE_CAP: across the whole platform. OBSERVABILITY_PROBE_TENANT_LEASE_CAP: the default per tenant (a plan's
  // `observability.limit.runner_leases` wins when it declares one).
  OBSERVABILITY_PROBE_GLOBAL_LEASE_CAP: blankIsUnset(z.coerce.number().int().min(0).max(1_000_000)),
  OBSERVABILITY_PROBE_TENANT_LEASE_CAP: blankIsUnset(z.coerce.number().int().min(0).max(1_000_000)),
};
