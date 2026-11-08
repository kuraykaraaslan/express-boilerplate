import { withTenantRepositoryFor, withSystemRLS } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { TenantDomain } from './entities/tenant_domain.entity';
import { TenantDomainCertificate } from './entities/tenant_domain_certificate.entity';
import { AcmeClient, AcmeError, type ChallengeStore, type IssuedCertificate } from './tenant_domain.acme.client';
import { acmeConfig, type AcmeConfig } from './tenant_domain.acme.config';
import { loadOrCreateAccountKeyPem } from './tenant_domain.acme.account';
import { redisChallengeStore } from './tenant_domain.acme.challenge';
import { certificateAction, ownCertificate, sanitizeOrderError } from './tenant_domain.certificates.policy';
import { eligibleDomainRow, saveIssuedCertificate, recordOrderFailure, type DomainRef, type OrderFailure } from './tenant_domain.certificates.service';

/**
 * One certificate order for one domain (phase 51.3), the body of the queue's `issue` job. It decides again at run time, under the
 * queue's pace and per-domain job id, so a request that arrives late, twice, or for a domain that stopped being servable orders nothing:
 *
 *   not configured  → skipped (the feature is inert until ACME_DIRECTORY_URL is set)
 *   not servable    → skipped (the domain left, was suspended, or another tenant proved the name)
 *   good certificate with time to spare, or inside a back-off → skipped
 *   otherwise       → order; on success store the certificate, on failure record the back-off and, with a certificate about to expire,
 *                     tell the tenant's admins and the platform log
 *
 * It never throws for an order failure (the retry schedule is in the database, not in BullMQ's attempts).
 */
export interface OrderRequest { tenantId: string; tenantDomainId: string; domain: string; force?: boolean }

export type OrderOutcome =
  | { status: 'issued'; notAfter: Date }
  | { status: 'skipped'; reason: 'not_configured' | 'not_eligible' | 'fresh' | 'backoff' | 'covered' }
  | { status: 'failed'; error: string; retryAt: Date };

const DAY_MS = 86_400_000;
/** A certificate this close to expiry with a failing renewal is an alert, not a log line. */
export const ALERT_WITHIN_MS = DAY_MS;

export interface OrderDeps {
  now(): Date;
  config(): AcmeConfig | null;
  eligible(host: string): Promise<TenantDomain | null>;
  findCertificate(ref: DomainRef): Promise<TenantDomainCertificate | null>;
  newClient(config: AcmeConfig): Promise<Pick<AcmeClient, 'order'>>;
  store: ChallengeStore;
  save(ref: DomainRef, issued: IssuedCertificate, renewBeforeDays: number, directoryUrl: string | null): Promise<void>;
  fail(ref: DomainRef, failure: OrderFailure, now: Date, directoryUrl: string | null): Promise<{ attempts: number; retryAt: Date }>;
  setSslStatus(ref: DomainRef, status: 'PENDING' | 'FAILED'): Promise<void>;
  notifyExpiring(ref: DomainRef, notAfter: Date, daysRemaining: number): Promise<void>;
  afterIssue(ref: DomainRef): Promise<void>;
  /** Phase 56 (D348): the host is served by its base's held wildcard, so it is not ordered for. Absent = never covered. */
  covered?(host: string): Promise<boolean>;
}

const defaults: OrderDeps = {
  now: () => new Date(),
  config: () => acmeConfig(),
  eligible: eligibleDomainRow,
  findCertificate: (ref) => withSystemRLS((qr) => qr.manager.getRepository(TenantDomainCertificate).findOne({ where: { tenantDomainId: ref.tenantDomainId } })),
  async newClient(config) {
    const accountKeyPem = await loadOrCreateAccountKeyPem(config.directoryUrl, config.contactEmail);
    return new AcmeClient({ directoryUrl: config.directoryUrl, accountKeyPem, contactEmail: config.contactEmail ?? undefined });
  },
  store: redisChallengeStore,
  async covered(host) {
    const { heldWildcards, wildcardServing } = await import('./tenant_domain.base-certificates.service');
    return wildcardServing(host, await heldWildcards()) !== null;
  },
  save: saveIssuedCertificate,
  fail: recordOrderFailure,
  async setSslStatus(ref, status) {
    // What the domain page shows while an order runs or after one failed. Only from a state that says nothing better: ACTIVE / EXPIRING
    // come from a real handshake (the probe) and are never overwritten by an order's result.
    const from = status === 'PENDING' ? ['DISABLED', 'FAILED'] : ['DISABLED', 'PENDING'];
    await withTenantRepositoryFor(ref.tenantId, TenantDomain, async (repo) => {
      for (const sslStatus of from) await repo.update({ tenantDomainId: ref.tenantDomainId, tenantId: ref.tenantId, sslStatus }, { sslStatus: status });
    });
  },
  async notifyExpiring(ref, notAfter, daysRemaining) {
    const { default: Notifications } = await import('./tenant_domain.notifications.service');
    await Notifications.notifySslExpiring({ ...ref, expiresAt: notAfter, daysRemaining, renewalFailing: true });
  },
  async afterIssue(ref) {
    await defaults.setSslStatus(ref, 'PENDING');
    // The handshake probe settles the page's status from what the world sees. Caddy asks for the new certificate on its next handshake
    // (this process caches for up to a minute), so the probe waits a little longer than that.
    const { enqueueProbe } = await import('./tenant_domain.certificates.job');
    await enqueueProbe(ref, 90_000);
  },
};

