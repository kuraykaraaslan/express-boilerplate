import { z } from 'zod';

// Canonical per-tenant setting keys for the audit_log module. Centralised so the
// service (runtime enforcement: retention purge) and the settings-fields file
// (admin UI) never drift apart.
//
// auditLogRetentionDays — number of days to keep audit rows before they become
//   eligible for the retention purge. 0 (the default) = keep forever, matching
//   the module's historical keep-forever behaviour.
// auditLogMaxPageSize — per-tenant cap on `GET /audit-logs` pageSize. Tenants
//   with heavier admin tooling can raise it (up to AUDIT_LOG_PAGE_SIZE_HARD_CAP);
//   unset/invalid falls back to AUDIT_LOG_DEFAULT_MAX_PAGE_SIZE, matching the
//   module's historical fixed cap of 100.
export const AuditLogSettingKeySchema = z.enum([
  'auditLogRetentionDays',
  'auditLogMaxPageSize',
]);
export type AuditLogSettingKey = z.infer<typeof AuditLogSettingKeySchema>;
export const AUDIT_LOG_SETTING_KEY_LIST = AuditLogSettingKeySchema.options;

// Ergonomic named accessors, kept in lockstep with the enum via `satisfies`.
export const AUDIT_LOG_SETTING_KEYS = {
  RETENTION_DAYS: 'auditLogRetentionDays',
  MAX_PAGE_SIZE: 'auditLogMaxPageSize',
} as const satisfies Record<string, AuditLogSettingKey>;

// Sentinel used when a tenant has no retention setting → keep forever.
export const RETENTION_KEEP_FOREVER = 0;

// pageSize cap defaults/bounds for GET /audit-logs.
export const AUDIT_LOG_DEFAULT_MAX_PAGE_SIZE = 100;
export const AUDIT_LOG_PAGE_SIZE_HARD_CAP = 500;
