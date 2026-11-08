import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { TenantMember } from './entities/tenant_member.entity'

// Type-only import: contributing to `dashboard:countable` never requires the
// host (EXT-14).
import type { DashboardCountable } from '@kuraykaraaslan-labs/dashboard/server/data-source.types'

const countables: DashboardCountable[] = [
  {
    key: 'members',
    label: 'Members',
    requiredPermission: 'members.view',
    async count(tenantId: string): Promise<number> {
      return withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.count({ where: { tenantId } }))
    },
  },
]

export default countables
