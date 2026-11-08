import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { invalidSubnetEntries } from '@kuraykaraaslan-labs/ip_subnet';
import { SECRET_MASK } from './setting-fields.types';
import { SETTING_KEYS_BY_MODULE, SETTING_KEY_PREFIXES_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';

// ── Sensitive keys — encrypted at rest, masked in API responses ──────────────
/**
 * tenant_setting.04: a declared key whose NAME says it is a credential is sensitive even when nobody listed it below
 * (about 28 were missing: stored in plaintext, returned unmasked, sent in the `tenant_setting.changed` webhook).
 * Over-matching only encrypts and masks a value that did not need it.
 */
const CREDENTIAL_NAME_RE = /(?:Secret|SecretKey|SecretAccessKey|Password|Passwd|Token|ApiKey|AccessKey|PrivateKey|HmacKey|KeySecret|SigningKey)$/;
const DECLARED_CREDENTIALS = Object.values(SETTING_KEYS_BY_MODULE).flat().filter((k) => CREDENTIAL_NAME_RE.test(k));

export const SENSITIVE_KEYS = new Set([
  ...DECLARED_CREDENTIALS,
  's3SecretKey', 's3AccessKey', 'mailApiKey', 'smtpPass', 'smtpPassword',
  'mailgunApiKey', 'sendgridApiKey', 'resendApiKey', 'postmarkApiKey',
  'twilioAuthToken', 'nexmoApiSecret', 'stripeSecretKey', 'stripeWebhookSecret',
  'paypalClientSecret', 'paymentSecretKey', 'openaiApiKey', 'anthropicApiKey',
  'googleAiApiKey', 'webhookSecret', 'accessTokenSecret', 'refreshTokenSecret',
  'settingsEncryptionKey', 'vapidPrivateKey', 'samlPrivateKey',
  // Invoice e-signature seal (private key + cert) and e-invoice gateway creds
  'invoiceSigningKeyPem', 'invoiceSigningCertPem',
  'fatturapaGatewayToken', 'chorusProToken', 'cfdiPacToken', 'gstIrpToken',
  'peppolAccessPointToken',
  // Payment provider secret credentials (encrypt at rest).
  'iyzicoApiKey', 'iyzicoSecretKey',
  'alipayPrivateKey', 'wechatPayPrivateKey', 'wechatPayApiV3Key',
  'yookassaSecretKey', 'cloudpaymentsApiSecret',
  // Data-enrichment provider credentials. `clayApiKey` spends real money per
  // call, and `clay.settings.fields.ts` documented it as encrypted at rest
  // before it was in this set — the comment was true of the intent and false of
  // the storage.
  'clayApiKey',
  // Inbound webhook shared secrets. Both, because a rotation keeps the previous
  // one live for a window and an unencrypted "previous" secret is exactly as
  // usable to an attacker as an unencrypted current one.
  'mailInboundWebhookSecret', 'mailInboundWebhookSecretPrevious',
  'fulfillmentCarrierWebhookSecret', 'fulfillmentCarrierWebhookSecretPrevious',
  // İYS OAuth2 password-grant credential.
  'iysPassword',
  // On-call Slack: the incoming-webhook URL lets anyone post into the channel and the signing secret authenticates every button click.
  'onCallSlackWebhookUrl', 'onCallSlackSigningSecret',
  // tenant_setting.04: credentials declared by modules whose names the rule above may not catch.
  'jwtAccessTokenSecret', 'jwtRefreshTokenSecret', 'googleClientSecret', 'githubClientSecret', 'applePrivateKey', 'metaClientSecret',
  'autodeskClientSecret', 'gitlabToken', 'huggingfaceToken', 'mobilImzaAggregatorApiKey', 'mobilImzaCallbackHmacSecret',
  'earsivIntegratorPassword', 'zugferdGatewayToken', 'mediaCsamApiKey', 'mediaPhashApiKey', 'awsSesSecretAccessKey', 'clickatellApiKey',
  'netgsmPassword', 'verimorPassword', 'adyenApiKey', 'adyenHmacKey', 'mollieApiKey', 'razorpayKeySecret', 'razorpayWebhookSecret',
  'virusScanApiKey', 'maxmindApiKey', 'cronSecret',
  // 04-tenant-setting 2.1: credentials whose names the rule above misses. The server key signs every reCAPTCHA verification; the Slack
  // incoming-webhook URL lets anyone who holds it post into the channel.
  'recaptchaServerKey', 'slackWebhookUrl',
  // 04-tenant-setting 1.2: PayTR's HMAC signing key and salt. ROOT's values reach every tenant's admins through the inherited answer, so they must
  // be masked there (and sealed at rest like every other credential).
  'paytrMerchantKey', 'paytrMerchantSalt',
  // 04-tenant-setting: the name matches CREDENTIAL_NAME_RE, but that rule reads the generated catalog; listed so the key is sealed and masked
  // even while a stale catalog does not hold it yet.
  'stripeConnectSecretKey',
]);

/**
 * 04-tenant-setting 2.1: run-time key families (`ssoClientSecret:<provider>`) whose members are credentials. A declared family is one when its name
 * (without the trailing `:`) reads as a credential under the same rule as the listed keys, so `ssoClientSecret:` is one and
 * `ssoClientSecretSetAt:` (a timestamp) is not. `ssoClientSecret:` is also listed by hand: it must stay sensitive whatever the generated
 * catalog holds.
 */
export const SENSITIVE_KEY_PREFIXES: readonly string[] = [...new Set([
  ...Object.values(SETTING_KEY_PREFIXES_BY_MODULE).flat().filter((p) => p.endsWith(':') && CREDENTIAL_NAME_RE.test(p.slice(0, -1))),
  'ssoClientSecret:',
  // integrations_hub's connector secrets (MS-20); also derived from the catalog, listed so they stay sealed whatever it holds.
  'integrationsClientSecret:',
])];

/**
 * Is `key` a credential: encrypted at rest, masked in every API answer, never sent in the `tenant_setting.changed` webhook (04-tenant-setting 2.1)?
 * A listed key, or a member of a credential family. Every decision about a secret goes through here, never `SENSITIVE_KEYS.has` alone: the set
 * cannot hold a family.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_PREFIXES.some((p) => key.length > p.length && key.startsWith(p));
}

/**
 * 04-tenant-setting 1.2: the account half of a credential pair (`smtpUsername`, `awsSesAccessKeyId`, `twilioAccountSid`, ...). Not a secret, so a
 * tenant sees its own; but ROOT's are the platform's provider accounts, so the inherited answer never carries them (it leaves the key out rather
 * than masking it: a masked value in a plain text input could be edited and saved back).
 */
const CREDENTIAL_IDENTIFIER_RE = /(?:Username|ApiUser|UserCode|AccessKeyId|AccountSid|AccountId|MerchantId)$/;
const CREDENTIAL_IDENTIFIER_KEYS = new Set(['gitlabUser']);

export function isCredentialIdentifierKey(key: string): boolean {
  return CREDENTIAL_IDENTIFIER_RE.test(key) || CREDENTIAL_IDENTIFIER_KEYS.has(key);
}

/**
 * A `key -> value` map as an API response may carry it (tenant_setting.01): every non-empty sensitive value is replaced by the mask, so no
 * settings route answers a secret in plaintext, whether it is the tenant's own, inherited from ROOT, or just written.
 */
export function maskSecrets(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) out[key] = isSensitiveKey(key) && value ? SECRET_MASK : value;
  return out;
}

