import Logger from '@kuraykaraaslan-labs/logger';
import { AcmeClient, AcmeError, type ChallengeSolver, type IssuedCertificate } from './tenant_domain.acme.client';
import { acmeConfig, type AcmeConfig } from './tenant_domain.acme.config';
import { dnsChallengeConfig, challengeNameOf, delegatedTargetOf, type DnsChallengeConfig } from './tenant_domain.acme.dns-config';
import { loadOrCreateAccountKeyPem } from './tenant_domain.acme.account';
import { HetznerDnsWriter } from './tenant_domain.dns-provider.hetzner';
import { dns01Solver } from './tenant_domain.dns01.solver';
import { certificateAction, ownCertificate, sanitizeOrderError } from './tenant_domain.certificates.policy';
import { baseDomainList, invalidateBaseDomains, updateBaseDomainRow, type BaseDomainEntry } from './tenant_domain.base-domains';
import { checkBaseDomainDns, type BaseDomainDnsCheck } from './tenant_domain.base-domains.dns-check';
import {
  findBaseCertificate, recordBaseOrderFailure, saveBaseCertificate, wildcardNamesOf, type BaseRef,
} from './tenant_domain.base-certificates.service';
import type { TenantDomainBaseDomainCertificate } from './entities/tenant_domain_base_domain_certificate.entity';
import type { OrderFailure } from './tenant_domain.certificates.service';

/**
 * One wildcard order for one managed base domain (phase 56, D342, D343, D350): the body of the queue's `issue-base` job. It decides again at
 * run time, like phase 51's per-name order:
 *
 *   not configured (no ACME directory, or no DNS provider) → skipped
 *   no such base, or DISABLED                               → skipped
 *   PENDING_DNS and the DNS check fails                     → skipped, the problem written on the base row for its page
 *   a good wildcard with time to spare, or inside a back-off → skipped
 *   otherwise → order `<base>` + `*.<base>` by DNS-01; on success store it and, for a PENDING_DNS base, make the base ACTIVE (its DNS was
 *   proven and the authority has just validated the challenge); on failure record the back-off and, with a certificate about to expire,
 *   alert the platform log and the root tenant's admins.
 *
 * Never throws for an order failure.
 */
export interface BaseOrderRequest { baseDomainId: string; force?: boolean }

export type BaseOrderOutcome =
  | { status: 'issued'; notAfter: Date }
  | { status: 'skipped'; reason: 'not_configured' | 'not_found' | 'disabled' | 'dns_not_ready' | 'fresh' | 'backoff' }
  | { status: 'failed'; error: string; retryAt: Date };

const DAY_MS = 86_400_000;
export const BASE_ALERT_WITHIN_MS = DAY_MS;

export interface BaseOrderDeps {
  now(): Date;
  config(): AcmeConfig | null;
  dnsConfig(): DnsChallengeConfig | null;
  base(baseDomainId: string): Promise<BaseDomainEntry | null>;
  checkDns(base: BaseDomainEntry, dns: DnsChallengeConfig): Promise<BaseDomainDnsCheck>;
  findCertificate(baseDomainId: string): Promise<TenantDomainBaseDomainCertificate | null>;
  newClient(config: AcmeConfig): Promise<Pick<AcmeClient, 'orderNames'>>;
  solver(base: BaseDomainEntry, dns: DnsChallengeConfig): ChallengeSolver;
  save(ref: BaseRef, issued: IssuedCertificate, renewBeforeDays: number, directoryUrl: string | null): Promise<void>;
  fail(ref: BaseRef, failure: OrderFailure, now: Date, directoryUrl: string | null): Promise<{ attempts: number; retryAt: Date }>;
  markBase(baseDomainId: string, fields: { status?: 'ACTIVE'; dnsCheckedAt: Date; lastDnsError: string | null }): Promise<void>;
  notifyExpiring(ref: BaseRef, notAfter: Date, daysRemaining: number): Promise<void>;
}

/** Where a base's challenge TXT values are written: the delegated target, or `_acme-challenge.<base>` in zone mode. */
export function challengeRecordName(base: Pick<BaseDomainEntry, 'baseDomain' | 'challengeMode'>, dns: DnsChallengeConfig): string {
  return base.challengeMode === 'zone' ? challengeNameOf(base.baseDomain) : delegatedTargetOf(base.baseDomain, dns);
}

const defaults: BaseOrderDeps = {
  now: () => new Date(),
  config: () => acmeConfig(),
  dnsConfig: () => dnsChallengeConfig(),
  async base(baseDomainId) {
    invalidateBaseDomains();
    return (await baseDomainList()).find((b) => b.baseDomainId === baseDomainId) ?? null;
  },
  checkDns: (base, dns) => checkBaseDomainDns(base, dns),
  findCertificate: findBaseCertificate,
  async newClient(config) {
    const accountKeyPem = await loadOrCreateAccountKeyPem(config.directoryUrl, config.contactEmail);
    return new AcmeClient({ directoryUrl: config.directoryUrl, accountKeyPem, contactEmail: config.contactEmail ?? undefined });
  },
  solver(base, dns) {
    const writer = new HetznerDnsWriter({ apiToken: dns.apiToken, zone: dns.zone });
    return dns01Solver({ writer, recordName: challengeRecordName(base, dns) });
  },
  save: saveBaseCertificate,
  fail: recordBaseOrderFailure,
  markBase: (id, fields) => updateBaseDomainRow(id, fields),
  async notifyExpiring(ref, notAfter, daysRemaining) {
    const { default: Notifications } = await import('./tenant_domain.notifications.service');
    await Notifications.notifyPlatformCertificateExpiring({ ...ref, expiresAt: notAfter, daysRemaining });
  },
};

