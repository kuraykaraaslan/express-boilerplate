import { In, Not } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantDomain as TenantDomainEntity } from './entities/tenant_domain.entity';
import { SafeTenantDomainSchema, type DomainVerificationInfo } from './tenant_domain.types';
import type { InitiateVerificationInput } from './tenant_domain.dto';
import TenantDomainMessages from './tenant_domain.messages';
import DNSVerificationService from './dns_verification.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import TenantDomainCrudService from './tenant_domain.crud.service';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import Logger from '@kuraykaraaslan-labs/logger';
import type { DomainStatus } from './tenant_domain.enums';

export default class TenantDomainDnsService {

  static async getVerificationInfo(tenantDomainId: string, tenantId: string): Promise<DomainVerificationInfo> {
    const domain = await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.findOne({ where: { tenantDomainId, tenantId } }));
    if (!domain) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const verificationData = await DNSVerificationService.getStoredData(tenantDomainId);
    if (!verificationData) {
      // Honor the tenant's preferred DNS challenge type (defaults to TXT).
      const preferred = await SettingService.getValue(tenantId, 'preferredDnsChallenge').catch(() => null);
      const method = preferred === 'CNAME' ? 'CNAME' : 'TXT';
      return TenantDomainDnsService.initiateVerification({ tenantDomainId, method }, tenantId);
    }

    const { token, method } = verificationData;
    return {
      domain: domain.domain,
      method,
      recordName: method === 'TXT'
        ? DNSVerificationService.getTxtRecordName(domain.domain)
        : DNSVerificationService.getCnameRecordName(domain.domain, token),
      recordValue: method === 'TXT'
        ? DNSVerificationService.getTxtRecordValue(token)
        : DNSVerificationService.getCnameRecordTarget(),
      domainStatus: domain.domainStatus as 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'VERIFIED' | 'DNS_FAILED',
    };
  }

  static async initiateVerification({ tenantDomainId, method }: InitiateVerificationInput, tenantId: string): Promise<DomainVerificationInfo> {
    const domain = await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.findOne({ where: { tenantDomainId, tenantId } }));
    if (!domain) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (domain.domainStatus === 'VERIFIED') throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_VERIFIED, 409, ErrorCode.CONFLICT);

    const verification = await DNSVerificationService.initiateVerification(tenantDomainId, domain.domain, method);
    await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.update({ tenantDomainId, tenantId }, { verificationToken: verification.token }));
    await TenantDomainCrudService.clearCache(SafeTenantDomainSchema.parse(domain));

    return {
      domain: domain.domain,
      method: verification.method,
      recordName: verification.recordName,
      recordValue: verification.recordValue,
      domainStatus: domain.domainStatus as 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'VERIFIED' | 'DNS_FAILED',
    };
  }

  static async verifyDomain(tenantDomainId: string, tenantId: string): Promise<import('./tenant_domain.types').SafeTenantDomain> {
    const domain = await withTenantRepositoryFor(tenantId, TenantDomainEntity, (repo) =>
      repo.findOne({ where: { tenantDomainId, tenantId } }));
    if (!domain) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (domain.domainStatus === 'VERIFIED') throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_VERIFIED, 409, ErrorCode.CONFLICT);
    // A suspended domain comes back with the plan (tenant_domain.reconcile), not by passing DNS again.
    if (domain.domainStatus === 'SUSPENDED') throw new AppError(TenantDomainMessages.DOMAIN_SUSPENDED, 409, ErrorCode.CONFLICT);

    const isVerified = await DNSVerificationService.checkVerification(tenantDomainId, domain.domain);
    if (!isVerified) throw new AppError(TenantDomainMessages.DNS_VERIFICATION_FAILED, 422, ErrorCode.VALIDATION_ERROR);

    // Conditional, so two concurrent verifications record one transition; and
    // the spent challenge token is cleared with an explicit NULL — TypeORM
    // writes nothing for `undefined`, so it used to stay on the row forever.
    // tenant_domain.02: the proof takes the name globally (a partial unique index over proven rows): when another workspace
    // proved the same name first, this proof is the defined 409, nothing written.
    const { updated, won } = await withTenantRepositoryFor(tenantId, TenantDomainEntity, async (repo) => {
      const res = await repo.update(
        { tenantDomainId, tenantId, domainStatus: Not(In(['VERIFIED', 'SUSPENDED'])) },
        { domainStatus: 'VERIFIED', verifiedAt: new Date(), verificationToken: null } as never,
      );
      return { updated: await repo.findOne({ where: { tenantDomainId, tenantId } }), won: !!res.affected };
    }).catch((err: unknown) => {
      const e = err as { code?: string; driverError?: { code?: string } } | null;
      if (e?.code === '23505' || e?.driverError?.code === '23505') {
        throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
      }
      throw err;
    });
    if (!updated) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (!won) throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_VERIFIED, 409, ErrorCode.CONFLICT);

    const parsed = SafeTenantDomainSchema.parse(updated);
    await TenantDomainCrudService.clearCache(parsed);
    // phase 51: DNS is proven, the host is servable now: ask for its certificate (queue, best effort).
    void import('./tenant_domain.certificates.hooks').then((m) => m.requestCertificate({ ...parsed, tenantId: parsed.tenantId, tenantDomainId: parsed.tenantDomainId })).catch(() => undefined);

    // Lifecycle side-effects (audit trail + `tenant_domain.verified` webhook).
    // Best-effort — never let a notification failure fail the verification.
    try {
      const { default: TenantDomainNotificationsService } = await import('./tenant_domain.notifications.service');
      await TenantDomainNotificationsService.recordStatusTransition({
        tenantId,
        tenantDomainId,
        domain: parsed.domain,
        fromStatus: domain.domainStatus as DomainStatus,
        toStatus: 'VERIFIED',
      });
    } catch (e) {
      Logger.warn(`[tenant_domain] verify notify failed for ${parsed.domain}: ${e instanceof Error ? e.message : e}`);
    }

    return parsed;
  }
}