/** Is `value` the mask a masked read returned for a sensitive key? A client that saves it back means "keep the stored secret". */
export function isMaskedSecretEcho(key: string, value: unknown): boolean {
  return isSensitiveKey(key) && value === SECRET_MASK;
}

/**
 * 04-tenant-setting 1.3: a form that put the mask into a password input and had text typed after it sends `***SET***<typed>`. That is never a
 * credential, and storing it breaks the provider: such a value is refused (400) on every write path.
 */
export function isMaskPrefixedSecret(key: string, value: unknown): boolean {
  return isSensitiveKey(key) && typeof value === 'string' && value !== SECRET_MASK && value.startsWith(SECRET_MASK);
}

// ── IANA timezone validation ─────────────────────────────────────────────────
function isValidIANATimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ISO 4217 currency codes (common subset; extend as needed)
const ISO4217_CODES = new Set([
  'USD','EUR','GBP','TRY','JPY','CNY','INR','KRW','BRL','CAD','AUD','CHF',
  'SEK','NOK','DKK','PLN','CZK','HUF','RON','BGN','HRK','RSD','RUB','UAH',
  'AED','SAR','QAR','KWD','BHD','OMR','EGP','MAD','NGN','GHS','KES','ZAR',
  'MXN','COP','ARS','CLP','PEN','UYU','VEF','SGD','HKD','TWD','THB','IDR',
  'MYR','PHP','PKR','BDT','LKR','NPR','MMK','VND','KHR',
]);

