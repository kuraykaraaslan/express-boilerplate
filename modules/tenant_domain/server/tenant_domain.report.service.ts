import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantDomain as TenantDomainEntity } from './entities/tenant_domain.entity';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { DEFAULT_SSL_EXPIRY_WARNING_DAYS } from './tenant_domain.settings.fields';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One row of the SSL-expiry report: a domain that carries a parsed certificate. */
export interface SslExpiryRow {
  tenantDomainId: string;
  domain: string;
  sslStatus: string;
  sslIssuer: string | null;
  sslExpiresAt: string | null;
  daysUntilExpiry: number | null;
  atRisk: boolean;
}

/** One row of the DNS-verification-age report. */
export interface DnsAgeRow {
  tenantDomainId: string;
  domain: string;
  domainStatus: string;
  verifiedAt: string | null;
  daysSinceVerified: number | null;
}

/** Domain-health snapshot: counts by domain status and SSL status. */
export interface DomainHealthSnapshot {
  totalDomains: number;
  verified: number;
  unverified: number;
  dnsFailed: number;
  sslActive: number;
  sslExpiring: number;
  sslFailed: number;
  sslNone: number;
  domainStatusBreakdown: Array<{ status: string; count: number }>;
  sslStatusBreakdown: Array<{ status: string; count: number }>;
}

export interface DomainHealthReport {
  generatedAt: string;
  sslExpiryWarningDays: number;
  snapshot: DomainHealthSnapshot;
  sslExpiry: SslExpiryRow[];
  dnsAge: DnsAgeRow[];
}

export default class TenantDomainReportService {
  /**
   * Aggregate the tenant's custom domains into the three roadmap reports:
   * SSL-certificate-expiry, DNS-verification-age, and a domain-health snapshot.
   * Pure read over the existing `tenant_domains` rows — no new tables.
   */
  static async getReport(tenantId: string): Promise<DomainHealthReport> {
    const warnSetting = await SettingService.getByKey(tenantId, 'sslExpiryWarningDays');
    const parsedWarn = warnSetting ? parseInt(warnSetting.value, 10) : NaN;
    const sslExpiryWarningDays = Number.isFinite(parsedWarn) && parsedWarn > 0
      ? parsedWarn
      : DEFAULT_SSL_EXPIRY_WARNING_DAYS;

    const rows = await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) => repo.find({ where: { tenantId } }));
    const now = Date.now();

    const domainStatusCounts = new Map<string, number>();
    const sslStatusCounts = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

    for (const r of rows) {
      bump(domainStatusCounts, r.domainStatus);
      bump(sslStatusCounts, r.sslStatus);
    }

    const sslExpiry: SslExpiryRow[] = rows
      .filter((r) => r.sslExpiresAt)
      .map((r) => {
        const expiresMs = r.sslExpiresAt!.getTime();
        const daysUntilExpiry = Math.round((expiresMs - now) / MS_PER_DAY);
        return {
          tenantDomainId: r.tenantDomainId,
          domain: r.domain,
          sslStatus: r.sslStatus,
          sslIssuer: r.sslIssuer ?? null,
          sslExpiresAt: r.sslExpiresAt!.toISOString(),
          daysUntilExpiry,
          atRisk: daysUntilExpiry <= sslExpiryWarningDays,
        };
      })
      .sort((a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0));

    const dnsAge: DnsAgeRow[] = rows
      .map((r) => ({
        tenantDomainId: r.tenantDomainId,
        domain: r.domain,
        domainStatus: r.domainStatus,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        daysSinceVerified: r.verifiedAt
          ? Math.round((now - r.verifiedAt.getTime()) / MS_PER_DAY)
          : null,
      }))
      .sort((a, b) => (b.daysSinceVerified ?? -1) - (a.daysSinceVerified ?? -1));

    const snapshot: DomainHealthSnapshot = {
      totalDomains: rows.length,
      verified: rows.filter((r) => r.domainStatus === 'VERIFIED' || r.domainStatus === 'ACTIVE').length,
      unverified: rows.filter((r) => r.domainStatus === 'PENDING' || r.domainStatus === 'INACTIVE').length,
      dnsFailed: rows.filter((r) => r.domainStatus === 'DNS_FAILED').length,
      sslActive: rows.filter((r) => r.sslStatus === 'ACTIVE').length,
      sslExpiring: rows.filter((r) => r.sslStatus === 'EXPIRING').length,
      sslFailed: rows.filter((r) => r.sslStatus === 'FAILED' || r.sslStatus === 'EXPIRED').length,
      sslNone: rows.filter((r) => r.sslStatus === 'DISABLED').length,
      domainStatusBreakdown: [...domainStatusCounts.entries()].map(([status, count]) => ({ status, count })),
      sslStatusBreakdown: [...sslStatusCounts.entries()].map(([status, count]) => ({ status, count })),
    };

    return {
      generatedAt: new Date().toISOString(),
      sslExpiryWarningDays,
      snapshot,
      sslExpiry,
      dnsAge,
    };
  }
}
