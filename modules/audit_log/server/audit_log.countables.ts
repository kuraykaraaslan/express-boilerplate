import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AuditLog } from './entities/audit_log.entity'

// Type-only import: contributing to `dashboard:countable` never requires the
// host (EXT-14).
import type { DashboardCountable } from '@kuraykaraaslan-labs/dashboard/server/data-source.types'

// `scope: 'system'` in module.json keeps this off every tenant's "at a
// glance" card and reserves it for the root tenant's own audit trail —
// `audit_log.logs.read` is a normal TENANT-floor permission, so the gate
// that actually matters here is discoverability, not the permission check.
const countables: DashboardCountable[] = [
  {
    key: 'auditLogs',
    label: 'Audit Logs',
    requiredPermission: 'audit_log.logs.read',
    async count(tenantId: string): Promise<number> {
      return withTenantRepositoryFor(tenantId, AuditLog, (repo) => repo.count({ where: { tenantId } }))
    },
  },
]

export default countables
