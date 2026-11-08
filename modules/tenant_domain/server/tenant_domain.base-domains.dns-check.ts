import crypto from 'node:crypto';
import { promises as dnsPromises } from 'node:dns';
import { challengeNameOf, delegatedTargetOf, type DnsChallengeConfig } from './tenant_domain.acme.dns-config';
import type { BaseDomainEntry } from './tenant_domain.base-domains';

/**
 * What a base domain must prove in DNS before the platform orders its wildcard or mints a tenant under it (phase 56, D350), checked
 * through the public resolvers, the way the authority and a browser will see it:
 *
 *  1. the challenge: `delegated` mode, `_acme-challenge.<base>` is a CNAME to `<base, dots as dashes>.<challenge domain>`; `zone` mode, the
 *     base sits inside the zone the DNS token writes (ACME_DNS_ZONE), so the TXT can be written at `_acme-challenge.<base>` directly;
 *  2. the wildcard: a random label under the base resolves, and only to the platform's addresses (PLATFORM_PUBLIC_ADDRESSES, else what the
 *     platform host in APPLICATION_HOST resolves to).
 *
 * Pure apart from its resolver (injectable); it changes nothing. The page prints `expected` so the operator can copy the records.
 */
export interface DnsResolver {
  resolveCname(name: string): Promise<string[]>;
  resolveAddresses(name: string): Promise<string[]>;
}

export const publicResolver: DnsResolver = {
  resolveCname: (name) => dnsPromises.resolveCname(name).catch(() => []),
  async resolveAddresses(name) {
    const [v4, v6] = await Promise.all([dnsPromises.resolve4(name).catch(() => [] as string[]), dnsPromises.resolve6(name).catch(() => [] as string[])]);
    return [...v4, ...v6];
  },
};

export interface DnsCheckPart { ok: boolean; expected: string; found: string[] }
export interface BaseDomainDnsCheck { ok: boolean; challenge: DnsCheckPart; wildcard: DnsCheckPart; problem: string | null }

/** The platform's public addresses: PLATFORM_PUBLIC_ADDRESSES (comma-separated), else the platform host's own A/AAAA records. */
export async function platformAddresses(resolver: DnsResolver = publicResolver, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const listed = (env.PLATFORM_PUBLIC_ADDRESSES ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (listed.length) return listed;
  let host = '';
  try { host = new URL(env.APPLICATION_HOST ?? '').hostname; } catch { /* no platform host */ }
  return host ? (await resolver.resolveAddresses(host)).map((a) => a.toLowerCase()) : [];
}

export async function checkBaseDomainDns(
  base: Pick<BaseDomainEntry, 'baseDomain' | 'challengeMode'>,
  config: DnsChallengeConfig | null,
  resolver: DnsResolver = publicResolver,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BaseDomainDnsCheck> {
  const name = base.baseDomain.toLowerCase();
  const strip = (v: string) => v.toLowerCase().replace(/\.$/, '');

  let challenge: DnsCheckPart;
  if (!config) {
    challenge = { ok: false, expected: 'ACME_DNS_PROVIDER, ACME_DNS_API_TOKEN and ACME_DNS_ZONE set on the platform', found: [] };
  } else if (base.challengeMode === 'zone') {
    const inside = name === config.zone || name.endsWith(`.${config.zone}`);
    challenge = { ok: inside, expected: `${challengeNameOf(name)} inside the DNS zone ${config.zone}`, found: inside ? [config.zone] : [] };
  } else {
    const expected = delegatedTargetOf(name, config);
    const found = (await resolver.resolveCname(challengeNameOf(name))).map(strip);
    challenge = { ok: found.includes(expected), expected: `${challengeNameOf(name)} CNAME ${expected}`, found };
  }

  const probe = `nb-check-${crypto.randomBytes(5).toString('hex')}.${name}`;
  const [found, platform] = await Promise.all([resolver.resolveAddresses(probe).then((a) => a.map((x) => x.toLowerCase())), platformAddresses(resolver, env)]);
  const wildcardOk = found.length > 0 && platform.length > 0 && found.every((a) => platform.includes(a));
  const wildcard: DnsCheckPart = { ok: wildcardOk, expected: `*.${name} A/AAAA ${platform.join(', ') || '(the platform\'s addresses)'}`, found };

  const problem = !challenge.ok
    ? (config ? `The challenge record is missing or wrong: expected ${challenge.expected}` : 'The platform has no DNS provider configured for wildcard certificates')
    : !wildcard.ok ? `The wildcard record does not point at the platform: expected ${wildcard.expected}` : null;
  return { ok: challenge.ok && wildcard.ok, challenge, wildcard, problem };
}