function isValidISO4217(code: string): boolean {
  return ISO4217_CODES.has(code.toUpperCase());
}

// ── BCP-47-ish language code validation ──────────────────────────────────────
// Loose: 2–3 letter primary subtag + optional `-SUBTAG` parts. Good enough to
// reject junk without shipping a full language registry.
const LANG_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
function isValidLangCode(code: string): boolean {
  return LANG_CODE_RE.test(code.trim());
}

// ── Tenant IP allow/deny lists ───────────────────────────────────────────────
// Enforced on every tenant request (tenant_session.policy.ts). One entry that is
// not an address or CIDR block would sit in an allow list as a rule nobody
// matches, which refuses everyone, so the whole value is refused instead.
export const IP_LIST_KEYS: ReadonlySet<string> = new Set(['ipWhitelist', 'ipBlacklist', 'globalIpBlacklist']);

// ── Privacy: how long a closed data-subject request keeps its personal data ──
// Read by privacy's `privacy-request-retention` sweep (privacy.settings.ts), which clears the subject's email, name, notes and identifiers of a
// closed request after this many days; 0 keeps them. The row is the controller's evidence that a right was answered, and on time, and that
// evidence must outlive the window in which the answer can be challenged:
//  - KVKK m.13/m.14: the controller answers within 30 days, the subject may complain to the Board within 30 days of the answer (60 days after
//    the request when unanswered), and the Board then asks the controller for its records;
//  - a compensation claim over the handling (KVKK m.14/3, TBK m.72) is time-barred two years after the subject learns of the damage and who
//    caused it; GDPR art.82 claims follow national limitation, commonly two to three years.
// Two years (730 days) is the floor: below it the evidence can be gone while a complaint or claim is still open. The default stays 1095 (three
// years, the longer national periods). A shorter value is refused on write; one stored before this rule reads as the floor (privacy.settings.ts).
export const PRIVACY_CLOSED_REQUEST_RETENTION_KEY = 'privacyClosedRequestRetentionDays';
export const PRIVACY_CLOSED_REQUEST_MIN_RETENTION_DAYS = 730;
export const PRIVACY_CLOSED_REQUEST_MAX_RETENTION_DAYS = 36_500;
/** `details.messageKey` of the refusal: the settings page shows it translated (en/tr, tenant_setting dictionaries). */
export const PRIVACY_CLOSED_RETENTION_RANGE_MESSAGE_KEY = 'tenant_setting.errors.privacyClosedRetentionRange';

/** Whether a submitted closed-request retention is acceptable (pure): empty (the default), 0 (keep), or a whole number of days in [floor, max]. */
export function isValidClosedRequestRetention(value: string): boolean {
  const v = value.trim();
  if (v === '') return true;
  if (!/^\d+$/.test(v)) return false;
  const n = Number(v);
  return n === 0 || (n >= PRIVACY_CLOSED_REQUEST_MIN_RETENTION_DAYS && n <= PRIVACY_CLOSED_REQUEST_MAX_RETENTION_DAYS);
}

