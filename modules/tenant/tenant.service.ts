import 'reflect-metadata';
import { IsNull, ILike, FindOptionsWhere } from 'typeorm';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { Tenant } from './entities/Tenant';
import { TenantMessages } from './tenant.messages';
import { SafeTenant, SafeTenantSchema, Tenant as TenantType } from './tenant.types';
import {
  CreateTenantInput,
  UpdateTenantInput,
  GetTenantsInput,
} from './tenant.dto';

export default class TenantService {
  private static get repo() {
    return AppDataSource.getRepository(Tenant);
  }

  static omitSensitiveFields(tenant: TenantType): SafeTenant {
    return SafeTenantSchema.parse(tenant);
  }

  static async create(data: CreateTenantInput, ownerId: string): Promise<SafeTenant> {
    const repo = TenantService.repo;

    const existing = await repo.findOne({ where: { name: data.name } });
    if (existing) {
      throw new AppError(TenantMessages.TENANT_ALREADY_EXISTS, 409, ErrorCode.CONFLICT);
    }

    const tenant = repo.create({
      ...data,
      ownerId,
      tenantStatus: 'ACTIVE',
    });

    const saved = await repo.save(tenant);
    return SafeTenantSchema.parse(saved);
  }

  static async findById(tenantId: string): Promise<SafeTenant> {
    const tenant = await TenantService.repo.findOne({
      where: { tenantId, deletedAt: IsNull() },
    });

    if (!tenant) {
      throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
    }

    return SafeTenantSchema.parse(tenant);
  }

  static async findByOwnerId(ownerId: string): Promise<SafeTenant[]> {
    const tenants = await TenantService.repo.find({
      where: { ownerId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    return tenants.map((t) => SafeTenantSchema.parse(t));
  }

  static async update(tenantId: string, data: UpdateTenantInput): Promise<SafeTenant> {
    const repo = TenantService.repo;

    const tenant = await repo.findOne({ where: { tenantId, deletedAt: IsNull() } });
    if (!tenant) {
      throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
    }

    await repo.update({ tenantId }, data as Partial<Tenant>);

    const updated = await repo.findOne({ where: { tenantId } });
    return SafeTenantSchema.parse(updated!);
  }

  static async delete(tenantId: string): Promise<void> {
    const repo = TenantService.repo;

    const tenant = await repo.findOne({ where: { tenantId, deletedAt: IsNull() } });
    if (!tenant) {
      throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
    }

    await repo.softDelete({ tenantId });
  }

  static async list(data: GetTenantsInput): Promise<{ tenants: SafeTenant[]; total: number }> {
    const { page, limit, search, ownerId } = data;

    const baseWhere: FindOptionsWhere<Tenant> = { deletedAt: IsNull() };
    if (ownerId) baseWhere.ownerId = ownerId;

    let whereConditions: FindOptionsWhere<Tenant>[];

    if (search) {
      whereConditions = [
        { ...baseWhere, name: ILike(`%${search}%`) },
        { ...baseWhere, description: ILike(`%${search}%`) },
      ];
    } else {
      whereConditions = [baseWhere];
    }

    const [tenants, total] = await TenantService.repo.findAndCount({
      where: whereConditions,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return { tenants: tenants.map((t) => SafeTenantSchema.parse(t)), total };
  }

  static async provisionPersonalTenant(userId: string, userEmail: string): Promise<SafeTenant> {
    const repo = TenantService.repo;
    const name = userEmail.split('@')[0];

    const existing = await repo.findOne({
      where: { ownerId: userId, isPersonal: true, deletedAt: IsNull() },
    });

    if (existing) {
      return SafeTenantSchema.parse(existing);
    }

    // Ensure name uniqueness for personal tenants
    let uniqueName = name;
    const conflict = await repo.findOne({ where: { name: uniqueName } });
    if (conflict) {
      uniqueName = `${name}-${userId.slice(0, 8)}`;
    }

    const tenant = repo.create({
      name: uniqueName,
      ownerId: userId,
      isPersonal: true,
      tenantStatus: 'ACTIVE',
    });

    const saved = await repo.save(tenant);
    return SafeTenantSchema.parse(saved);
  }
}
