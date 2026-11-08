import 'reflect-metadata';
import { Between } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ApprovalQueueItem as ApprovalQueueItemEntity } from './entities/approval_queue_item.entity';

/**
 * Period-based approval reports. Aggregates over `approval_queue_items` rows
 * submitted within a date range (`createdAt` Between from/to) into four views:
 *  - SLA compliance: share of decided items resolved on or before `slaDueAt`.
 *  - Approver workload: per-reviewer decided count + avg resolution time (hours).
 *  - Entity-type breakdown: submitted / decided / approved / rejected per type.
 *  - Daily trend: submitted vs decided per calendar day.
 *
 * Live rows (not the audit log) are used because SLA compliance needs both the
 * submit time (`createdAt` / `slaDueAt`) and the decision time (`reviewedAt`).
 */

export interface ApprovalSlaCompliance {
  decided: number;
  onTime: number;
  breached: number;
  compliancePct: number;
}

export interface ApprovalWorkloadRow {
  reviewedByUserId: string | null;
  decided: number;
  avgResolutionHours: number;
}

export interface ApprovalEntityTypeRow {
  entityType: string;
  submitted: number;
  decided: number;
  approved: number;
  rejected: number;
}

export interface ApprovalTrendPoint {
  day: string; // YYYY-MM-DD
  submitted: number;
  decided: number;
}

export interface ApprovalReport {
  from: string;
  to: string;
  totalSubmitted: number;
  totalDecided: number;
  slaCompliance: ApprovalSlaCompliance;
  workload: ApprovalWorkloadRow[];
  entityTypes: ApprovalEntityTypeRow[];
  trend: ApprovalTrendPoint[];
}

const TERMINAL = new Set(['APPROVED', 'REJECTED']);

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default class ApprovalReportService {
  static async getReport(tenantId: string, opts: { from?: Date; to?: Date } = {}): Promise<ApprovalReport> {
    const to = opts.to ?? new Date();
    const from = opts.from ?? new Date(to.getFullYear(), to.getMonth(), 1); // month-to-date default

    // Only the read is in the tenant-scoped block; the aggregation below is pure.
    const rows = await withTenantRepositoryFor(tenantId, ApprovalQueueItemEntity, (repo) => repo.find({
      where: { tenantId, createdAt: Between(from, to) },
      order: { createdAt: 'ASC' },
    }));

    // SLA compliance — over decided (terminal) items with a known slaDueAt.
    let decidedCount = 0;
    let onTime = 0;

    // Approver workload — per reviewer.
    const workloadMap = new Map<string, { decided: number; totalHours: number }>();

    // Entity-type breakdown.
    const entityMap = new Map<string, ApprovalEntityTypeRow>();

    // Daily trend.
    const trendMap = new Map<string, ApprovalTrendPoint>();

    for (const row of rows) {
      const isDecided = TERMINAL.has(row.status) && row.reviewedAt != null;

      // Entity-type breakdown
      const et = entityMap.get(row.entityType) ?? {
        entityType: row.entityType,
        submitted: 0,
        decided: 0,
        approved: 0,
        rejected: 0,
      };
      et.submitted += 1;
      if (isDecided) {
        et.decided += 1;
        if (row.status === 'APPROVED') et.approved += 1;
        else if (row.status === 'REJECTED') et.rejected += 1;
      }
      entityMap.set(row.entityType, et);

      // Daily trend (by submit day, plus decided day if within range)
      const subKey = dayKey(row.createdAt);
      const subPoint = trendMap.get(subKey) ?? { day: subKey, submitted: 0, decided: 0 };
      subPoint.submitted += 1;
      trendMap.set(subKey, subPoint);

      if (isDecided && row.reviewedAt) {
        const decKey = dayKey(row.reviewedAt);
        const decPoint = trendMap.get(decKey) ?? { day: decKey, submitted: 0, decided: 0 };
        decPoint.decided += 1;
        trendMap.set(decKey, decPoint);

        decidedCount += 1;
        if (row.slaDueAt && row.reviewedAt.getTime() <= row.slaDueAt.getTime()) onTime += 1;

        const key = row.reviewedByUserId ?? '__unassigned__';
        const w = workloadMap.get(key) ?? { decided: 0, totalHours: 0 };
        w.decided += 1;
        w.totalHours += (row.reviewedAt.getTime() - row.createdAt.getTime()) / (60 * 60 * 1000);
        workloadMap.set(key, w);
      }
    }

    const workload: ApprovalWorkloadRow[] = [...workloadMap.entries()]
      .map(([key, w]) => ({
        reviewedByUserId: key === '__unassigned__' ? null : key,
        decided: w.decided,
        avgResolutionHours: w.decided > 0 ? Math.round((w.totalHours / w.decided) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.decided - a.decided);

    const entityTypes = [...entityMap.values()].sort((a, b) => b.submitted - a.submitted);

    const trend = [...trendMap.values()].sort((a, b) => a.day.localeCompare(b.day));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalSubmitted: rows.length,
      totalDecided: decidedCount,
      slaCompliance: {
        decided: decidedCount,
        onTime,
        breached: decidedCount - onTime,
        compliancePct: decidedCount > 0 ? Math.round((onTime / decidedCount) * 1000) / 10 : 0,
      },
      workload,
      entityTypes,
      trend,
    };
  }
}
