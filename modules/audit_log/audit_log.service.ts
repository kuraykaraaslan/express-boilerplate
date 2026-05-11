import 'reflect-metadata';
import { Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { AppDataSource } from '@/libs/typeorm';
import { Logger } from '@/libs/logger';
import { AuditLog as AuditLogEntity } from './entities/AuditLog';
import { AuditLogSchema } from './audit_log.types';
import type { AuditLog, CreateAuditLogInput } from './audit_log.types';
import type { GetAuditLogsInput } from './audit_log.dto';

export default class AuditLogService {
  private static get repo() {
    return AppDataSource.getRepository(AuditLogEntity);
  }

  /**
   * Fire-and-forget audit log write. Returns promise for explicit await.
   */
  static async log(data: CreateAuditLogInput): Promise<AuditLog> {
    const repo = AuditLogService.repo;
    const entry = repo.create({
      action: data.action,
      tenantId: data.tenantId ?? null,
      userId: data.userId ?? null,
      resourceType: data.resourceType ?? null,
      resourceId: data.resourceId ?? null,
      metadata: data.metadata ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    });
    const saved = await repo.save(entry);
    return AuditLogSchema.parse(saved);
  }

  /**
   * Try/catch wrapper — errors are silently logged and never thrown.
   */
  static logSafe(data: CreateAuditLogInput): void {
    AuditLogService.log(data).catch((err) => {
      Logger.error(`[AuditLog] Failed to write log: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  static async findByTenant(
    tenantId: string,
    filter: GetAuditLogsInput,
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const { page, limit, action, startDate, endDate } = filter;
    const where: Record<string, unknown> = { tenantId };

    if (action) where.action = action;
    if (startDate && endDate) where.createdAt = Between(startDate, endDate);
    else if (startDate) where.createdAt = MoreThanOrEqual(startDate);
    else if (endDate) where.createdAt = LessThanOrEqual(endDate);

    const [rows, total] = await AuditLogService.repo.findAndCount({
      where: where as any,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { logs: rows.map((r) => AuditLogSchema.parse(r)), total };
  }

  static async findByUser(
    userId: string,
    filter: GetAuditLogsInput,
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const { page, limit, action, startDate, endDate } = filter;
    const where: Record<string, unknown> = { userId };

    if (action) where.action = action;
    if (startDate && endDate) where.createdAt = Between(startDate, endDate);
    else if (startDate) where.createdAt = MoreThanOrEqual(startDate);
    else if (endDate) where.createdAt = LessThanOrEqual(endDate);

    const [rows, total] = await AuditLogService.repo.findAndCount({
      where: where as any,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { logs: rows.map((r) => AuditLogSchema.parse(r)), total };
  }

  static async findSystemLogs(
    filter: GetAuditLogsInput,
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const { page, limit, action, startDate, endDate } = filter;
    const where: Record<string, unknown> = { tenantId: null };

    if (action) where.action = action;
    if (startDate && endDate) where.createdAt = Between(startDate, endDate);
    else if (startDate) where.createdAt = MoreThanOrEqual(startDate);
    else if (endDate) where.createdAt = LessThanOrEqual(endDate);

    const [rows, total] = await AuditLogService.repo.findAndCount({
      where: where as any,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { logs: rows.map((r) => AuditLogSchema.parse(r)), total };
  }
}
