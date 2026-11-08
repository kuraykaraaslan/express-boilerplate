import { sampleSources } from '@kuraykaraaslan-labs/common/server/widget-settings/sample/sample-data'
import type { SlotData } from '@kuraykaraaslan-labs/common/server/widget-settings/kind'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { DEFAULT_PAGE_SIZE } from './query-paging'
import type { ColumnMeta, DashboardDataSource, DataSourceContext, DataSourceQueryDef, DataSourceResult, ResolvedQuery } from './data-source.types'
import type { FieldSchema } from '@kuraykaraaslan-labs/common/server/schema-form.types'

/**
 * A 10,000-row table that pages, sorts and searches ON THE SERVER (phase 18.1): the demo of a source
 * declaring `paging`. Each row is a pure function of its index, so an unsorted, unsearched page is
 * computed for exactly its slice; a sorted or searched page works over the full set, built once per
 * process and kept (it never changes, and 10,000 small rows are cheap to hold).
 */
export const PAGED_QUERY_KEY = 'sample.paged_rows'
export const PAGED_TOTAL = 10_000
const PAGED_SORTABLE = ['id', 'name', 'value']
const ADJECTIVES = ['Amber', 'Brisk', 'Cobalt', 'Dusty', 'Ember', 'Frost', 'Granite', 'Hollow']
const NOUNS = ['Valve', 'Pump', 'Sensor', 'Relay', 'Meter', 'Gate', 'Motor', 'Panel', 'Drive', 'Fan', 'Tank', 'Coil']
const STATUSES = ['Online', 'Online', 'Online', 'Warning', 'Online', 'Offline']

type PagedRow = { id: number; name: string; value: number; status: string }

function pagedRow(index: number): PagedRow {
  const id = index + 1
  return {
    id,
    // Adjective and noun move at different rates (every combination occurs), so sorting by name really reorders the ids.
    name: `${ADJECTIVES[index % ADJECTIVES.length]} ${NOUNS[Math.floor(index / ADJECTIVES.length) % NOUNS.length]} ${String(id).padStart(5, '0')}`,
    value: ((id * 7919) % 9973) / 10,
    status: STATUSES[(index * 3) % STATUSES.length],
  }
}

let allPagedRows: PagedRow[] | null = null
const pagedRows = () => (allPagedRows ??= Array.from({ length: PAGED_TOTAL }, (_, i) => pagedRow(i)))

function pagedResult(ctx: DataSourceContext): DataSourceResult {
  // The runner always resolves a page for a paged query; a direct call without one gets the first page.
  const paging = ctx.paging ?? { page: 1, pageSize: DEFAULT_PAGE_SIZE, offset: 0 }
  let rows: PagedRow[]
  let total = PAGED_TOTAL
  if (!paging.sort && !paging.q) {
    const end = Math.min(paging.offset + paging.pageSize, PAGED_TOTAL)
    rows = []
    for (let i = paging.offset; i < end; i++) rows.push(pagedRow(i))
  } else {
    let set = pagedRows()
    const q = paging.q?.toLowerCase()
    if (q) set = set.filter((r) => r.name.toLowerCase().includes(q) || r.status.toLowerCase().includes(q))
    const sort = paging.sort
    if (sort) {
      const key = sort.key as keyof PagedRow
      const sign = sort.dir === 'asc' ? 1 : -1
      set = [...set].sort((a, b) => (a[key] < b[key] ? -sign : a[key] > b[key] ? sign : a.id - b.id))
    }
    total = set.length
    rows = set.slice(paging.offset, paging.offset + paging.pageSize)
  }
  return {
    shape: 'table',
    columns: [
      { key: 'id', label: '#', type: 'number' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'value', label: 'Value', type: 'number', unit: 'kPa', decimals: 1, kind: 'number' },
      {
        key: 'status', label: 'Status', type: 'text', kind: 'enum',
        valueMap: { Online: { label: 'Online', color: 'var(--success)' }, Warning: { label: 'Warning', color: 'var(--warning)' }, Offline: { label: 'Offline', color: 'var(--error)' } },
      },
    ],
    rows,
    total,
    fetchedAt: new Date().toISOString(),
    ttlSeconds: 30,
  }
}

