import { z } from 'zod';
import { coreFields } from './env.schema.core';
import { providerFields } from './env.schema.providers';
import { platformFields } from './env.schema.platform';

/**
 * 38-security 5.3: why a production secret is unacceptable, or null. Length (32+), placeholder shapes and a single repeated character
 * are refused; the value itself is never put in the message (the boot error redacts secret keys anyway).
 */
export function weakSecretReason(value: string): string | null {
  if (value.length < 32) return 'must be at least 32 characters in production';
  if (/^(.)\1+$/.test(value)) return 'must not be one repeated character';
  if (/^(change[-_ ]?me|changeit|secret|password|placeholder|your[-_ ]|example|test[-_]|dev[-_]|xxx|todo|<.*>$|\$\{)/i.test(value)) return 'looks like a placeholder';
  return null;
}

/** Production (or Vercel) at runtime; `next build` collects pages with production NODE_ENV and no real secrets, so it is exempt. */
function strictRuntime(nodeEnv: string): boolean {
  return (nodeEnv === 'production' || nodeEnv === 'vercel') && process.env.NEXT_PHASE !== 'phase-production-build';
}

export const EnvSchema = z.object({
  ...coreFields,
  ...providerFields,
  ...platformFields,
}).superRefine((data, ctx) => {
  // 38-security 5.3: a production boot with a weak or missing security-critical value refuses to start (a control that silently
  // degrades is not a control): token secrets of real length, pairwise distinct; the field-encryption key present; metrics authenticated.
  if (strictRuntime(data.NODE_ENV)) {
    const secrets = [['ACCESS_TOKEN_SECRET', data.ACCESS_TOKEN_SECRET], ['REFRESH_TOKEN_SECRET', data.REFRESH_TOKEN_SECRET], ['CSRF_SECRET', data.CSRF_SECRET]] as const;
    for (const [name, value] of secrets) {
      const why = weakSecretReason(value);
      if (why) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `${name} ${why}` });
    }
    for (let i = 0; i < secrets.length; i++) {
      for (let j = i + 1; j < secrets.length; j++) {
        if (secrets[i][1] === secrets[j][1]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [secrets[j][0]], message: `${secrets[j][0]} must differ from ${secrets[i][0]}` });
        }
      }
    }
    if (data.CRON_SECRET) {
      const why = weakSecretReason(data.CRON_SECRET);
      if (why) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CRON_SECRET'], message: `CRON_SECRET ${why}` });
    }
    // Every limiter, the auth scope included, would allow everything: a developer convenience, never a production setting.
    if (data.RATE_LIMIT_DISABLED) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RATE_LIMIT_DISABLED'], message: 'RATE_LIMIT_DISABLED must not be enabled in production' });
    }
    if (!data.SETTINGS_ENCRYPTION_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SETTINGS_ENCRYPTION_KEY'], message: 'SETTINGS_ENCRYPTION_KEY is required in production (without it tenant secrets are stored in plaintext)' });
    }
    if (data.METRICS_ENABLED && !data.METRICS_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['METRICS_SECRET'], message: 'METRICS_SECRET is required in production when METRICS_ENABLED=true' });
    }
  }
  // The map's tile source is one setting: a URL needs its attribution (OpenStreetMap's licence and most providers' terms ask
  // for it), and the other parts mean nothing without a URL.
  if (data.MAP_TILES_URL && !data.MAP_TILES_ATTRIBUTION) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MAP_TILES_ATTRIBUTION'], message: 'MAP_TILES_ATTRIBUTION is required when MAP_TILES_URL is set (the tile provider\'s credit shown on the map)' });
  }
  for (const key of ['MAP_TILES_ATTRIBUTION', 'MAP_TILES_SUBDOMAINS', 'MAP_TILES_MAX_ZOOM', 'MAP_TILES_DARK_URL'] as const) {
    if (data[key] !== undefined && !data.MAP_TILES_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} needs MAP_TILES_URL` });
    }
  }
  // Conditional required vars per mail provider
  if (data.MAIL_PROVIDER === 'smtp' && !data.SMTP_HOST) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_HOST'], message: 'SMTP_HOST is required when MAIL_PROVIDER=smtp' });
  }
  if (data.MAIL_PROVIDER === 'mailgun' && !data.MAILGUN_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MAILGUN_API_KEY'], message: 'MAILGUN_API_KEY is required when MAIL_PROVIDER=mailgun' });
  }
  if (data.MAIL_PROVIDER === 'postmark' && !data.POSTMARK_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['POSTMARK_API_KEY'], message: 'POSTMARK_API_KEY is required when MAIL_PROVIDER=postmark' });
  }
  if (data.MAIL_PROVIDER === 'sendgrid' && !data.SENDGRID_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SENDGRID_API_KEY'], message: 'SENDGRID_API_KEY is required when MAIL_PROVIDER=sendgrid' });
  }
  if (data.MAIL_PROVIDER === 'resend' && !data.RESEND_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required when MAIL_PROVIDER=resend' });
  }
  // A sealed audit chain (node and fleet roles) derives its actor references from this key: without it every audit row would be refused.
  if ((data.FLEET_ROLE === 'node' || data.FLEET_ROLE === 'fleet') && !data.SETTINGS_ENCRYPTION_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SETTINGS_ENCRYPTION_KEY'], message: 'SETTINGS_ENCRYPTION_KEY is required when FLEET_ROLE is node or fleet' });
  }
  // The demo-reset cron drops the whole schema: a fleet node or the fleet instance must never be able to arm it (P9-9). BUILD_ROLE counts too,
  // so an image baked for a fleet role refuses DEMO_MODE even when FLEET_ROLE is unset or wrong (boot would refuse that mismatch anyway).
  if (data.DEMO_MODE && [data.FLEET_ROLE, data.BUILD_ROLE].some((role) => role === 'node' || role === 'fleet')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEMO_MODE'], message: 'DEMO_MODE must not be enabled when FLEET_ROLE or BUILD_ROLE is node or fleet' });
  }
  // The Fleet ID hub binds passkeys to its own host, id.<domain> (12-fleet-identity.md section 4.4; FID-08): auth_passkey derives the RP id and
  // origin from FLEET_ID_ISSUER there, so an explicit WEBAUTHN_RP_ID or WEBAUTHN_ORIGIN naming anything else (a parent domain every node could
  // use, another host) is refused at boot rather than silently overridden.
  if (data.FLEET_ROLE === 'fleet' && data.FLEET_ID_ISSUER) {
    const hub = httpsUrl(data.FLEET_ID_ISSUER);
    if (hub && data.WEBAUTHN_RP_ID && data.WEBAUTHN_RP_ID !== hub.hostname) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBAUTHN_RP_ID'], message: `WEBAUTHN_RP_ID must be the Fleet ID issuer's host (${hub.hostname}) or unset when FLEET_ROLE=fleet` });
    }
    if (hub && data.WEBAUTHN_ORIGIN && httpsUrl(data.WEBAUTHN_ORIGIN)?.origin !== hub.origin) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBAUTHN_ORIGIN'], message: `WEBAUTHN_ORIGIN must be the Fleet ID issuer's origin (${hub.origin}) or unset when FLEET_ROLE=fleet` });
    }
    // A web origin in the extra list would be accepted by the server for the hub's RP id; only native Android origins (and the hub itself) may be.
    const strayExtra = (data.WEBAUTHN_EXTRA_ORIGINS ?? '').split(',').map((v) => v.trim()).filter(Boolean)
      .filter((o) => !o.startsWith('android:apk-key-hash:') && httpsUrl(o)?.origin !== hub?.origin);
    if (hub && strayExtra.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBAUTHN_EXTRA_ORIGINS'], message: `WEBAUTHN_EXTRA_ORIGINS may hold only android:apk-key-hash: origins or ${hub.origin} when FLEET_ROLE=fleet (refused: ${strayExtra.join(', ')})` });
    }
  }
  if (data.TENANT_KEY_PROVIDER === 'file' && (!data.TENANT_KEYSTORE_DIR || !data.TENANT_KEYSTORE_KEK_FILE)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TENANT_KEYSTORE_DIR'], message: 'TENANT_KEY_PROVIDER=file needs TENANT_KEYSTORE_DIR and TENANT_KEYSTORE_KEK_FILE' });
  }
  // Telemetry: a store that is switched on must say where it is, and the log export must say where it sends.
  if (data.TELEMETRY_BACKEND === 'reference' && !data.TELEMETRY_LOKI_URL && !data.TELEMETRY_TEMPO_URL && !data.TELEMETRY_PROMETHEUS_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TELEMETRY_BACKEND'], message: 'TELEMETRY_BACKEND=reference needs at least one of TELEMETRY_LOKI_URL, TELEMETRY_TEMPO_URL, TELEMETRY_PROMETHEUS_URL' });
  }
  if (data.TELEMETRY_LOG_EXPORT && !data.TELEMETRY_LOG_EXPORT_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TELEMETRY_LOG_EXPORT_URL'], message: 'TELEMETRY_LOG_EXPORT_URL is required when TELEMETRY_LOG_EXPORT=true' });
  }
  if (!data.TELEMETRY_GATEWAY_TLS_CERT_FILE !== !data.TELEMETRY_GATEWAY_TLS_KEY_FILE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TELEMETRY_GATEWAY_TLS_KEY_FILE'], message: 'TELEMETRY_GATEWAY_TLS_CERT_FILE and TELEMETRY_GATEWAY_TLS_KEY_FILE must be set together' });
  }
  if (data.SECRETS_MANAGER_PROVIDER === 'vault' && !data.VAULT_ADDR) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['VAULT_ADDR'], message: 'VAULT_ADDR is required when SECRETS_MANAGER_PROVIDER=vault' });
  }
});

export type Env = z.infer<typeof EnvSchema>;

function httpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname ? u : null;
  } catch {
    return null;
  }
}