// ── Sign-in policy values (MS-39, 2026-10-27) ──────────────────────────────────────────────────────────────────────
// `twoFactorRequired` (tenant_session.policy.ts): on only for exactly 'true'; any other text used to read as off without a
// word, so only 'true', 'false' or empty (the default, off) is stored.
export const TWO_FACTOR_REQUIRED_VALUES: ReadonlySet<string> = new Set(['', 'true', 'false']);
// `lockoutMaxAttempts` (auth.policy.loader.service.ts getLockoutPolicy): failed sign-ins before an account is locked. The
// built-in limit is 5 and a tenant's value can only lower it (the stricter one wins); 0 means "off" there, and on ROOT a
// value above 5 would loosen every tenant's. So only a whole number 1..5 (or empty, the built-in 5) is stored: the field
// can only make the lockout stricter. A value stored before this rule is read as auth reads it.
export const LOCKOUT_MAX_ATTEMPTS_KEY = 'lockoutMaxAttempts';
export const LOCKOUT_MAX_ATTEMPTS_MIN = 1;
export const LOCKOUT_MAX_ATTEMPTS_MAX = 5;

/** Whether a submitted lockout threshold is acceptable (pure): empty, or a whole number in [1, 5]. */
export function isValidLockoutMaxAttempts(value: string): boolean {
  const v = value.trim();
  if (v === '') return true;
  if (!/^\d{1,2}$/.test(v)) return false;
  const n = Number(v);
  return n >= LOCKOUT_MAX_ATTEMPTS_MIN && n <= LOCKOUT_MAX_ATTEMPTS_MAX;
}

