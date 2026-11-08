import type { TenantKeyColumnSet } from '@kuraykaraaslan-labs/db/server/db.tenant-key-columns';

/**
 * webhook's columns under the tenant's data key (P7-TDEK, decision F16; point `db:tenant_key_columns`): the signing secret of an endpoint and the
 * previous one kept during a rotation's overlap. Sealed by webhook.crud.service.ts (create, rotate) and opened by webhook.secrets.ts on the
 * enqueue, redelivery and test-send paths.
 */
export const TENANT_KEY_COLUMNS: TenantKeyColumnSet[] = [
  { table: 'webhooks', idColumn: 'webhookId', columns: ['secret', 'previousSecret'], family: 'webhook signing secrets' },
];

export default TENANT_KEY_COLUMNS;
