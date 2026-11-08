import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import type { AuditLog } from '@kuraykaraaslan-labs/audit_log/server/audit_log.types';
import { memberLabels } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service';
import type { ActivityQuery } from './activity.dto';

/**
 * The home's "Recent activity" (e2e run 1, E21 + V2-A1): the audit trail as a person reads it, not as it is stored.
 *
 *  - Machine events stay out (`HOME_FEED_HIDDEN_ACTIONS`): the PDP's decision log is the access-control screen's, not a feed of what
 *    people did. They are left out by the query itself, so every page is a page of readable rows. The rows stay in the audit trail.
 *  - Each row names its actor: a member by the label the workspace knows them by (their e-mail, `memberLabels`), never an id.
 *    `actorName` is null for an actor that is not a member (the system, an API key, someone who left); the page says which.
 *  - The page words the action (a phrase per known action, else "<module> activity") and the severity in the person's language.
 */
export const HOME_FEED_HIDDEN_ACTIONS: readonly string[] = [
  // the PDP's decision log (the access-control screen reads it)
  'abac.decision',
  // a display screen reading its board: one row per read of a screen nobody sits at
  'dashboard.display.read',
  // the sign-in's own steps (the sign-in itself is `auth.login` / `user_session.login`)
  'user_session.exchange',
  'user_session.handoff',
];

export interface ActivityRow {
  auditLogId: string;
  tenantId: string;
  /** The root's feed only: the tenant the row belongs to. */
  tenant?: { tenantId: string; name: string } | null;
  createdAt: string;
  action: string;
  severity: AuditLog['severity'];
  actorType: AuditLog['actorType'];
  actorId: string | null;
  /** The member's label (e-mail), or null when the actor is not a member of the row's tenant. */
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

type Row = AuditLog & { tenant?: { tenantId: string; name: string } | null };

/** The actors' labels, per tenant of the rows (the root's feed spans tenants); a lookup that fails names no one. */
async function actorNames(rows: readonly Row[]): Promise<Map<string, Record<string, string>>> {
  const byTenant = new Map<string, string[]>();
  for (const r of rows) {
    if (r.actorType !== 'USER' || !r.actorId) continue;
    byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r.actorId]);
  }
  const out = new Map<string, Record<string, string>>();
  await Promise.all([...byTenant].map(async ([tenantId, ids]) => {
    out.set(tenantId, await memberLabels(tenantId, ids).catch(() => ({} as Record<string, string>)));
  }));
  return out;
}

export function toActivityRow(r: Row, names: ReadonlyMap<string, Record<string, string>>): ActivityRow {
  const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string);
  return {
    auditLogId: r.auditLogId,
    tenantId: r.tenantId,
    ...(r.tenant !== undefined ? { tenant: r.tenant } : {}),
    createdAt: Number.isNaN(created.getTime()) ? new Date(0).toISOString() : created.toISOString(),
    action: r.action,
    severity: r.severity,
    actorType: r.actorType,
    actorId: r.actorId ?? null,
    actorName: r.actorType === 'USER' && r.actorId ? names.get(r.tenantId)?.[r.actorId] ?? null : null,
    resourceType: r.resourceType ?? null,
    resourceId: r.resourceId ?? null,
    ipAddress: r.ipAddress ?? null,
    userAgent: r.userAgent ?? null,
  };
}

/** One page of the feed: the tenant's own trail, or (the root) every tenant's. */
export async function activityPage(tenantId: string, crossTenant: boolean, q: ActivityQuery): Promise<{ rows: ActivityRow[]; total: number; hasMore?: boolean }> {
  const common = { action: q.search || undefined, severity: q.severity, excludeActions: [...HOME_FEED_HIDDEN_ACTIONS], page: q.page, pageSize: q.pageSize, sort: q.sort };
  const result = crossTenant
    ? await AuditLogService.queryCrossTenant(tenantId, { ...common, tenantId: q.filterTenantId })
    : { ...(await AuditLogService.getAll({ ...common, tenantId })), hasMore: undefined };
  const rows = result.logs as Row[];
  const names = await actorNames(rows);
  return { rows: rows.map((r) => toActivityRow(r, names)), total: result.total, ...(result.hasMore !== undefined ? { hasMore: result.hasMore } : {}) };
}
