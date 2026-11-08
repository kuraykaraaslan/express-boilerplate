// Secret-class environment variable names (docs/phases/02-fleet/08 `secrets.as_files`, 07 section 2).
//
// A "secret-class" variable is one whose VALUE must never sit in a container's configured environment (Compose
// file, `docker inspect`): it reaches the process as a mounted file instead (`<NAME>_FILE` reference or the
// `infra/docker/secrets-env.sh` secrets directory). This file is the single machine definition of that set.
//
// Pure and dependency-free on purpose: `fleet-deployd` and the Compose guard embed it without the env schema (zod)
// or the env service. `SECRET_KEYS` in env.schema.shared.ts is a separate, hand-kept REDACTION set; the tests of
// this file fail when a member of it is not classified here, and when a schema field that looks like a credential
// is neither classified nor reviewed below, so a new secret cannot ship unclassified.
//
// Fails closed: matching is case-insensitive, and anything that merely looks like a credential is secret-class
// unless a reviewer wrote it into NON_SECRET_ENV_NAMES with a reason.

/** Reviewed names that are secret-class although (or because) no suffix pattern says so. Upper case. */
export const SECRET_ENV_NAMES: ReadonlySet<string> = new Set([
  // Signing, session, CSRF and encryption secrets.
  'ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'CSRF_SECRET', 'CRON_SECRET', 'METRICS_SECRET',
  'DOTENV_KEY', 'SETTINGS_ENCRYPTION_KEY', 'SETTINGS_ENCRYPTION_KEY_PREVIOUS',
  // Mail, SMS and messaging providers.
  'SMTP_PASS', 'MAILGUN_API_KEY', 'POSTMARK_API_KEY', 'SENDGRID_API_KEY', 'RESEND_API_KEY',
  'AWS_SES_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_SECRET_ACCESS_KEY',
  'TWILIO_AUTH_TOKEN', 'NEXMO_API_SECRET', 'CLICKATELL_API_KEY', 'NETGSM_PASSWORD', 'EXPO_ACCESS_TOKEN',
  'VAPID_PRIVATE_KEY',
  // AI providers.
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY',
  // OAuth clients.
  'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET', 'APPLE_PRIVATE_KEY', 'META_CLIENT_SECRET',
  'MICROSOFT_CLIENT_SECRET', 'AUTODESK_CLIENT_SECRET', 'LINKEDIN_CLIENT_SECRET', 'TIKTOK_CLIENT_SECRET',
  'TWITTER_CLIENT_SECRET', 'WECHAT_APP_SECRET', 'YANDEX_CLIENT_SECRET', 'VK_CLIENT_SECRET',
  'QQ_CLIENT_SECRET', 'WEIBO_CLIENT_SECRET', 'ALIPAY_PRIVATE_KEY',
  // Electronic identity and signature providers (the *_MAP values are JSON blobs that carry credentials).
  'LOTL_SIGNER_CERT_PEM', 'MOBIL_IMZA_AGGREGATOR_API_KEY', 'MOBIL_IMZA_CALLBACK_HMAC_SECRET',
  'SMART_ID_RELYING_PARTY_UUID', 'BANKID_SE_CLIENT_KEY_PATH', 'ACS_PROVIDER_MAP', 'EID_PROVIDER_MAP',
  'SMS_PROVIDER_MAP',
  // Connection strings embed the password (also matched by DATABASE_URL_PATTERN, listed for the reviewer).
  'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DATABASE_URL_ADMIN', 'DATABASE_READ_REPLICA_URL',
  'SYSTEM_DATABASE_URL', 'TENANT_DATABASE_URL', 'REDIS_URL', 'REDIS_PASSWORD', 'REDIS_SENTINEL_PASSWORD',
  // Secrets managers and in-repo services.
  'VAULT_TOKEN', 'TELEPHONY_NONCE_SECRET', 'AUTOMATION_SCRIPT_HOST_TOKEN',
  // An ingest key (scope telemetry:write) of the tenant NB's own logs are exported into.
  'TELEMETRY_LOG_EXPORT_KEY',
  // Phase 55 03 (D55-95): the AI firewall's probe and benign runner digests, the MAC keys of their proofs (staging and demo only).
  'AI_FIREWALL_PROBE_RUNNER_SHA256', 'AI_FIREWALL_BENIGN_RUNNER_SHA256',
]);

/**
 * Names that look like a credential to a suffix pattern or a keyword, reviewed as NOT secret, with the reason.
 * Every entry of a schema field must stay in the schema (the test fails on a stale one).
 */
