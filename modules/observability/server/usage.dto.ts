import { z } from 'zod'
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query'

/** Sortable columns of the usage list (root only): public field → path in a usage row. */
export const USAGE_SORTABLE = {
  name: 'name',
  probes: 'probes24h',
  monitors: 'monitors.used',
  slos: 'slos.used',
  integrations: 'integrations.used',
  alerts: 'openAlerts.used',
  telemetry: 'telemetryMbToday.used',
  statusPages: 'statusPages.used',
  subscribers: 'subscribers.used',
  series: 'activeSeriesToday.used',
} as const
export type UsageSortField = keyof typeof USAGE_SORTABLE

/** `GET /api/observability/usage`: the list contract. The older single words (`sort=alerts`) still mean "most first". */
export const ListUsageQuery = listQuerySchema({
  sortable: USAGE_SORTABLE,
  defaultSort: 'probes:desc',
  sortAliases: { probes: 'probes:desc', monitors: 'monitors:desc', alerts: 'alerts:desc', telemetry: 'telemetry:desc' },
  pageSize: { default: 100, max: 500 },
  filters: {
    /** Only workspaces with a meter at 80% of its limit or more. */
    nearLimit: listFilter.flag(),
    /** The older paging: `offset` rows in (with `limit`). */
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  },
})
export type ListUsageQuery = z.infer<typeof ListUsageQuery>
