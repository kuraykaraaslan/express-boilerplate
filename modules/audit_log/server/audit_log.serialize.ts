import type { AuditLog } from './audit_log.types';

/** Serialize rows to NDJSON (one JSON object per line). */
export function serializeForArchive(rows: AuditLog[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

/** Serialize rows to CSV with a fixed column order and RFC-4180 escaping. */
export function serializeForCsv(rows: AuditLog[]): string {
  const cols: (keyof AuditLog)[] = [
    'auditLogId', 'tenantId', 'actorId', 'actorType', 'onBehalfOfActorId',
    'action', 'severity', 'resourceType', 'resourceId', 'ipAddress', 'userAgent', 'createdAt',
  ];
  // audit_log.03 (fixed 2026-10-20): a cell opening with a formula character (= + - @, tab, CR) gets a leading apostrophe, so a
  // spreadsheet shows it as text instead of executing it; a bare CR is quoted like a newline (it could split the record).
  const esc = (v: unknown): string => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (!(v instanceof Date) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => esc(r[c])).join(','));
  return [header, ...lines].join('\n');
}
