import { clampRenewBeforeDays, DEFAULT_RENEW_BEFORE_DAYS } from './tenant_domain.certificates.policy';

/**
 * Where and how the platform orders its own certificates (phase 51). Read from the environment on every call (tests and a restart-free
 * operator change both work). The feature is INERT until `ACME_DIRECTORY_URL` is set: nothing orders, the sweep only logs once.
 *
 *   ACME_DIRECTORY_URL            e.g. https://acme-staging-v02.api.letsencrypt.org/directory (staging first), then the production directory
 *   ACME_CONTACT_EMAIL            optional mailto contact the authority writes to about expiry and problems
 *   ACME_RENEW_BEFORE_DAYS        default 3 (owner, 2026-10-31), clamped to 1-30
 */
export interface AcmeConfig {
  directoryUrl: string;
  contactEmail: string | null;
  renewBeforeDays: number;
}

export function acmeConfig(env: NodeJS.ProcessEnv = process.env): AcmeConfig | null {
  const directoryUrl = (env.ACME_DIRECTORY_URL ?? '').trim();
  if (!directoryUrl) return null;
  let url: URL;
  try { url = new URL(directoryUrl); } catch { return null; }
  // A plain-http directory is only for a local test CA; a real authority is https.
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  const email = (env.ACME_CONTACT_EMAIL ?? '').trim();
  return {
    directoryUrl: url.toString(),
    contactEmail: /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) ? email : null,
    renewBeforeDays: env.ACME_RENEW_BEFORE_DAYS ? clampRenewBeforeDays(env.ACME_RENEW_BEFORE_DAYS) : DEFAULT_RENEW_BEFORE_DAYS,
  };
}
