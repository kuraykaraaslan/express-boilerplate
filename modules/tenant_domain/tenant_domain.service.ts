import 'reflect-metadata';
import crypto from 'crypto';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { TenantDomain as TenantDomainEntity } from './entities/TenantDomain';
import { TenantDomainMessages } from './tenant_domain.messages';
import { TenantDomainSchema, SafeTenantDomainSchema } from './tenant_domain.types';
import type { TenantDomain, SafeTenantDomain } from './tenant_domain.types';
import type { AddDomainInput } from './tenant_domain.dto';

export default class TenantDomainService {
  private static get repo() {
    return AppDataSource.getRepository(TenantDomainEntity);
  }

  static async add(data: AddDomainInput, tenantId: string): Promise<TenantDomain> {
    const repo = TenantDomainService.repo;

    const existing = await repo.findOne({ where: { domain: data.domain } });
    if (existing) {
      throw new AppError(TenantDomainMessages.DOMAIN_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const entity = repo.create({
      tenantId,
      domain: data.domain,
      isPrimary: false,
      verificationStatus: 'PENDING',
      verificationToken,
    });

    const saved = await repo.save(entity);
    return TenantDomainSchema.parse(saved);
  }

  static async findByTenant(tenantId: string): Promise<SafeTenantDomain[]> {
    const domains = await TenantDomainService.repo.find({
      where: { tenantId },
      order: { isPrimary: 'DESC', createdAt: 'DESC' },
    });
    return domains.map((d) => SafeTenantDomainSchema.parse(d));
  }

  static async findByDomain(domain: string): Promise<TenantDomain | null> {
    const found = await TenantDomainService.repo.findOne({ where: { domain } });
    if (!found) return null;
    return TenantDomainSchema.parse(found);
  }

  static async initVerification(domainId: string): Promise<TenantDomain> {
    const repo = TenantDomainService.repo;

    const entity = await repo.findOne({ where: { domainId } });
    if (!entity) {
      throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    await repo.update({ domainId }, {
      verificationToken,
      verificationStatus: 'PENDING',
    });

    const updated = await repo.findOne({ where: { domainId } });
    return TenantDomainSchema.parse(updated!);
  }

  static async verifyDomain(domainId: string): Promise<TenantDomain> {
    const repo = TenantDomainService.repo;

    const entity = await repo.findOne({ where: { domainId } });
    if (!entity) {
      throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    // Placeholder: real DNS lookup would go here
    await repo.update({ domainId }, {
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
      verificationToken: null,
    });

    const updated = await repo.findOne({ where: { domainId } });
    return TenantDomainSchema.parse(updated!);
  }

  static async remove(domainId: string): Promise<void> {
    const repo = TenantDomainService.repo;

    const entity = await repo.findOne({ where: { domainId } });
    if (!entity) {
      throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await repo.delete({ domainId });
  }

  static async setPrimary(domainId: string, tenantId: string): Promise<void> {
    const repo = TenantDomainService.repo;

    const entity = await repo.findOne({ where: { domainId } });
    if (!entity) {
      throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    // Unset all primary domains for this tenant
    await repo.update({ tenantId, isPrimary: true }, { isPrimary: false });

    // Set the target domain as primary
    await repo.update({ domainId }, { isPrimary: true });
  }
}