// ── The AI firewall's switches and modes (phase 55 01 §1.1) ─────────────────────────────────────────────────────────
// Read by ai_firewall.settings-policy.ts, which reads anything else as off / Observe; refused here so the admin sees the mistake. The
// default mode is never `auto` (Auto is chosen one action at a time). Written out, not imported: tenant_setting never imports the modules
// that require it.
export const AI_FIREWALL_SWITCH_KEYS: ReadonlySet<string> = new Set(['aiFirewallKillSwitch', 'aiFirewallPlatformKillSwitch', 'aiFirewallSignupHardBlock']);
export const AI_FIREWALL_SWITCH_VALUES: ReadonlySet<string> = new Set(['', 'true', 'false']);
export const AI_FIREWALL_DEFAULT_MODE_VALUES: ReadonlySet<string> = new Set(['', 'observe', 'suggest']);
export const AI_FIREWALL_ACTION_MODE_VALUES: ReadonlySet<string> = new Set(['', 'observe', 'suggest', 'auto']);
export const AI_FIREWALL_MODE_KEY_RE = /^aiFirewallMode:[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

// ── Drive's numeric settings (docs/phases/41-ui-fixes/10 4.1, decision f) ─────
// Saved unvalidated, they were silently replaced on read: a negative link cap meant "never-expiring links allowed".
// Whole numbers in a range; an empty value is the field's default. `driveMaxPublicLinkDays` 0 = no cap and
// `driveStorageQuotaMb` 0 = unlimited (drive.share-policy.ts / drive.storage-policy.ts read them so).
// `driveDefaultShareRole` is viewer or editor: a share never hands out `owner` (drive.05), so that default made every
// share without a role fail.
export const DRIVE_INTEGER_SETTINGS: Readonly<Record<string, { min: number; max?: number }>> = {
  driveTrashRetentionDays: { min: 1, max: 3650 },
  driveMaxPublicLinkDays: { min: 0, max: 3650 },
  driveStorageQuotaMb: { min: 0 },
};
export const DRIVE_SHARE_ROLE_OPTIONS = ['viewer', 'editor'] as const;
/** `details.messageKey` of these refusals: generic, with `vars`, so the settings page can show them translated. */
export const INTEGER_RANGE_MESSAGE_KEY = 'tenant_setting.errors.integerRange';
export const INTEGER_MIN_MESSAGE_KEY = 'tenant_setting.errors.integerMin';
export const ONE_OF_MESSAGE_KEY = 'tenant_setting.errors.oneOf';

// ── The lead finder's settings (docs/phases/41-ui-fixes/11 4.4, decision d) ───
// Saved unvalidated, a bad value could only produce a broken run: max leads <= 0 read as the 500 ceiling, an unbounded
// page cannot fit one classifier reply (every batch DEGRADED), a typo'd model name degraded every batch. The ranges are
// the readers' own (crm_lead_finder.settings.read.ts imports this table, so a save and a read cannot disagree):
//   crmLeadFinderMaxLeadsPerRun      1..500  — 500 is the DTO's hard ceiling (MAX_LEADS_PER_RUN); a setting only lowers it.
//   crmLeadFinderPageSize            1..50   — the classifier answers in one 4096-token reply, ~120 tokens per company;
//                                              the provider's own page maximum (Clay: 500) is far past what can be scored.
//   crmLeadFinderPagesPerTick        1..50   — a tick also yields after 8 minutes whatever this says.
//   crmLeadFinderContactsPerCompany  0..25   — CreateSearchDTO's range; 0 = find no decision-makers.
// An empty value is the field's default. Kept here, not imported: tenant_setting is core and may not depend on the
// enterprise module.
export const CRM_LEAD_FINDER_INTEGER_SETTINGS: Readonly<Record<string, { min: number; max: number }>> = {
  crmLeadFinderMaxLeadsPerRun: { min: 1, max: 500 },
  crmLeadFinderPageSize: { min: 1, max: 50 },
  crmLeadFinderPagesPerTick: { min: 1, max: 50 },
  crmLeadFinderContactsPerCompany: { min: 0, max: 25 },
};
export const CRM_LEAD_FINDER_ENRICH_MODES = ['manual', 'auto'] as const;
/** A model id as providers spell them (`claude-sonnet-5`, `gpt-4o-mini`, `models/gemini-2.0`, `org/model:tag`). Empty = the provider's default. */
export const CRM_LEAD_FINDER_MODEL_MAX = 100;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
export const AI_MODEL_ID_MESSAGE_KEY = 'tenant_setting.errors.aiModelId';

/** Whether a scoring-model value is acceptable (pure): empty, or one model id without spaces, at most 100 characters. */
export function isValidAiModelId(value: string): boolean {
  const v = value.trim();
  return v === '' || (v.length <= CRM_LEAD_FINDER_MODEL_MAX && MODEL_ID_PATTERN.test(v));
}

// ── Webhook delivery settings (docs/phases/41-ui-fixes/12 4.1) ────────────────
// Saved unvalidated, they were clamped or dropped on read: 50 attempts ran as 10, a list with one typo fell back to the
// defaults whole, a negative rate limit read as no limit at all. The ranges are the reader's own (webhook.config.ts imports
// this table, so a save and a read cannot disagree):
//   webhookMaxAttempts                1..10      — attempts per delivery, the first one included.
//   webhookRequestTimeoutMs           1000..120000
//   webhookCircuitBreakerThreshold    1..100000  — consecutive failures before an endpoint is auto-disabled.
//   webhookDefaultRateLimitPerMinute  >= 0       — 0 (or empty) = no limit, the same as an endpoint without one.
//   webhookRetryDelaysMs              1 to 9 whole numbers of milliseconds, each 1000..86400000 (one day): the wait before
//                                     retry 1, 2, ...; a retry past the list waits the last value. Ten attempts make at most
//                                     nine waits, so a tenth value would never be read.
// An empty value is the field's default. Kept here, not imported: tenant_setting may not depend on webhook.
export const WEBHOOK_INTEGER_SETTINGS: Readonly<Record<string, { min: number; max?: number }>> = {
  webhookMaxAttempts: { min: 1, max: 10 },
  webhookRequestTimeoutMs: { min: 1_000, max: 120_000 },
  webhookCircuitBreakerThreshold: { min: 1, max: 100_000 },
  webhookDefaultRateLimitPerMinute: { min: 0 },
};
export const WEBHOOK_RETRY_DELAYS_KEY = 'webhookRetryDelaysMs';
export const WEBHOOK_RETRY_DELAY_RULE = { min: 1_000, max: 86_400_000, maxCount: 9 } as const;
/** `details.messageKey` of a refused delay list (vars: min, max, count). */
export const DELAY_LIST_MESSAGE_KEY = 'tenant_setting.errors.delayList';

/**
 * A retry-delay list (pure): `[]` for an empty value (the default), the delays in order, or null when any part is not a
 * whole number of milliseconds within the rule, or there are more than `maxCount` of them. One bad entry refuses the
 * whole list: dropping it would shift every later delay onto the wrong retry.
 */
export function parseDelayList(value: string, rule: { min: number; max: number; maxCount: number } = WEBHOOK_RETRY_DELAY_RULE): number[] | null {
  const v = value.trim();
  if (v === '') return [];
  const parts = v.split(',').map((p) => p.trim());
  if (parts.length > rule.maxCount) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isSafeInteger(n) || n < rule.min || n > rule.max) return null;
    out.push(n);
  }
  return out;
}

