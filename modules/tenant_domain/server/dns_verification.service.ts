import 'reflect-metadata';
import { env } from '@kuraykaraaslan-labs/env';
import { Resolver } from 'dns/promises';
import crypto from 'crypto';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';
import { TenantDomain as TenantDomainEntity } from './entities/tenant_domain.entity';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import type { VerificationMethod } from './tenant_domain.enums';
import { isWildcardSubdomain } from './tenant_domain.wildcard';
import { managedBases } from './tenant_domain.base-domains';

const DNS_RECHECK_CONCURRENCY = 5;

const DNS_VERIFICATION_PREFIX = 'dns_verify:';
const DNS_VERIFICATION_TTL = 60 * 60 * 24; // 24 saat
const TXT_RECORD_PREFIX = '_verification';
const CNAME_RECORD_PREFIX = '_verify';
const CNAME_TARGET_DOMAIN = env.VERIFICATION_DOMAIN || 'verify.example.com';

export default class DNSVerificationService {

  private static resolver = new Resolver();

  static generateToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // TXT Record
  static getTxtRecordName(domain: string): string {
    return `${TXT_RECORD_PREFIX}.${domain}`;
  }

  static getTxtRecordValue(token: string): string {
    return `verify=${token}`;
  }

  // CNAME Record
  static getCnameRecordName(domain: string, token: string): string {
    return `${CNAME_RECORD_PREFIX}-${token}.${domain}`;
  }

  static getCnameRecordTarget(): string {
    return CNAME_TARGET_DOMAIN;
  }

  // Redis operations
  static async storeVerificationData(
    tenantDomainId: string,
    token: string,
    method: VerificationMethod
  ): Promise<void> {
    const key = `${DNS_VERIFICATION_PREFIX}${tenantDomainId}`;
    const data = JSON.stringify({ token, method });
    await redis.set(key, data, 'EX', DNS_VERIFICATION_TTL);
  }

