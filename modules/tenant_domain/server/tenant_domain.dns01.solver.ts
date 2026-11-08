import { promises as dnsPromises } from 'node:dns';
import type { ChallengeSolver, PendingChallenge } from './tenant_domain.acme.client';
import { dns01Value } from './tenant_domain.acme.client';
import type { DnsChallengeWriter } from './tenant_domain.dns-provider.hetzner';

/**
 * The DNS-01 solver of a base domain's wildcard order (phase 56, D342). Every challenge of the order (`<base>` and `*.<base>`) is answered at
 * one name: the delegated target in the platform's challenge zone (`_acme-challenge.<base>` is a CNAME to it), or `_acme-challenge.<base>`
 * itself in `zone` mode. Before the authority is told, the record must be visible at every authoritative server of the zone (the
 * authority asks those, not a cache); at most `visibleTimeoutMs`, polled every `pollMs`.
 */
export interface TxtResolver { resolveTxt(name: string, servers: string[]): Promise<string[]> }

/** Asks the given authoritative servers directly (their addresses resolved first): what the authority's validation will see. */
export const authoritativeTxt: TxtResolver = {
  async resolveTxt(name, servers) {
    const addresses = (await Promise.all(servers.map(async (s) => {
      const [v4, v6] = await Promise.all([dnsPromises.resolve4(s).catch(() => [] as string[]), dnsPromises.resolve6(s).catch(() => [] as string[])]);
      return [...v4, ...v6];
    }))).flat();
    if (!addresses.length) return [];
    const r = new dnsPromises.Resolver({ timeout: 3_000, tries: 1 });
    r.setServers(addresses);
    try { return (await r.resolveTxt(name)).map((chunks) => chunks.join('')); } catch { return []; }
  },
};

export interface Dns01SolverOptions {
  writer: DnsChallengeWriter;
  /** Where the TXT values are written: the delegated target, or `_acme-challenge.<base>` in zone mode. */
  recordName: string;
  resolver?: TxtResolver;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  visibleTimeoutMs?: number;
}

export function dns01Solver(opts: Dns01SolverOptions): ChallengeSolver {
  const resolver = opts.resolver ?? authoritativeTxt;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 5_000;
  const timeoutMs = opts.visibleTimeoutMs ?? 120_000;
  return {
    type: 'dns-01',
    present: (c: PendingChallenge) => opts.writer.add(opts.recordName, dns01Value(c.keyAuthorization)),
    async ready(all: PendingChallenge[]) {
      const want = all.map((c) => dns01Value(c.keyAuthorization));
      const servers = await opts.writer.nameservers();
      if (!servers.length) return; // nothing to ask: the authority's own retries decide
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const seen = await Promise.all(servers.map((s) => resolver.resolveTxt(opts.recordName, [s])));
        if (seen.every((values) => want.every((w) => values.includes(w)))) return;
        if (Date.now() >= deadline) throw new Error(`the challenge record ${opts.recordName} did not become visible at ${servers.join(', ')} in time`);
        await sleep(pollMs);
      }
    },
    cleanup: (c: PendingChallenge) => opts.writer.remove(opts.recordName, dns01Value(c.keyAuthorization)),
  };
}