/** The meta a sample result carries, in the shape `describe()` declares it (see `DataSourceQueryDef.meta`). */
function declaredMeta(data: SlotData): Record<string, ColumnMeta> | undefined {
  const out: Record<string, ColumnMeta> = {}
  if (data.shape === 'scalar' && data.meta) out.value = data.meta
  // A record's fields: what the source says about each (label, unit, value words), so a form over it shows them.
  if (data.shape === 'record' && data.recordMeta) Object.assign(out, data.recordMeta)
  for (const s of data.series ?? []) if (s.meta) out[s.name] = s.meta
  for (const c of data.columns ?? []) {
    const meta: ColumnMeta = Object.fromEntries(
      Object.entries({ unit: c.unit, decimals: c.decimals, valueMap: c.valueMap, kind: c.kind, direction: c.direction }).filter(([, v]) => v !== undefined),
    )
    if (Object.keys(meta).length) out[c.key] = meta
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * "Sample data" (phase 21): every shape a widget can bind to — scalars, time series, tables, a record,
 * map points, events, slices, heat cells — generated deterministically around "now" by kui-react
 * WidgetKit (vendored). A board can be built and judged before real data exists, and every builtin
 * widget has something meaningful to show. Labels start with "Sample ·" so nobody mistakes it for real
 * data. It reads nothing from the tenant, so it needs only the right to run dashboard queries.
 */
const SampleDataSource: DashboardDataSource = {
  key: 'sample',

  async describe(_ctx: DataSourceContext): Promise<DataSourceQueryDef[]> {
    const queries: DataSourceQueryDef[] = sampleSources().map((s) => ({
      key: s.key,
      label: s.label,
      shape: s.data.shape,
      requiredPermission: 'dashboard.query.execute',
      // Phase 29: the device a detail page shows (`{ $param: 'device' }`); empty = the one sample device, as before.
      params: PER_DEVICE.has(s.key) ? DEVICE_PARAM : s.key === 'sample.devices' ? SITE_PARAM : {},
      defaultTtlSeconds: 30,
      cacheScope: 'tenant' as const,
      ...(declaredMeta(s.data) ? { meta: declaredMeta(s.data) } : {}),
    }))
    queries.push({
      key: PAGED_QUERY_KEY,
      label: 'Sample · 10,000 rows (server paged)',
      shape: 'table',
      requiredPermission: 'dashboard.query.execute',
      params: {},
      defaultTtlSeconds: 30,
      cacheScope: 'tenant',
      meta: declaredMeta(pagedResult({ tenantId: '', userId: '', locale: 'en', vars: {} })),
      paging: { maxPageSize: 100, defaultPageSize: DEFAULT_PAGE_SIZE, sortable: PAGED_SORTABLE, searchable: true },
    })
    return queries
  },

  async execute(ctx: DataSourceContext, q: ResolvedQuery): Promise<DataSourceResult> {
    if (q.queryKey === PAGED_QUERY_KEY) return pagedResult(ctx)
    const all = sampleSources()
    const sample = all.find((s) => s.key === q.queryKey)
    if (!sample) throw new AppError(MSG.QUERY_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    const device = typeof q.params?.device === 'string' ? q.params.device.trim() : ''
    const site = typeof q.params?.site === 'string' ? q.params.site.trim() : ''
    const found = device && PER_DEVICE.has(sample.key) ? forDevice(sample, device, all)
      : site && sample.key === 'sample.devices' ? atSite(sample, site)
      : sample
    const { shape, value, series, columns, rows, record, recordMeta } = found.data
    return {
      shape,
      ...(value !== undefined ? { value: value as number | string | null } : {}),
      ...(series ? { series } : {}),
      ...(columns ? { columns } : {}),
      ...(rows ? { rows } : {}),
      ...(record ? { record } : {}),
      ...(recordMeta ? { recordMeta } : {}),
      fetchedAt: new Date().toISOString(),
      ttlSeconds: 30,
    }
  },
}

export default SampleDataSource

/**
 * Sample queries that answer for one device when a board passes one (phase 29: a Device page opened from a row of
 * `sample.devices`): its details, its temperature and its events. Deterministic, so a page shows the same for the
 * same device, and still clearly sample data.
 */
const PER_DEVICE = new Set(['sample.device', 'sample.temperature.series', 'sample.events'])
const DEVICE_PARAM: Record<string, FieldSchema> = { device: { label: 'Device (name or id, empty = the sample one)', type: 'text' } }
/** Phase 29: the sample devices of one site (a Site page opened from a map marker); empty = every device. */
const SITE_PARAM: Record<string, FieldSchema> = { site: { label: 'Site (name or id, empty = every site)', type: 'text' } }

function atSite(sample: Sample, site: string): Sample {
  const wanted = site.toLowerCase()
  const rows = ((sample.data.rows ?? []) as Array<Record<string, unknown>>).filter((r) => String(r.site).toLowerCase() === wanted)
  return { ...sample, data: { ...sample.data, rows } }
}

type Sample = ReturnType<typeof sampleSources>[number]

/** A small stable number for a device name, so each device looks a little different. */
function deviceSeed(device: string): number {
  let h = 0
  for (const ch of device.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

function forDevice(sample: Sample, device: string, all: Sample[]): Sample {
  const devices = (all.find((s) => s.key === 'sample.devices')?.data.rows ?? []) as Array<Record<string, unknown>>
  const row = devices.find((r) => String(r.name).toLowerCase() === device.toLowerCase() || String(r.id).toLowerCase() === device.toLowerCase())
  const name = row ? String(row.name) : device
  const site = row ? String(row.site) : ''
  const where = site ? `${name} · ${site}` : name
  const seed = deviceSeed(name)
  if (sample.key === 'sample.device' && sample.data.record) {
    return {
      ...sample,
      data: {
        ...sample.data,
        record: {
          ...sample.data.record,
          serialNumber: `NX-200-${String(seed % 100_000).padStart(5, '0')}`,
          ...(row ? { site, temperature: row.temperature, battery: row.battery } : {}),
          uptimeHours: 200 + (seed % 2000),
        },
      },
    }
  }
  if (sample.key === 'sample.temperature.series' && sample.data.series) {
    // The same curve, moved to the device's own level: its reading is the last point.
    const target = typeof row?.temperature === 'number' ? row.temperature : 18 + (seed % 90) / 10
    return {
      ...sample,
      data: {
        ...sample.data,
        series: sample.data.series.map((line) => {
          const last = line.points.at(-1)?.v ?? target
          const shift = target - last
          return { ...line, name: `${line.name} · ${name}`, points: line.points.map((p) => ({ ...p, v: Math.round((p.v + shift) * 10) / 10 })) }
        }),
      },
    }
  }
  if (sample.key === 'sample.events' && sample.data.rows) {
    const own = (sample.data.rows as Array<Record<string, unknown>>).filter((r) => String(r.description ?? '').toLowerCase().includes(name.toLowerCase()))
    const now = Date.now()
    const made = own.length > 0 ? own : [
      { time: new Date(now - (5 + (seed % 50)) * 60_000).toISOString(), title: 'Reading received', description: where, color: 'info' },
      { time: new Date(now - (90 + (seed % 300)) * 60_000).toISOString(), title: seed % 2 ? 'Check passed' : 'Back to normal', description: where, color: 'success' },
      { time: new Date(now - (600 + (seed % 900)) * 60_000).toISOString(), title: 'Firmware 2.4.1 installed', description: where, color: 'info' },
    ]
    return { ...sample, data: { ...sample.data, rows: made } }
  }
  return sample
}