  static async getStoredData(tenantDomainId: string): Promise<{ token: string; method: VerificationMethod } | null> {
    const key = `${DNS_VERIFICATION_PREFIX}${tenantDomainId}`;
    const data = await redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  static async deleteStoredToken(tenantDomainId: string): Promise<void> {
    const key = `${DNS_VERIFICATION_PREFIX}${tenantDomainId}`;
    await redis.del(key);
  }

  // DNS Lookups
  static async lookupTxtRecords(domain: string): Promise<string[]> {
    try {
      const records = await this.resolver.resolveTxt(this.getTxtRecordName(domain));
      return records.flat();
    } catch {
      return [];
    }
  }

  static async lookupCnameRecord(recordName: string): Promise<string | null> {
    try {
      const records = await this.resolver.resolveCname(recordName);
      return records[0] || null;
    } catch {
      return null;
    }
  }

  // Verification methods
  static async verifyByTxt(domain: string, expectedToken: string): Promise<boolean> {
    const txtRecords = await this.lookupTxtRecords(domain);
    const expectedValue = this.getTxtRecordValue(expectedToken);
    return txtRecords.some(record => record === expectedValue);
  }

  static async verifyByCname(domain: string, token: string): Promise<boolean> {
    const recordName = this.getCnameRecordName(domain, token);
    const cnameTarget = await this.lookupCnameRecord(recordName);
    // DNS names are case-insensitive (RFC 4343) and may carry the root dot: compare one normalised spelling.
    const norm = (v: string | null) => (v ?? '').toLowerCase().replace(/\.$/, '');
    return cnameTarget !== null && norm(cnameTarget) === norm(this.getCnameRecordTarget());
  }

  // Main verification flow
  static async initiateVerification(
    tenantDomainId: string,
    domain: string,
    method: VerificationMethod = 'TXT'
  ): Promise<{
    method: VerificationMethod;
    recordName: string;
    recordValue: string;
    token: string;
  }> {
    const token = this.generateToken();
    await this.storeVerificationData(tenantDomainId, token, method);

    if (method === 'CNAME') {
      return {
        method,
        recordName: this.getCnameRecordName(domain, token),
        recordValue: this.getCnameRecordTarget(),
        token
      };
    }

    return {
      method,
      recordName: this.getTxtRecordName(domain),
      recordValue: this.getTxtRecordValue(token),
      token
    };
  }

  /**
   * Health-check the DNS records of every ACTIVE TenantDomain. Domains whose
   * TXT/CNAME no longer resolves get downgraded to `DNS_FAILED` so admins are
   * forced to manually re-verify before traffic resumes. Runs in batches of
   * `DNS_RECHECK_CONCURRENCY` to avoid hammering the resolver on big tenants.
   */
  static async recheckActiveDomains(): Promise<{ checked: number; downgraded: number }> {
    // Tenant by tenant: a sweep has no tenant in context, so it asks which
    // tenants exist and reads each one's domains through the chokepoint.
    // Subdomains of the platform wildcard are skipped: they carry no TXT/CNAME proof of their own (the platform's
    // wildcard record serves them), so this probe found every one of them "broken" and downgraded the free subdomain
    // every tenant keeps. They are the platform's names; their health is the wildcard record's.
    const activeDomains: TenantDomainEntity[] = [];
    const bases = await managedBases();
    for (const tenant of await listActiveTenants()) {
      activeDomains.push(...(await withTenantRepositoryFor(tenant.tenantId, TenantDomainEntity, (repo) =>
        repo.find({ where: { tenantId: tenant.tenantId, domainStatus: 'ACTIVE' } })))
        .filter((d) => !isWildcardSubdomain(d.domain, bases)));
    }

    let downgraded = 0;
    for (let i = 0; i < activeDomains.length; i += DNS_RECHECK_CONCURRENCY) {
      const batch = activeDomains.slice(i, i + DNS_RECHECK_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (d) => {
          try {
            const txt = await this.lookupTxtRecords(d.domain);
            if (txt.length > 0) return { domain: d, ok: true };
            const cnameProbe = await this.lookupCnameRecord(d.domain);
            return { domain: d, ok: cnameProbe !== null };
          } catch (err) {
            Logger.warn(`[DNSRecheck] Resolver error for ${d.domain}: ${err instanceof Error ? err.message : String(err)}`);
            return { domain: d, ok: false };
          }
        }),
      );

      for (const { domain: d, ok } of results) {
        if (ok) continue;
        try {
          // Conditional on still being ACTIVE (a domain re-verified or removed
          // meanwhile is left alone, and the failure is announced once), and
          // `verifiedAt` really cleared — `undefined` is never written, so the
          // stale proof used to survive the downgrade.
          const res = await withTenantRepositoryFor(d.tenantId, TenantDomainEntity, (repo) => repo.update(
            { tenantDomainId: d.tenantDomainId, tenantId: d.tenantId, domainStatus: 'ACTIVE' },
            { domainStatus: 'DNS_FAILED', verifiedAt: null } as never,
          ));
          if (!res.affected) continue;
          await Promise.all([
            redis.del(`tenant:domain:name:${d.domain}`),
            redis.del(`tenant:domain:id:${d.tenantDomainId}`),
            redis.del(`tenant:domain:primary:${d.tenantId}`),
            redis.del(`notification_mail:brand:${d.tenantId}`), // mail brand carries the verified origin
          ]);
          await AuditLogService.log({
            tenantId: d.tenantId,
            actorType: 'SYSTEM',
            action: 'domain.dns_check_failed',
            resourceType: 'tenant_domain',
            resourceId: d.tenantDomainId,
            metadata: { domain: d.domain },
          });
          downgraded += 1;
          // Emit `tenant_domain.dns_failed` webhook + email the tenant admins a
          // re-verification prompt. Best-effort; the downgrade already counted.
          const { default: TenantDomainNotificationsService } = await import('./tenant_domain.notifications.service');
          await TenantDomainNotificationsService.notifyDnsFailure({
            tenantId: d.tenantId,
            tenantDomainId: d.tenantDomainId,
            domain: d.domain,
          });
        } catch (err) {
          Logger.error(`[DNSRecheck] Failed to downgrade ${d.domain}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    Logger.info(`[DNSRecheck] checked=${activeDomains.length} downgraded=${downgraded}`);
    return { checked: activeDomains.length, downgraded };
  }

  static async checkVerification(tenantDomainId: string, domain: string): Promise<boolean> {
    const stored = await this.getStoredData(tenantDomainId);

    if (!stored) {
      return false;
    }

    const { token, method } = stored;

    const isVerified = method === 'CNAME'
      ? await this.verifyByCname(domain, token)
      : await this.verifyByTxt(domain, token);

    if (isVerified) {
      await this.deleteStoredToken(tenantDomainId);
    }

    return isVerified;
  }
}
