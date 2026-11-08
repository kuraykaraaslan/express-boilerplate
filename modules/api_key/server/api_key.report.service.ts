import 'reflect-metadata';
import { Between, Not, IsNull, In } from 'typeorm';
import { withSharedTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ApiKey as ApiKeyEntity } from './entities/api_key.entity';

export interface ActivityReportRow {
  apiKeyId: string;
  name: string;
  keyEnv: string;
  scopes: string[];
  usageCount: number;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface ActivityReport {
  from: string;
  to: string;
  summary: {
    totalKeys: number;
    activeKeys: number;
    inactiveKeys: number;
    expiredKeys: number;
    neverUsed: number;
    totalUsage: number;
  };
  rows: ActivityReportRow[];
}

export interface RotationAuditRow {
  apiKeyId: string;
  name: string;
  keyEnv: string;
  successorKeyId: string;
  successorName: string | null;
  rotatedAt: string;
  graceExpiresAt: string | null;
  isActive: boolean;
}

export interface RotationAudit {
  from: string;
  to: string;
  summary: {
    rotations: number;
    graceActive: number;
    revokedImmediately: number;
  };
  rows: RotationAuditRow[];
}

function resolveRange(opts: { from?: Date; to?: Date }): { from: Date; to: Date } {
  const to = opts.to ?? new Date();
  // Default: trailing 90 days.
  const from = opts.from ?? new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * API-key observability reports (read-only aggregations over the api_keys
 * table — no separate audit store required).
 */
export default class ApiKeyReportService {
  /** Usage/last-used activity per key created within the range. */
  static async getActivityReport(
    tenantId: string,
    opts: { from?: Date; to?: Date } = {},
  ): Promise<ActivityReport> {
    const { from, to } = resolveRange(opts);
    const rows = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, (repo) => repo.find({
      where: { tenantId, createdAt: Between(from, to) },
      order: { usageCount: 'DESC' },
    }));

    const now = Date.now();
    let activeKeys = 0;
    let inactiveKeys = 0;
    let expiredKeys = 0;
    let neverUsed = 0;
    let totalUsage = 0;

    const out: ActivityReportRow[] = rows.map((k) => {
      const expired = !!k.expiresAt && k.expiresAt.getTime() < now;
      if (expired) expiredKeys += 1;
      if (k.isActive && !expired) activeKeys += 1;
      if (!k.isActive) inactiveKeys += 1;
      if (!k.lastUsedAt) neverUsed += 1;
      totalUsage += Number(k.usageCount) || 0;
      return {
        apiKeyId: k.apiKeyId,
        name: k.name,
        keyEnv: k.keyEnv,
        scopes: k.scopes,
        usageCount: Number(k.usageCount) || 0,
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        lastUsedIp: k.lastUsedIp,
        isActive: k.isActive,
        expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
        createdAt: k.createdAt.toISOString(),
      };
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      summary: {
        totalKeys: rows.length,
        activeKeys,
        inactiveKeys,
        expiredKeys,
        neverUsed,
        totalUsage,
      },
      rows: out,
    };
  }

  /** Rotation lineage: every key that minted a successor within the range. */
  static async getRotationAudit(
    tenantId: string,
    opts: { from?: Date; to?: Date } = {},
  ): Promise<RotationAudit> {
    const { from, to } = resolveRange(opts);
    const { rotated, successors } = await withSharedTenantRepositoryFor(tenantId, ApiKeyEntity, async (repo) => {
      const rotated = await repo.find({
        where: { tenantId, successorKeyId: Not(IsNull()), updatedAt: Between(from, to) },
        order: { updatedAt: 'DESC' },
      });
      // Resolve successor names in one pass.
      const successorIds = rotated.map((r) => r.successorKeyId).filter((v): v is string => !!v);
      const successors = successorIds.length > 0
        ? await repo.find({ where: { tenantId, apiKeyId: In(successorIds) } })
        : [];
      return { rotated, successors };
    });
    const nameById = new Map<string, string>();
    for (const s of successors) nameById.set(s.apiKeyId, s.name);

    let graceActive = 0;
    let revokedImmediately = 0;
    const now = Date.now();

    const rows: RotationAuditRow[] = rotated.map((k) => {
      const graceOpen = k.isActive && !!k.expiresAt && k.expiresAt.getTime() > now;
      if (graceOpen) graceActive += 1;
      if (!k.isActive) revokedImmediately += 1;
      return {
        apiKeyId: k.apiKeyId,
        name: k.name,
        keyEnv: k.keyEnv,
        successorKeyId: k.successorKeyId as string,
        successorName: nameById.get(k.successorKeyId as string) ?? null,
        rotatedAt: k.updatedAt.toISOString(),
        graceExpiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
        isActive: k.isActive,
      };
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      summary: {
        rotations: rotated.length,
        graceActive,
        revokedImmediately,
      },
      rows,
    };
  }
}