export async function processBaseOrder(req: BaseOrderRequest, deps: BaseOrderDeps = defaults): Promise<BaseOrderOutcome> {
  const config = deps.config();
  const dns = deps.dnsConfig();
  if (!config || !dns) return { status: 'skipped', reason: 'not_configured' };
  const base = await deps.base(req.baseDomainId);
  if (!base?.baseDomainId) return { status: 'skipped', reason: 'not_found' };
  if (base.status === 'DISABLED') return { status: 'skipped', reason: 'disabled' };
  const ref: BaseRef = { baseDomainId: base.baseDomainId, baseDomain: base.baseDomain };
  const now = deps.now();

  if (base.status === 'PENDING_DNS') {
    const check = await deps.checkDns(base, dns);
    if (!check.ok) {
      await deps.markBase(base.baseDomainId, { dnsCheckedAt: now, lastDnsError: (check.problem ?? 'DNS is not ready').slice(0, 500) }).catch(() => undefined);
      return { status: 'skipped', reason: 'dns_not_ready' };
    }
  }

  const held = ownCertificate(await deps.findCertificate(base.baseDomainId), base.baseDomain, config.directoryUrl);
  const action = certificateAction(held, now, req.force);
  if (action === 'none') return { status: 'skipped', reason: 'fresh' };
  if (action === 'wait') return { status: 'skipped', reason: 'backoff' };

  try {
    const client = await deps.newClient(config);
    const issued = await client.orderNames(wildcardNamesOf(base.baseDomain), deps.solver(base, dns));
    await deps.save(ref, issued, config.renewBeforeDays, config.directoryUrl);
    if (base.status === 'PENDING_DNS') {
      await deps.markBase(base.baseDomainId, { status: 'ACTIVE', dnsCheckedAt: now, lastDnsError: null })
        .catch((e) => Logger.warn(`[certificates] ${JSON.stringify(base.baseDomain)} holds its wildcard but could not be made ACTIVE: ${e instanceof Error ? e.message : 'unknown'}`));
    }
    Logger.info(`[certificates] ${action === 'renew' ? 'renewed' : 'issued'} the wildcard of ${JSON.stringify(base.baseDomain)} until ${issued.notAfter.toISOString()}`);
    return { status: 'issued', notAfter: issued.notAfter };
  } catch (err) {
    const failure: OrderFailure = err instanceof AcmeError
      ? { message: err.message, rateLimited: err.rateLimited, retryAfterMs: err.retryAfterMs }
      : { message: err instanceof Error ? err.message : 'unknown error' };
    const { retryAt } = await deps.fail(ref, failure, now, config.directoryUrl);
    const safe = sanitizeOrderError(failure.message).slice(0, 300);
    Logger.warn(`[certificates] wildcard order for ${JSON.stringify(base.baseDomain)} failed: ${safe}`);
    const left = held?.notAfter ? held.notAfter.getTime() - now.getTime() : null;
    if (left !== null && left <= BASE_ALERT_WITHIN_MS) {
      Logger.error(`[certificates] ALERT the wildcard of ${JSON.stringify(base.baseDomain)} expires in ${Math.max(0, Math.ceil(left / 3_600_000))} h and its renewal keeps failing`);
      await deps.notifyExpiring(ref, held!.notAfter!, Math.max(0, Math.ceil(left / DAY_MS))).catch(() => undefined);
    }
    return { status: 'failed', error: safe, retryAt };
  }
}

/**
 * The base-domain half of the twice-daily sweep: every base that is not DISABLED and whose wildcard is missing, expired or due (and not in a
 * back-off) goes on the queue; a PENDING_DNS base always does (its order checks DNS first and orders nothing until both records are right).
 */
export interface BaseSweepDeps {
  now(): Date;
  configured(): boolean;
  directoryUrl(): string | null;
  bases(): Promise<BaseDomainEntry[]>;
  findCertificate(baseDomainId: string): Promise<TenantDomainBaseDomainCertificate | null>;
  enqueue(baseDomainId: string): Promise<void>;
}

const sweepDefaults: BaseSweepDeps = {
  now: () => new Date(),
  configured: () => !!acmeConfig() && !!dnsChallengeConfig(),
  directoryUrl: () => acmeConfig()?.directoryUrl ?? null,
  bases: async () => { invalidateBaseDomains(); return baseDomainList(); },
  findCertificate: findBaseCertificate,
  async enqueue(id) {
    const { enqueueBaseIssue } = await import('./tenant_domain.certificates.job');
    await enqueueBaseIssue(id);
  },
};

export async function sweepBaseCertificates(deps: BaseSweepDeps = sweepDefaults): Promise<{ considered: number; enqueued: number; fresh: number }> {
  const result = { considered: 0, enqueued: 0, fresh: 0 };
  if (!deps.configured()) return result;
  const now = deps.now();
  for (const base of await deps.bases()) {
    if (!base.baseDomainId || base.status === 'DISABLED') continue;
    result.considered++;
    const action = base.status === 'PENDING_DNS'
      ? 'issue'
      : certificateAction(ownCertificate(await deps.findCertificate(base.baseDomainId), base.baseDomain, deps.directoryUrl()), now);
    if (action === 'issue' || action === 'renew') {
      await deps.enqueue(base.baseDomainId).catch((e) => Logger.warn(`[certificates] could not queue the wildcard of ${JSON.stringify(base.baseDomain)}: ${e instanceof Error ? e.message : 'unknown'}`));
      result.enqueued++;
    } else if (action === 'none') result.fresh++;
  }
  return result;
}