/** Whether `value` is empty (the default) or a whole number within `[min, max]` (pure). */
export function isIntegerInRange(value: string, min: number, max?: number): boolean {
  const v = value.trim();
  if (v === '') return true;
  if (!/^\d+$/.test(v)) return false;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && (max === undefined || n <= max);
}

/**
 * 04-tenant-setting 3.2: every per-key refusal names its key in `details.key`, so the settings scaffolds show the message under that field
 * (settings-panel-host `fieldErrors`) instead of only in a banner.
 */
function invalidValue(key: string, message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(message, 400, ErrorCode.VALIDATION_ERROR, { details: { ...details, key } });
}

// Per-key schema validation
// MS-01: commerce_shipping's tenant-set carrier endpoints (`yurticiApiUrl`, the generic `<prefix>ApiUrl`s). The carrier
// adapter refuses anything but a public https address when it calls out (carrier-endpoint.ts, SSRF guard); this refuses a
// plain http or credential-carrying URL when it is saved, so the admin sees the mistake at once. Written out, not imported:
// tenant_setting never imports the modules that require it.
const CARRIER_ENDPOINT_KEY_RE = /^(?:yurtici|aras|mng|ptt|surat|sendeo|hepsijet|dpd|gls|postnl)ApiUrl$/;

function isHttpsEndpoint(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' && u.username === '' && u.password === '' && u.hostname !== '';
  } catch {
    return false;
  }
}

