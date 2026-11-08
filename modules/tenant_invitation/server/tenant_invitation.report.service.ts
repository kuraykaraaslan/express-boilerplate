import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantInvitation as TenantInvitationEntity } from './entities/tenant_invitation.entity';
import { TenantInvitationStatusEnum, type TenantInvitationStatus } from './tenant_invitation.enums';

export interface OldestPendingRow {
  invitationId: string;
  email: string;
  memberRole: string;
  createdAt: string;
  expiresAt: string;
  ageDays: number;
}

export interface InvitationReport {
  total: number;
  byStatus: Record<TenantInvitationStatus, number>;
  /** Accepted as a share of all concluded invitations (accepted+declined+expired+revoked), 0..1. */
  acceptanceRate: number;
  pendingCount: number;
  oldestPending: OldestPendingRow[];
}

const STATUSES = TenantInvitationStatusEnum.options;

/**
 * Aggregate invitation lifecycle stats for a tenant: per-status counts, the
 * acceptance rate among concluded invitations, and the oldest still-pending
 * invitations. Pure read; no caching (report pages are low-traffic).
 */
export async function getReport(tenantId: string, opts: { oldestLimit?: number } = {}): Promise<InvitationReport> {
  const oldestLimit = Math.min(Math.max(opts.oldestLimit ?? 5, 1), 25);
  // One block, queries in sequence: a transaction's connection runs one statement at a time.
  const { counts, pendingRows } = await withTenantRepositoryFor(tenantId, TenantInvitationEntity, async (repo) => {
    const counts: number[] = [];
    for (const status of STATUSES) counts.push(await repo.count({ where: { tenantId, status } }));
    const pendingRows = await repo.find({
      where: { tenantId, status: 'PENDING' },
      order: { createdAt: 'ASC' },
      take: oldestLimit,
    });
    return { counts, pendingRows };
  });
  const byStatus = STATUSES.reduce((acc, status, i) => {
    acc[status] = counts[i];
    return acc;
  }, {} as Record<TenantInvitationStatus, number>);

  const total = counts.reduce((sum, n) => sum + n, 0);
  const concluded = byStatus.ACCEPTED + byStatus.DECLINED + byStatus.EXPIRED + byStatus.REVOKED;
  const acceptanceRate = concluded > 0 ? byStatus.ACCEPTED / concluded : 0;


  const now = Date.now();
  const oldestPending: OldestPendingRow[] = pendingRows.map((r) => ({
    invitationId: r.invitationId,
    email: r.email,
    memberRole: r.memberRole,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    ageDays: Math.max(0, Math.floor((now - r.createdAt.getTime()) / 86_400_000)),
  }));

  return { total, byStatus, acceptanceRate, pendingCount: byStatus.PENDING, oldestPending };
}
