// Shapes only: a type-only import keeps this contribution free of any runtime edge onto the host (EXT-14: contributing never requires).
import type { DashboardDataSource, DataSourceContext, DataSourceQueryDef, DataSourceResult, ResolvedQuery } from '@kuraykaraaslan-labs/dashboard/server/data-source.types';
import { ensureTelemetryKindsLoaded, registeredTelemetryKinds } from './telemetry.kinds';
import { getTelemetryQueryService, type SeriesAgg, type TelemetryQueryService } from './telemetry.query.service';
import { readableKind } from './telemetry.read';
import { localizedQueries } from './telemetry.words';

/**
 * `dashboard:data_source` contribution (docs/phases/42-telemetry/02 §2.3): `telemetry.latest` (one entity's latest values, as a
 * record) and `telemetry.series` (one or more keys over the board window, aggregated per bucket). Only kinds with
 * `exposeToDashboards` are offered; every execution asks the kind's `canRead` for the viewer (`ctx.userId`), so the queries are
 * cached per user, never tenant-wide. `dashboard` itself does not change.
 */
const DAY_MS = 86_400_000;
export const TELEMETRY_SOURCE_KEY = 'telemetry_store';

const AGGS: SeriesAgg[] = ['avg', 'min', 'max', 'last', 'sum', 'count', 'increase'];

function kindOptions(): Array<{ value: string; label: string }> {
  return registeredTelemetryKinds().filter((k) => k.exposeToDashboards === true).map((k) => ({ value: k.kind, label: k.label || k.kind })).sort((a, b) => a.value.localeCompare(b.value));
}

function queries(): DataSourceQueryDef[] {
  const kinds = kindOptions();
  const kind = { label: 'Kind', type: 'select' as const, options: kinds, value: kinds[0]?.value, required: true };
  const entityId = { label: 'Entity id', type: 'text' as const, required: true, placeholder: 'uuid' };
  return [
    {
      key: 'latest',
      label: 'Latest values of an entity',
      shape: 'record',
      requiredPermission: 'telemetry.read',
      params: { kind, entityId, keys: { label: 'Keys (empty = all, comma-separated)', type: 'text' } },
      defaultTtlSeconds: 15,
      cacheScope: 'user',
    },
    {
      key: 'series',
      label: 'Readings over time',
      shape: 'series',
      requiredPermission: 'telemetry.read',
      params: {
        kind, entityId,
        keys: { label: 'Keys (comma-separated)', type: 'text', required: true },
        agg: { label: 'Aggregate', type: 'select', options: AGGS.map((a) => ({ value: a, label: a })), value: 'avg' },
        days: { label: 'Window (days) when the board has none', type: 'number', min: 1, max: 365, value: 1 },
      },
      defaultTtlSeconds: 60,
      window: 'board',
      cacheScope: 'user',
    },
  ];
}

const splitKeys = (v: unknown): string[] => (typeof v === 'string' ? [...new Set(v.split(',').map((k) => k.trim()).filter(Boolean))] : []);

export function createTelemetryDashboardSource(service: () => TelemetryQueryService = getTelemetryQueryService): DashboardDataSource {
  return {
    key: TELEMETRY_SOURCE_KEY,

    async describe(ctx?: DataSourceContext): Promise<DataSourceQueryDef[]> {
      await ensureTelemetryKindsLoaded();
      return localizedQueries(queries(), ctx?.locale);
    },

    async execute(ctx: DataSourceContext, q: ResolvedQuery): Promise<DataSourceResult> {
      const fetchedAt = new Date().toISOString();
      const kind = typeof q.params.kind === 'string' ? q.params.kind : '';
      const entityId = typeof q.params.entityId === 'string' ? q.params.entityId.trim() : '';
      // the viewer must be allowed the entity; a refusal is an empty answer, the same as an entity that does not exist
      const k = kind && entityId ? await readableKind({ tenantId: ctx.tenantId, userId: ctx.userId, memberRole: ctx.memberRole }, kind, entityId) : null;
      if (q.queryKey === 'latest') {
        if (!k || k.exposeToDashboards !== true) return { shape: 'record', record: {}, fetchedAt };
        const keys = splitKeys(q.params.keys);
        const latest = await service().latest(ctx.tenantId, kind, entityId, keys.length ? keys : undefined);
        const record: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(latest)) record[key] = v.value;
        return { shape: 'record', record, fetchedAt };
      }
      if (q.queryKey === 'series') {
        const keys = splitKeys(q.params.keys);
        if (!k || k.exposeToDashboards !== true || !keys.length) return { shape: 'series', series: [], fetchedAt };
        const to = ctx.window ? Date.parse(ctx.window.to) : Date.now();
        const days = typeof q.params.days === 'number' && q.params.days >= 1 ? Math.min(365, q.params.days) : 1;
        const from = ctx.window ? Date.parse(ctx.window.from) : to - days * DAY_MS;
        const agg = AGGS.includes(q.params.agg as SeriesAgg) ? (q.params.agg as SeriesAgg) : 'avg';
        const series = await service().series(ctx.tenantId, kind, entityId, keys, { from, to, agg });
        return {
          shape: 'series',
          series: keys.map((key) => ({ name: key, points: (series[key] ?? []).map((p) => ({ t: new Date(p.ts).toISOString(), v: typeof p.value === 'number' ? p.value : Number(p.value) || 0 })) })),
          fetchedAt,
        };
      }
      throw new Error(`unknown telemetry dashboard query '${q.queryKey}'`);
    },
  };
}

const TelemetryDashboardSource = createTelemetryDashboardSource();
export default TelemetryDashboardSource;
