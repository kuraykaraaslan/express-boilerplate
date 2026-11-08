import type { TenantKeyColumnSet } from '@kuraykaraaslan-labs/db/server/db.tenant-key-columns';

/**
 * notification_log's column under the tenant's data key (P7-TDEK, decision F16; point `db:tenant_key_columns`): the recipient of a delivery (an
 * e-mail address, a phone number or a user id). Sealed by notification_log.write.service.ts `log` with its blind index in `recipientHash`, opened
 * by the read service and the tenant export (notification_log.recipient.ts). A scrubbed row holds `[redacted]`, which stays as it is.
 */
export const TENANT_KEY_COLUMNS: TenantKeyColumnSet[] = [
  { table: 'notification_logs', idColumn: 'notificationLogId', columns: ['recipient'], family: 'notification recipients (e-mail addresses, phone numbers)',
    blindIndexes: [{ column: 'recipientHash', of: 'recipient', purpose: 'notification_log.recipient' }],
    skipValues: ['[redacted]'] },
];

export default TENANT_KEY_COLUMNS;
