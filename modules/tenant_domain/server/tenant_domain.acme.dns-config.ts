/**
 * How the platform answers DNS-01 for its managed base domains' wildcard certificates (phase 56, D342). Read from the environment on every
 * call, like `tenant_domain.acme.config`: the token is an operator secret of the installation, never a tenant's, so it is not a setting
 * (no settings dump, export or backup can carry it). INERT until all of it is set: no base domain is ordered for, and every host keeps
 * the per-name certificates of phase 51.
 *
 *   ACME_DNS_PROVIDER          `hetzner` (the Hetzner Cloud API, api.hetzner.cloud/v1; the legacy dns.hetzner.com API closed in May 2026)
 *   ACME_DNS_API_TOKEN         a Hetzner Cloud project token; give it a project that holds the challenge zone only (least privilege)
 *   ACME_DNS_ZONE              the Hetzner zone the challenge records are written in, e.g. `hermetry-acme.com` (a registrable domain:
 *                              Hetzner zones cannot be subdomains)
 *   ACME_DNS_CHALLENGE_DOMAIN  optional, default ACME_DNS_ZONE: the name the CNAMEs point under, inside that zone (e.g. `_acme.hermetry.com`
 *                              with ACME_DNS_ZONE=hermetry.com). Each base publishes `_acme-challenge.<base> CNAME <base, dots as dashes>.<this>`
 */
export interface DnsChallengeConfig {
  provider: 'hetzner';
  apiToken: string;
  zone: string;
  challengeDomain: string;
}

const NAME = /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)+$/;
const clean = (v: string | undefined) => (v ?? '').trim().toLowerCase().replace(/\.$/, '');

export function dnsChallengeConfig(env: NodeJS.ProcessEnv = process.env): DnsChallengeConfig | null {
  if (clean(env.ACME_DNS_PROVIDER) !== 'hetzner') return null;
  const apiToken = (env.ACME_DNS_API_TOKEN ?? '').trim();
  const zone = clean(env.ACME_DNS_ZONE);
  const challengeDomain = clean(env.ACME_DNS_CHALLENGE_DOMAIN) || zone;
  if (!apiToken || !NAME.test(zone) || !NAME.test(challengeDomain)) return null;
  // The CNAME targets must live inside the zone the token writes.
  if (challengeDomain !== zone && !challengeDomain.endsWith(`.${zone}`)) return null;
  return { provider: 'hetzner', apiToken, zone, challengeDomain };
}

/** `_acme-challenge.<base>`: where the authority looks for a base domain's TXT records (RFC 8555 §8.4). */
export function challengeNameOf(baseDomain: string): string {
  return `_acme-challenge.${baseDomain.toLowerCase()}`;
}

/** The delegated target of a base domain's challenge: `<base with dots as dashes>.<challenge domain>` (`dev.roltek.xyz` → `dev-roltek-xyz.<cd>`). */
export function delegatedTargetOf(baseDomain: string, config: Pick<DnsChallengeConfig, 'challengeDomain'>): string {
  return `${baseDomain.toLowerCase().replace(/\./g, '-')}.${config.challengeDomain}`;
}
