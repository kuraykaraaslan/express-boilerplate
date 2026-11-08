import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type { ExportCollection, ExportCollectionProvider } from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { NotificationSmsOptOut } from './entities/notification_sms_optout.entity';

export const EXPORT_CAP = 5_000;

/**
 * `tenant_export:collection` contribution (D254): the tenant's SMS opt-out list, STOPs and the STARTs that took them back, newest first, capped at
 * `EXPORT_CAP` rows. Each row is a recipient's record of an objection to the tenant's messages: the number (E.164), the state, the keyword and when.
 * The column is `phone`, so a redacted export redacts it (tenant_export's PII field list). Kept on a subject's erasure (module.json: RETAIN).
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const rows = await withTenantRepositoryFor(tenantId, NotificationSmsOptOut, (repo) => repo.find({
    where: { tenantId }, order: { changedAt: 'DESC' }, take: EXPORT_CAP,
  }));
  return [{
    key: 'notificationSmsOptOuts',
    label: 'SMS opt-outs (STOP / START replies)',
    rows: rows.map((r) => ({ phone: r.phone, optedOut: r.optedOut, keyword: r.keyword, changedAt: r.changedAt, createdAt: r.createdAt })),
  }];
};

export default provider;
