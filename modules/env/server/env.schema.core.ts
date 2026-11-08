import { z } from 'zod';
import { boolEnv } from './env.schema.shared';

// Core platform env fields: runtime, DB, Redis, messaging WS, auth secrets,
// session/OTP/TOTP/WebAuthn TTLs, multi-tenancy, application + frontend paths.
export const coreFields = {
  // ── Core ────────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test', 'vercel']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().optional(),
  DEBUG: boolEnv().optional(),
  DEBUG_LOCAL: boolEnv().optional(),
  DEBUG_TESTS: boolEnv().optional(),
  DEBUG_TESTS_REAL_SERVER: boolEnv().optional(),

  // ── Database ────────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1),
  // Direct (non-pooled) connection. Used for DDL — dev schema sync, migrations,
  // and heavy cross-tenant system jobs — which are unsuited to a PgBouncer /
  // Neon pooled connection. Falls back to DATABASE_URL when unset.
  DATABASE_URL_UNPOOLED: z.string().optional(),
  // The cross-tenant (RLS-bypassing) connection — cron sweeps, CLI tooling and
  // migrations, which legitimately read every tenant. Separate from the runtime
  // URL so that bypass becomes a property of WHICH CONNECTION a job opens
  // rather than a session variable the runtime can set on itself
  // (migration 122). Optional: unset falls back to the unpooled URL and then to
  // DATABASE_URL, which is exactly today's behaviour.
  DATABASE_URL_ADMIN: z.string().optional(),
  DB_DEPLOY_SYNC: boolEnv().default(true),
  // Development only: run the dev schema sync even when the entity digest matches _dev_sync_state (repairs hand-made drift).
  NB_DEV_FORCE_SYNC: boolEnv().optional(),
  // Read by modules/db/scripts/db-deploy.ts straight from process.env (it runs before env validation); declared here so the schema and docs stay in sync.
  DB_DEPLOY_MODE: z.enum(['synchronize', 'migrate']).optional(),
  DB_DEPLOY_SEED: z.enum(['auto', 'always', 'never']).optional(),
  DB_DEPLOY_LOCK_TIMEOUT_MS: z.coerce.number().int().min(0).optional(),
  DB_DEPLOY_ACTOR: z.string().max(128).optional(),
  DATABASE_READ_REPLICA_URL: z.string().optional(),
  // TimescaleDB capability (docs/phases/10-db phase 5). `off` forces the plain-table fallback even when the extension exists.
  DB_TIMESCALE: z.enum(['auto', 'off']).default('auto'),
  // Chunk interval of the Core telemetry store's raw tables (docs/phases/42-telemetry/00 §0.6, ED-15). Unset: 1 hour when the IoT
  // package is installed, 1 day otherwise. Applied forward-only to existing hypertables by the deploy phase.
  TELEMETRY_CHUNK_INTERVAL_RAW: z.enum(['1 hour', '1 day', '7 days']).optional(),
  DB_POOL_MAX: z.coerce.number().default(10),
  // How long a query waits for a free pooled connection before failing. 0 = wait forever
  // (pg default); a bounded wait turns pool saturation into an error instead of a hang.
  DB_POOL_ACQUIRE_TIMEOUT_MS: z.coerce.number().default(10000),
  DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().default(1000),

  // ── Redis ───────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Sentinel mode: comma-separated host:port pairs (e.g. sentinel1:26379,sentinel2:26379)
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_NAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_SENTINEL_PASSWORD: z.string().optional(),
  // Per-tenant query timeout (ms). 0 = disabled.
  DB_QUERY_TIMEOUT_MS: z.coerce.number().default(0),
  // Inactive user auto-deactivation (days). 0 = disabled.
  USER_INACTIVE_DAYS: z.coerce.number().default(0),

  // ── Realtime WebSocket gateway (standalone Socket.IO process, all namespaces) ─
  // Generic gateway config. When unset, the legacy MESSAGING_WS_* values below
  // are used as a fallback (see modules/websocket/server/index.ts).
  WS_PORT: z.coerce.number().optional(),
  // Public URL the browser connects to (returned alongside the WS ticket).
  WS_PUBLIC_URL: z.string().optional(),
  // CORS origin allowed by the WS server (defaults to permissive in dev).
  WS_CORS_ORIGIN: z.string().optional(),
  // Refused handshakes (bad, used or expired tickets) one address may cause per minute per gateway node before its next
  // handshakes are refused without a ticket lookup (risk register websocket.06). 0 = no budget.
  WS_HANDSHAKE_REFUSALS_PER_MINUTE: z.coerce.number().int().min(0).default(100),
  // Comma-separated addresses exempt from every per-address limit: the load balancer in front of the gateway. In TCP mode
  // every client arrives from its address, and limiting it would refuse everyone (O25-5: PROXY protocol restores per-IP).
  WS_TRUSTED_PROXIES: z.string().optional(),
  // A supervised ws (PROC_WS_ENABLED=true, docs/phases/14-docker/07 task 7): the supervisor's /healthz and /metrics. The
  // children share WS_PORT through `cluster`, so the supervisor cannot listen there; it must differ from WS_PORT.
  WS_SUPERVISOR_PORT: z.coerce.number().default(4014),
  WORKER_HEALTH_PORT: z.coerce.number().default(4010),
  // The automation-worker process kind (docs/phases/14-docker/07 task 4): its /healthz and /metrics (the supervisor's when supervised).
  AUTOMATION_WORKER_HEALTH_PORT: z.coerce.number().default(4013),
  // Sidecar contract (docs/phases/14-docker/02): a draining process exits within this window.
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(10_000),
  // Declared sidecar kinds the platform expects alive, e.g. `ws:1,worker:1`.
  // Empty = the process registry never opens an incident (docs/phases/09-observability/phase-5).
  EXPECTED_PROCESSES: z.string().optional(),

  // ── Messaging WebSocket service (deprecated aliases; kept for back-compat) ────
  MESSAGING_WS_PORT: z.coerce.number().default(4001),
  // Public URL the browser connects to (returned alongside the WS ticket).
  MESSAGING_WS_PUBLIC_URL: z.string().optional(),
  // CORS origin allowed by the WS server (defaults to permissive in dev).
  MESSAGING_WS_CORS_ORIGIN: z.string().optional(),

  // ── Auth / Secrets ──────────────────────────────────────────────────────────
  ACCESS_TOKEN_SECRET: z.string().min(1),
  ACCESS_TOKEN_EXPIRES_IN: z.string().optional(),
  REFRESH_TOKEN_SECRET: z.string().min(1),
  REFRESH_TOKEN_EXPIRES_IN: z.string().optional(),
  CSRF_SECRET: z.string().min(1),

  // ── Session / Token TTLs ────────────────────────────────────────────────────
  SESSION_CACHE_TTL: z.coerce.number().default(1800),
  SESSION_EXPIRY_MS: z.coerce.number().optional(),
  // "Remember me" opt-in at login: the sliding session window and its absolute
  // ceiling both widen. Defaults: 30-day sliding window, 30-day hard cap.
  REMEMBER_ME_SESSION_EXPIRY_MS: z.coerce.number().optional(),
  AUTH_SESSION_REMEMBER_ME_MAX_HOURS: z.coerce.number().default(720),
  // Default session-policy values used when no system/tenant setting overrides them.
  // Raise these in dev so a long coding session doesn't idle-expire the login.
  AUTH_SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().default(30),
  AUTH_SESSION_ABSOLUTE_MAX_HOURS: z.coerce.number().default(8),
  // Grace window (seconds) during which the previous, just-rotated refresh token
  // is still accepted, so concurrent refreshes from multiple tabs don't trip
  // reuse-detection and log the user out everywhere. Keep small.
  REFRESH_TOKEN_GRACE_SECONDS: z.coerce.number().default(15),
  RESET_TOKEN_EXPIRY_SECONDS: z.coerce.number().optional(),
  RESET_TOKEN_LENGTH: z.coerce.number().optional(),
  EMAIL_VERIFY_TTL_SECONDS: z.coerce.number().optional(),
  EMAIL_VERIFY_RATE_LIMIT_SECONDS: z.coerce.number().optional(),
  INVITATION_TTL_SECONDS: z.coerce.number().optional(),

  // ── OTP ─────────────────────────────────────────────────────────────────────
  OTP_LENGTH: z.coerce.number().optional(),
  OTP_EXPIRY_SECONDS: z.coerce.number().optional(),
  OTP_MAX_ATTEMPTS: z.coerce.number().optional(),
  OTP_RATE_LIMIT_SECONDS: z.coerce.number().optional(),

  // ── TOTP ─────────────────────────────────────────────────────────────────────
  TOTP_ISSUER: z.string().optional(),
  TOTP_STEP_SECONDS: z.coerce.number().optional(),
  TOTP_SETUP_EXPIRY_SECONDS: z.coerce.number().optional(),
  TOTP_WINDOW: z.coerce.number().optional(),

  // ── WebAuthn ────────────────────────────────────────────────────────────────
  WEBAUTHN_ORIGIN: z.string().optional(),
  WEBAUTHN_RP_ID: z.string().optional(),
  // Extra origins a passkey ceremony may come from (comma-separated), beyond WEBAUTHN_ORIGIN.
  // The Android origins of the native app are derived from MOBILE_ANDROID_CERT_SHA256 and need
  // not be listed here.
  WEBAUTHN_EXTRA_ORIGINS: z.string().optional(),

  // ── Native app identity (passkeys + universal/app links) ────────────────────
  // Served at /.well-known/assetlinks.json and /.well-known/apple-app-site-association so the
  // OS lets the app use the RP ID's passkeys and open invitation links. All optional: with none
  // set the files answer 404 and nothing changes for the web.
  MOBILE_ANDROID_PACKAGE_NAME: z.string().optional(),
  // Comma-separated SHA-256 signing-certificate fingerprints, colon-hex (AA:BB:…). Include the
  // Play App Signing key AND any upload/debug key you test with.
  MOBILE_ANDROID_CERT_SHA256: z.string().optional(),
  // Comma-separated `<TeamID>.<bundle id>` values.
  MOBILE_IOS_APP_IDS: z.string().optional(),
  MOBILE_LINK_HOSTS: z.string().optional(),

  // ── Multi-tenancy ───────────────────────────────────────────────────────────
  TENANCY_MODE: z.enum(['domain', 'subdomain', 'path']).default('domain'),
  // Set NEXT_PUBLIC_TENANT_WILDCARD_DOMAIN instead — this server-side twin is
  // filled in from it by applyPublicAliases() in env.service.ts.
  TENANT_WILDCARD_DOMAIN: z.string().optional(),
  TENANT_DEFAULT_SUBDOMAIN: z.string().optional(),
  TENANT_PATH_PREFIX: z.string().optional(),
  TENANT_CACHE_TTL: z.coerce.number().optional(),
  // How many reverse proxies this app sits behind, each appending to X-Forwarded-For. The client IP is the entry that
  // many places from the right, so a value a client wrote further left is never trusted. Default 1 (one edge proxy
  // that sets or appends the header, like the node Caddyfile); 0 = no proxy, X-Forwarded-For is ignored entirely.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),
  VERIFICATION_DOMAIN: z.string().optional(),

  // ── Application ─────────────────────────────────────────────────────────────
  APPLICATION_NAME: z.string().optional(),
  APPLICATION_DOMAIN: z.string().optional(),
  APPLICATION_HOST: z.string().optional(),
  APPLICATION_LOGO_TEXT: z.string().optional(),
  INFORM_MAIL: z.string().optional(),
  INFORM_NAME: z.string().optional(),

  // ── Frontend paths ──────────────────────────────────────────────────────────
  FRONTEND_LOGIN_PATH: z.string().optional(),
  FRONTEND_REGISTER_PATH: z.string().optional(),
  FRONTEND_FORGOT_PASSWORD_PATH: z.string().optional(),
  FRONTEND_RESET_PASSWORD_PATH: z.string().optional(),
  FRONTEND_PRIVACY_PATH: z.string().optional(),
  FRONTEND_TERMS_PATH: z.string().optional(),
  FRONTEND_SUPPORT_EMAIL: z.string().optional(),

  // ── NEXT_PUBLIC ─────────────────────────────────────────────────────────────
  NEXT_PUBLIC_API_URL: z.string().optional(),
  NEXT_PUBLIC_APPLICATION_HOST: z.string().optional(),
  NEXT_PUBLIC_APPLICATION_NAME: z.string().optional(),
  NEXT_PUBLIC_TENANT_WILDCARD_DOMAIN: z.string().optional(),
  NEXT_PUBLIC_TINYMCE_API_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),

  // ── Push notifications (VAPID) ──────────────────────────────────────────────
  VAPID_CONTACT_EMAIL: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Expo push service (native apps). Optional: Expo accepts unauthenticated sends unless the
  // project turned on "enhanced push security", in which case this access token is required.
  EXPO_ACCESS_TOKEN: z.string().optional(),
};
