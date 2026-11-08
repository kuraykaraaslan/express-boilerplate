import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { NotificationLog } from './entities/notification_log.entity';
import { openRow } from './notification_log.recipient';

const ROW_CAP = 5000;

/**
 * `tenant_export:collection` — what was sent to whom, and when.
 *
 * Handed over from `tenant_export`'s hand-written list (DEP-04). Ordered by
 * `sentAt` rather than `createdAt`, matching the built-in collector: a row is
 * created when the send is queued and the question this log answers is when it
 * actually went out.
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const rows = await withTenantRepositoryFor(tenantId, NotificationLog, (repo) => repo.find({
    where: { tenantId }, order: { sentAt: 'DESC' }, take: ROW_CAP,
  }));
  // The tenant's own export: recipients opened under its key (never another tenant's), the blind index left out.
  return [{ key: 'notificationLogs', label: 'Notification log', rows: await Promise.all(rows.map(openRow)) }];
};

export default provider;