export const NON_SECRET_ENV_NAMES: Readonly<Record<string, string>> = {
  // Token lifetimes and limits, not tokens.
  ACCESS_TOKEN_EXPIRES_IN: 'lifetime',
  REFRESH_TOKEN_EXPIRES_IN: 'lifetime',
  REFRESH_TOKEN_GRACE_SECONDS: 'lifetime',
  RESET_TOKEN_EXPIRY_SECONDS: 'lifetime',
  RESET_TOKEN_LENGTH: 'length',
  ANTHROPIC_MAX_TOKENS: 'limit',
  GOOGLE_MAX_TOKENS: 'limit',
  OPENAI_MAX_TOKENS: 'limit',
  AUTH_SESSION_ABSOLUTE_MAX_HOURS: 'lifetime',
  AUTH_SESSION_IDLE_TIMEOUT_MINUTES: 'lifetime',
  AUTH_SESSION_REMEMBER_ME_MAX_HOURS: 'lifetime',
  RATE_LIMIT_AUTH_MAX: 'limit',
  RATE_LIMIT_AUTH_WINDOW_MS: 'limit',
  FLEET_RELEASE_KEY_COOLING_OFF_HOURS: 'lifetime (hours a new release-manager key waits; the name only says whose key)',
  // Public identifiers and public keys.
  APPLE_KEY_ID: 'public key identifier',
  TIKTOK_CLIENT_KEY: 'public application identifier (the secret is TIKTOK_CLIENT_SECRET)',
  MOBILE_ANDROID_CERT_SHA256: 'public certificate fingerprint',
  FLEET_BUNDLE_KEY_ID: 'key identifier',
  FLEET_COMMAND_KEY_ID: 'key identifier',
  FLEET_ID_SIGNING_KEY_ID: 'key identifier',
  FLEET_ID_RETIRED_KEYS: 'public verification keys (a private JWK member is refused at parse)',
  FLEET_ID_VAULT_TRANSIT_KEY: 'the NAME of the Fleet ID signing key in Vault Transit; the key material never leaves Vault',
  FLEET_ID_VAULT_TRANSIT_MOUNT: 'Vault mount path, not a credential',
  FLEET_ID_SIGNING_PROVIDER: 'provider selector (file, vault-transit)',
  FLEET_LICENSE_TRUST_KEYS: 'public verification keys',
  FLEET_ROOT_FINGERPRINT: 'public fingerprint',
  AWS_ACCESS_KEY_ID: 'identifier (the secret half is AWS_SECRET_ACCESS_KEY)',
  AWS_S3_ACCESS_KEY_ID: 'identifier (the secret half is AWS_S3_SECRET_ACCESS_KEY)',
  AWS_SES_ACCESS_KEY_ID: 'identifier (the secret half is AWS_SES_SECRET_ACCESS_KEY)',
  SECRETS_MANAGER_PROVIDER: 'provider selector',
  LOG_REDACT_KEYS: 'a list of key NAMES the logger redacts (for example pin,otp), never values',
  // Switches and paths that are not values.
  FLEET_ALLOW_PLAINTEXT_KEY: 'boolean switch (the Compose guard flags it separately)',
  PATH: 'executable search path',
  VAULT_PATH: 'secret path inside the vault, not a credential',
  SECRETS_MANAGER_PREFIX: 'key prefix in the secrets manager',
  TR_TRUST_ROOTS_PATH: 'path to public trust roots',
  BANKID_SE_CLIENT_CERT_PATH: 'path to a public client certificate',
  FRONTEND_FORGOT_PASSWORD_PATH: 'public route',
  FRONTEND_LOGIN_PATH: 'public route',
  FRONTEND_PRIVACY_PATH: 'public route',
  FRONTEND_REGISTER_PATH: 'public route',
  FRONTEND_RESET_PASSWORD_PATH: 'public route',
  FRONTEND_TERMS_PATH: 'public route',
  TENANT_PATH_PREFIX: 'public route prefix',
  TENANT_KEY_PROVIDER: 'the name of the tenant-key provider (node-key, file, kms, vault), not a key',
  TENANT_KEYSTORE_DIR: 'path of the tenant key store directory; its slot files are KEK-wrapped, the directory name is no secret',
  STORAGE_LOCAL_DIR: 'path of the local disk storage directory, no secret',
};

/** Connection strings carry the password in the URL. */
const DATABASE_URL_PATTERN =
  /(?:^|_)(?:DATABASE|POSTGRES|POSTGRESQL|MYSQL|MARIADB|MONGO|MONGODB|REDIS|AMQP|RABBITMQ)(?:_[A-Z0-9]+)*_(?:URL|URI)(?:_[A-Z0-9]+)*$|(?:^|_)CONNECTION_STRING$/;

/** Credential-looking last segments. */
const SECRET_SUFFIX_PATTERN =
  /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PASS|PASSPHRASE|CREDENTIALS?|DSN|API_KEY|ACCESS_KEY|PRIVATE_KEY|SECRET_KEY|ENCRYPTION_KEY|SIGNING_KEY|PEM|KEY|HMAC|SALT|PEPPER)$/;

/** Public by design: an inlined `NEXT_PUBLIC_*` value or a public half of a key pair. */
const PUBLIC_PATTERN = /^NEXT_PUBLIC_|(?:^|_)PUBLIC_KEY$/;

/** A `<NAME>_FILE` variable holds the PATH of a mounted secret, never the secret. */
const FILE_REFERENCE_PATTERN = /_FILE$/;

export type EnvNameClass = 'secret' | 'file-reference' | 'public' | 'reviewed-non-secret' | 'unmarked';

/**
 * How `name` is treated. `unmarked` is the default for everything that looks harmless; a schema test fails when an
 * `unmarked` field name still contains a credential keyword, so such a field must be classified on purpose.
 */
export function classifyEnvName(name: string): EnvNameClass {
  const n = name.trim().toUpperCase();
  if (SECRET_ENV_NAMES.has(n)) return 'secret';
  if (Object.prototype.hasOwnProperty.call(NON_SECRET_ENV_NAMES, n)) return 'reviewed-non-secret';
  if (FILE_REFERENCE_PATTERN.test(n)) return 'file-reference';
  if (PUBLIC_PATTERN.test(n)) return 'public';
  if (DATABASE_URL_PATTERN.test(n) || SECRET_SUFFIX_PATTERN.test(n)) return 'secret';
  return 'unmarked';
}

/** True when the value of the variable `name` must not appear in a container's configured environment. */
export function isSecretEnvName(name: string): boolean {
  return classifyEnvName(name) === 'secret';
}