export async function processOrder(req: OrderRequest, deps: OrderDeps = defaults): Promise<OrderOutcome> {
  const config = deps.config();
  if (!config) return { status: 'skipped', reason: 'not_configured' };

  const domain = req.domain.trim().toLowerCase();
  const row = await deps.eligible(domain);
  // The proven row of a name decides: another workspace may hold an unproven claim to the same host.
  if (!row || row.tenantDomainId !== req.tenantDomainId || row.tenantId !== req.tenantId) return { status: 'skipped', reason: 'not_eligible' };

  const ref: DomainRef = { tenantId: row.tenantId, tenantDomainId: row.tenantDomainId, domain };
  if (deps.covered && await deps.covered(domain).catch(() => false)) return { status: 'skipped', reason: 'covered' };
  const now = deps.now();
  // A row of another name (a renamed free subdomain) or another authority's directory (staging) holds nothing for this host.
  const held = ownCertificate(await deps.findCertificate(ref), domain, config.directoryUrl);
  const action = certificateAction(held, now, req.force);
  if (action === 'none') return { status: 'skipped', reason: 'fresh' };
  if (action === 'wait') return { status: 'skipped', reason: 'backoff' };

  if (!held?.certPem) await deps.setSslStatus(ref, 'PENDING').catch(() => undefined);
  try {
    const client = await deps.newClient(config);
    const issued = await client.order(domain, deps.store);
    await deps.save(ref, issued, config.renewBeforeDays, config.directoryUrl);
    await deps.afterIssue(ref).catch((e) => Logger.warn(`[certificates] after-issue step failed for ${JSON.stringify(domain)}: ${e instanceof Error ? e.message : 'unknown'}`));
    Logger.info(`[certificates] ${action === 'renew' ? 'renewed' : 'issued'} ${JSON.stringify(domain)} until ${issued.notAfter.toISOString()}`);
    return { status: 'issued', notAfter: issued.notAfter };
  } catch (err) {
    const failure: OrderFailure = err instanceof AcmeError
      ? { message: err.message, rateLimited: err.rateLimited, retryAfterMs: err.retryAfterMs }
      : { message: err instanceof Error ? err.message : 'unknown error' };
    const { retryAt } = await deps.fail(ref, failure, now, config.directoryUrl);
    if (!held?.certPem) await deps.setSslStatus(ref, 'FAILED').catch(() => undefined);
    // The CA's problem detail or a local error: AcmeError never carries a key, but any other thrown error is not ours to trust, so the
    // log line and the outcome use the same PEM-stripped, bounded text that `fail` stores.
    const safe = sanitizeOrderError(failure.message).slice(0, 300);
    Logger.warn(`[certificates] order for ${JSON.stringify(domain)} failed: ${safe}`);
    const left = held?.notAfter ? held.notAfter.getTime() - now.getTime() : null;
    if (left !== null && left <= ALERT_WITHIN_MS) {
      Logger.error(`[certificates] ALERT ${JSON.stringify(domain)} expires in ${Math.max(0, Math.ceil(left / 3_600_000))} h and its renewal keeps failing`);
      await deps.notifyExpiring(ref, held!.notAfter!, Math.max(0, Math.ceil(left / DAY_MS))).catch(() => undefined);
    }
    return { status: 'failed', error: safe, retryAt };
  }
}
