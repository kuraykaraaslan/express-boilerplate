import { IsNull, Not } from 'typeorm';
import { withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';
import { TenantDomain } from './entities/tenant_domain.entity';
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import type { SslStatus } from './tenant_domain.enums';
import Logger from '@kuraykaraaslan-labs/logger';
import redis from '@kuraykaraaslan-labs/redis';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import TenantDomainMessages from './tenant_domain.messages';
import { managedBases } from './tenant_domain.base-domains';
import { isCertEligibleDomain } from './tenant_domain.serving';
import {
  probeCertificate,
  isProbeableHost,
  type CertProbeResult,
  type CertProbeFailure,
} from './ssl_provisioning.probe';

/**
 * SSL / TLS observability for tenant custom domains.
 *
 * The platform does NOT obtain certificates itself. Instead, a reverse proxy
 * (Caddy, Traefik, cert-manager, etc.) terminates TLS and issues certs via
 * Let's Encrypt or any ACME-compatible CA. This service:
 *
 *   1. Tells the reverse proxy whether a given hostname is allowed to
 *      provision a cert (see `isProvisioningAllowed` — Caddy's
 *      `on_demand_tls.ask` hits the `/internal/api/caddy-ask` route which
 *      delegates here).
 *
 *   2. Periodically opens a TLS handshake against every ACTIVE domain,
 *      parses the leaf cert, and writes `sslStatus / sslIssuedAt /
 *      sslExpiresAt / sslIssuer / sslLastCheckedAt` back to the
 *      `TenantDomain` row — see `recheckCertificates()`, wired into the
 *      `tenant-domain-ssl-check` daily cron.
 *
 * Reference Caddy config snippet (full example in
 * [docs/caddy-on-demand-tls.md](../../docs/caddy-on-demand-tls.md)):
 *
 *     {
 *       on_demand_tls {
 *         ask http://app:3000/internal/api/caddy-ask
 *       }
 *     }
 */

const EXPIRING_WINDOW_DAYS = 30;
const RECHECK_CONCURRENCY = 5;

export type { CertProbeResult, CertProbeFailure };

/**
 * A VERIFIED custom domain serves only once a certificate is seen serving (`isServingDomain` reads `sslStatus`), so a
 * probe result that changes `sslStatus` changes whether the host resolves: drop the proxy's cached row for it, so it
 * starts (or stops) serving at once instead of when the cache expires. Best-effort, like every cache clear here.
 */
async function dropHostCache(row: { domain: string; tenantDomainId: string; tenantId: string }): Promise<void> {
  await Promise.all([
    redis.del(`tenant:domain:name:${row.domain}`),
    redis.del(`tenant:domain:id:${row.tenantDomainId}`),
    redis.del(`tenant:domain:primary:${row.tenantId}`),
  ]).catch(() => {});
}

export default class SSLProvisioningService {
  /**
   * Caddy `on_demand_tls.ask` callback target. Returns true (= HTTP 200) iff
   * the hostname is a verified custom domain bound to an ACTIVE tenant.
   * Refusing everything else keeps Let's Encrypt rate-limits safe — a random
   * stranger pointing their DNS at us cannot trigger unbounded cert
   * issuance.
   *
   * Side effect: a successful authorization flips `sslStatus` from
   * `DISABLED` → `PENDING` so the UI can show the admin that provisioning
   * is in flight. The next handshake (cron or manual) promotes it to
   * `ACTIVE`.
   */
  static async isProvisioningAllowed(domain: string): Promise<boolean> {
    if (!domain || typeof domain !== 'string') return false;
    const host = domain.trim().toLowerCase();
    // Block IP literals and obviously local names — we only issue certs for
    // real customer hostnames.
    if (/^[0-9.]+$/.test(host) || /^[0-9a-f:]+$/.test(host)) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return false;

    try {
      // The TLS terminator asks by host, before any tenant is known.
      // tenant_domain.02: several unproven claims may share a name; the certificate is for the proven row (or the only one).
      const row = await withSystemRLS(async (qr) => {
        const repo = qr.manager.getRepository(TenantDomain);
        return (await repo.findOne({ where: { domain: host, verifiedAt: Not(IsNull()) } })) ?? repo.findOne({ where: { domain: host } });
      });
      if (!row) return false;

      // A custom domain must have proven DNS (`verifiedAt`) and be VERIFIED or ACTIVE: PENDING, INACTIVE, DNS_FAILED
      // and SUSPENDED hosts never get a certificate. A platform subdomain is eligible unless it is a reserved name.
      // The same predicate family the proxy and the origin resolver use (tenant_domain.serving).
      if (!isCertEligibleDomain(row, await managedBases())) return false;

      // common.12 (the ask half): only a domain of an ACTIVE tenant gets a certificate;
      // a suspended, deleted or relocated tenant's hostnames are refused like a stranger's.
      const tenant = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).findOne({ where: { tenantId: row.tenantId } }));
      if (!tenant || tenant.tenantStatus !== 'ACTIVE') return false;

      if (row.sslStatus === 'DISABLED') {
        await withTenantRepositoryFor(row.tenantId, TenantDomain, (repo) => repo.update(
          { tenantDomainId: row.tenantDomainId, tenantId: row.tenantId, sslStatus: 'DISABLED' },
          { sslStatus: 'PENDING' },
        ));
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      Logger.warn(`[SSL] caddy-ask lookup failed for ${domain}: ${message}`);
      return false;
    }
  }

  /**
   * Opens a TLS handshake to {host}:443, reads the peer cert, and returns
   * a parsed summary. Never throws — TLS errors are normalised to
   * `CertProbeFailure`. Delegates to the standalone probe implementation.
   */
  static probeCertificate(host: string): Promise<CertProbeResult | CertProbeFailure> {
    return probeCertificate(host);
  }

  /**
   * Guard reused by the cron and the on-demand check: only probe real, external
   * customer hostnames — never IP literals or internal/local names.
   */
  static isProbeableHost(domain: string): boolean {
    return isProbeableHost(domain);
  }

  /**
   * On-demand ("force SSL check") reconciliation for a SINGLE tenant-scoped
   * domain. Surfaces the same probe/reconcile logic used by the daily cron so
   * an admin can pull a fresh certificate reading from the detail page without
   * waiting for the schedule. Tenant-scoped by design (no cross-tenant IDOR).
   */
  static async recheckDomain(tenantId: string, tenantDomainId: string): Promise<{
    sslStatus: SslStatus;
    sslIssuedAt: Date | null;
    sslExpiresAt: Date | null;
    sslIssuer: string | null;
    sslLastCheckedAt: Date;
  }> {
    const row = await withTenantRepositoryFor(tenantId, TenantDomain, (repo) =>
      repo.findOne({ where: { tenantDomainId, tenantId } }));
    if (!row) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (!SSLProvisioningService.isProbeableHost(row.domain)) {
      throw new AppError(TenantDomainMessages.SSL_CHECK_NOT_PROBEABLE, 422, ErrorCode.VALIDATION_ERROR);
    }
    // A domain that never proved DNS ownership is not probed on demand: its A record is whatever the tenant wrote, so
    // probing it is a TLS handshake (and an issuer read-back) to an address of the tenant's choosing.
    if (!isCertEligibleDomain(row, await managedBases())) {
      throw new AppError(TenantDomainMessages.SSL_CHECK_NOT_VERIFIED, 409, ErrorCode.CONFLICT);
    }

    const now = new Date();
    const expiringThresholdMs = EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const result = await SSLProvisioningService.probeCertificate(row.domain);

    if (!result.ok) {
      await withTenantRepositoryFor(tenantId, TenantDomain, (repo) =>
        repo.update({ tenantDomainId, tenantId }, { sslStatus: 'FAILED', sslLastCheckedAt: now }));
      await dropHostCache(row);
      Logger.warn(`[SSL] on-demand probe failed for ${row.domain}: ${result.reason}`);
      return { sslStatus: 'FAILED', sslIssuedAt: null, sslExpiresAt: null, sslIssuer: null, sslLastCheckedAt: now };
    }

    const msToExpiry = result.validTo.getTime() - now.getTime();
    let nextStatus: SslStatus = 'ACTIVE';
    if (msToExpiry <= 0) nextStatus = 'FAILED';
    else if (msToExpiry < expiringThresholdMs) nextStatus = 'EXPIRING';

    await withTenantRepositoryFor(tenantId, TenantDomain, (repo) => repo.update(
      { tenantDomainId, tenantId },
      {
        sslStatus: nextStatus,
        sslIssuedAt: result.validFrom,
        sslExpiresAt: result.validTo,
        sslIssuer: result.issuer,
        sslLastCheckedAt: now,
      },
    ));
    await dropHostCache(row);

    return {
      sslStatus: nextStatus,
      sslIssuedAt: result.validFrom,
      sslExpiresAt: result.validTo,
      sslIssuer: result.issuer,
      sslLastCheckedAt: now,
    };
  }

  /**
   * Run the TLS probe for every ACTIVE custom domain and reconcile the
   * `sslStatus / sslIssuedAt / sslExpiresAt / sslIssuer` fields. Returns
   * tallies for cron logging.
   */
  static async recheckCertificates(): Promise<{
    checked: number;
    activated: number;
    expiring: number;
    failed: number;
  }> {
    // Probe everything that's either currently ACTIVE on the DNS side OR
    // sitting in SSL PENDING (Caddy is about to or just did mint a cert).
    // Tenant by tenant, through the chokepoint.
    const rows: TenantDomain[] = [];
    for (const tenant of await listActiveTenants()) {
      const t = tenant.tenantId;
      rows.push(...await withTenantRepositoryFor(t, TenantDomain, (repo) => repo.find({
        where: [
          { tenantId: t, domainStatus: 'ACTIVE' },
          { tenantId: t, domainStatus: 'VERIFIED' },
          { tenantId: t, sslStatus: 'PENDING' },
          { tenantId: t, sslStatus: 'ACTIVE' },
          { tenantId: t, sslStatus: 'EXPIRING' },
          { tenantId: t, sslStatus: 'FAILED' },
        ],
      })));
    }

    let checked = 0;
    let activated = 0;
    let expiring = 0;
    let failed = 0;
    const now = new Date();
    const expiringThresholdMs = EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    // Probe in small batches so a slow DNS / slow handshake doesn't stall
    // the cron for every other tenant.
    for (let i = 0; i < rows.length; i += RECHECK_CONCURRENCY) {
      const batch = rows.slice(i, i + RECHECK_CONCURRENCY);
      await Promise.all(batch.map(async (row) => {
        // tenant_domain.03: the sweep applies the same host guard as the on-demand check (an address-form row is skipped).
        if (!SSLProvisioningService.isProbeableHost(row.domain)) return;
        checked += 1;
        const result = await SSLProvisioningService.probeCertificate(row.domain);

        if (!result.ok) {
          failed += 1;
          await withTenantRepositoryFor(row.tenantId, TenantDomain, (repo) => repo.update(
            { tenantDomainId: row.tenantDomainId, tenantId: row.tenantId },
            {
              sslStatus: 'FAILED',
              sslLastCheckedAt: now,
            },
          ));
          await dropHostCache(row);
          Logger.warn(`[SSL] probe failed for ${row.domain}: ${result.reason}`);
          return;
        }

        const msToExpiry = result.validTo.getTime() - now.getTime();
        let nextStatus: SslStatus = 'ACTIVE';
        if (msToExpiry <= 0) {
          nextStatus = 'FAILED';
          failed += 1;
        } else if (msToExpiry < expiringThresholdMs) {
          nextStatus = 'EXPIRING';
          expiring += 1;
        } else {
          activated += 1;
        }

        await withTenantRepositoryFor(row.tenantId, TenantDomain, (repo) => repo.update(
          { tenantDomainId: row.tenantDomainId, tenantId: row.tenantId },
          {
            sslStatus: nextStatus,
            sslIssuedAt: result.validFrom,
            sslExpiresAt: result.validTo,
            sslIssuer: result.issuer,
            sslLastCheckedAt: now,
          },
        ));
        await dropHostCache(row);

        // Notify tenant admins the first time a cert crosses into the expiry
        // window (not on every daily re-probe while it stays EXPIRING).
        if (nextStatus === 'EXPIRING' && row.sslStatus !== 'EXPIRING') {
          try {
            const daysRemaining = Math.ceil(msToExpiry / (24 * 60 * 60 * 1000));
            const { default: TenantDomainNotificationsService } = await import('./tenant_domain.notifications.service');
            await TenantDomainNotificationsService.notifySslExpiring({
              tenantId: row.tenantId,
              tenantDomainId: row.tenantDomainId,
              domain: row.domain,
              expiresAt: result.validTo,
              daysRemaining,
            });
          } catch (e) {
            Logger.warn(`[SSL] expiry notify failed for ${row.domain}: ${e instanceof Error ? e.message : e}`);
          }
        }
      }));
    }

    return { checked, activated, expiring, failed };
  }
}