export function validateSettingValue(key: string, value: string): void {
  if (isMaskPrefixedSecret(key, value)) {
    throw invalidValue(key, `The value of ${key} starts with the "stored secret" placeholder (${SECRET_MASK}). Clear the field and enter the new secret, or leave it unchanged to keep the stored one.`);
  }
  if (key === 'defaultTimezone' && !isValidIANATimezone(value)) {
    throw invalidValue(key, `Invalid IANA timezone: "${value}". Use a valid IANA timezone identifier (e.g. "Europe/Istanbul").`);
  }
  if ((key === 'currencyCode' || key === 'defaultCurrency') && !isValidISO4217(value)) {
    throw invalidValue(key, `Invalid ISO 4217 currency code: "${value}".`);
  }
  // accounting's journal entry number prefix (06-erp 14-accounting-ui-fixes 4.5): the hint promised the rule, nothing kept it.
  if (key === 'journalEntryPrefix' && value && !/^[A-Za-z0-9\-_/.]{1,12}$/.test(value)) {
    throw invalidValue(key, `Invalid journal entry prefix: "${value}". Use up to 12 letters, digits, "-", "_", "/" or ".".`);
  }
  if (key === 'defaultLanguage' && value && !isValidLangCode(value)) {
    throw invalidValue(key, `Invalid language code: "${value}". Use a BCP-47 code such as "en" or "pt-BR".`);
  }
  if (key === 'enabledLanguages' && value) {
    const codes = value.split(',').map((c) => c.trim()).filter(Boolean);
    const bad = codes.find((c) => !isValidLangCode(c));
    if (bad) {
      throw invalidValue(key, `Invalid language code in enabledLanguages: "${bad}". Use a comma-separated BCP-47 list (e.g. "en,tr,de").`);
    }
  }
  if (key === PRIVACY_CLOSED_REQUEST_RETENTION_KEY && !isValidClosedRequestRetention(value)) {
    const min = PRIVACY_CLOSED_REQUEST_MIN_RETENTION_DAYS;
    const max = PRIVACY_CLOSED_REQUEST_MAX_RETENTION_DAYS;
    throw invalidValue(
      key,
      `Anonymise closed requests after: enter 0 to keep them, or a whole number of days from ${min} to ${max}. A closed request is the evidence that a right was answered and must outlive the two-year window in which that answer can be challenged.`,
      { messageKey: PRIVACY_CLOSED_RETENTION_RANGE_MESSAGE_KEY, vars: { min, max } },
    );
  }
  if (key === 'twoFactorRequired' && !TWO_FACTOR_REQUIRED_VALUES.has(value)) {
    throw invalidValue(key, `Invalid value for twoFactorRequired: "${value}". Use "true" or "false".`);
  }
  if (key === LOCKOUT_MAX_ATTEMPTS_KEY && !isValidLockoutMaxAttempts(value)) {
    throw invalidValue(
      key,
      `Lock an account after: a whole number of failed sign-ins from ${LOCKOUT_MAX_ATTEMPTS_MIN} to ${LOCKOUT_MAX_ATTEMPTS_MAX}. The built-in limit is ${LOCKOUT_MAX_ATTEMPTS_MAX}; a value can only make the lockout stricter.`,
    );
  }
  if (CARRIER_ENDPOINT_KEY_RE.test(key) && value.trim() !== '' && !isHttpsEndpoint(value)) {
    throw invalidValue(
      key,
      `Invalid carrier endpoint in ${key}: use a public https URL without a user name or password (e.g. "https://api.example.com"). The shipping module refuses any other address when it calls the carrier.`,
    );
  }
  // storage (local disk): the directory is an absolute path with no `..` and not the filesystem root; the floor is a whole number of MB. Written out,
  // not imported (tenant_setting never imports the modules that require it); storage's parseLocalDir (storage.local.config.ts) refuses the same values when it reads them.
  if (key === 'storageLocalDir' && value.trim() !== '') {
    const raw = value.trim();
    if (!(process.platform === 'win32' ? /^(\/|[A-Za-z]:[\\/])/ : /^\//).test(raw) || raw.includes('\0') || raw.length > 512 || raw.split(/[\\/]+/).includes('..') || /^(\/|[A-Za-z]:[\\/]?)$/.test(raw)) {
      throw invalidValue(key, 'Local storage directory: enter an absolute path (e.g. "/var/lib/nb/storage") without "..", and not the filesystem root.');
    }
  }
  if (key === 'storageLocalMinFreeMb' && value.trim() !== '' && !/^\d{1,9}$/.test(value.trim())) {
    throw invalidValue(key, 'Free space to keep: enter a whole number of MB (0 switches the floor off).');
  }
  if (AI_FIREWALL_SWITCH_KEYS.has(key) && !AI_FIREWALL_SWITCH_VALUES.has(value)) {
    throw invalidValue(key, `Invalid value for ${key}: "${value}". Use "true" or "false".`);
  }
  if (key === 'aiFirewallDefaultMode' && !AI_FIREWALL_DEFAULT_MODE_VALUES.has(value)) {
    throw invalidValue(key, `Invalid value for aiFirewallDefaultMode: "${value}". Use "observe" or "suggest"; automatic runs are switched on one action at a time.`);
  }
  if (key.startsWith('aiFirewallMode:')) {
    if (!AI_FIREWALL_MODE_KEY_RE.test(key)) throw invalidValue(key, `Invalid action id in ${key}: use "aiFirewallMode:<module>.<action>".`);
    if (!AI_FIREWALL_ACTION_MODE_VALUES.has(value)) throw invalidValue(key, `Invalid mode for ${key}: "${value}". Use "observe", "suggest" or "auto".`);
  }
  const intRule = Object.hasOwn(DRIVE_INTEGER_SETTINGS, key) ? DRIVE_INTEGER_SETTINGS[key] : undefined;
  if (intRule && !isIntegerInRange(value, intRule.min, intRule.max)) {
    const { min, max } = intRule;
    throw max === undefined
      ? invalidValue(key, `${key}: enter a whole number of at least ${min}.`, { messageKey: INTEGER_MIN_MESSAGE_KEY, vars: { min } })
      : invalidValue(key, `${key}: enter a whole number from ${min} to ${max}.`, { messageKey: INTEGER_RANGE_MESSAGE_KEY, vars: { min, max } });
  }
  const leadFinderRule = Object.hasOwn(CRM_LEAD_FINDER_INTEGER_SETTINGS, key) ? CRM_LEAD_FINDER_INTEGER_SETTINGS[key] : undefined;
  if (leadFinderRule && !isIntegerInRange(value, leadFinderRule.min, leadFinderRule.max)) {
    const { min, max } = leadFinderRule;
    throw invalidValue(key, `${key}: enter a whole number from ${min} to ${max}.`, { messageKey: INTEGER_RANGE_MESSAGE_KEY, vars: { min, max } });
  }
  const webhookRule = Object.hasOwn(WEBHOOK_INTEGER_SETTINGS, key) ? WEBHOOK_INTEGER_SETTINGS[key] : undefined;
  if (webhookRule && !isIntegerInRange(value, webhookRule.min, webhookRule.max)) {
    const { min, max } = webhookRule;
    throw max === undefined
      ? invalidValue(key, `${key}: enter a whole number of at least ${min}.`, { messageKey: INTEGER_MIN_MESSAGE_KEY, vars: { min } })
      : invalidValue(key, `${key}: enter a whole number from ${min} to ${max}.`, { messageKey: INTEGER_RANGE_MESSAGE_KEY, vars: { min, max } });
  }
  if (key === WEBHOOK_RETRY_DELAYS_KEY && parseDelayList(value) === null) {
    const { min, max, maxCount: count } = WEBHOOK_RETRY_DELAY_RULE;
    throw invalidValue(
      key,
      `${key}: enter up to ${count} whole numbers of milliseconds separated by commas, each from ${min} to ${max}.`,
      { messageKey: DELAY_LIST_MESSAGE_KEY, vars: { min, max, count } },
    );
  }
  if (key === 'crmLeadFinderEnrichMode' && value.trim() !== '' && !(CRM_LEAD_FINDER_ENRICH_MODES as readonly string[]).includes(value.trim())) {
    const options = CRM_LEAD_FINDER_ENRICH_MODES.join(', ');
    throw invalidValue(key, `${key}: choose one of ${options}.`, { messageKey: ONE_OF_MESSAGE_KEY, vars: { options } });
  }
  if (key === 'crmLeadFinderClassifierModel' && !isValidAiModelId(value)) {
    const max = CRM_LEAD_FINDER_MODEL_MAX;
    throw invalidValue(
      key,
      `${key}: enter one model name without spaces, at most ${max} characters (e.g. "claude-sonnet-5"), or leave it blank for the provider's default.`,
      { messageKey: AI_MODEL_ID_MESSAGE_KEY, vars: { max } },
    );
  }
  if (key === 'driveDefaultShareRole' && value.trim() !== '' && !(DRIVE_SHARE_ROLE_OPTIONS as readonly string[]).includes(value.trim())) {
    const options = DRIVE_SHARE_ROLE_OPTIONS.join(', ');
    throw invalidValue(key, `${key}: choose one of ${options}.`, { messageKey: ONE_OF_MESSAGE_KEY, vars: { options } });
  }
  if (IP_LIST_KEYS.has(key)) {
    const bad = invalidSubnetEntries(value);
    if (bad.length > 0) {
      throw invalidValue(
        key,
        `Invalid IP list entries in ${key}: ${bad.map((b) => `"${b}"`).join(', ')}. Use IPv4 or IPv6 addresses or CIDR blocks (e.g. "10.0.0.0/8, 2001:db8::/32").`,
      );
    }
  }
}
