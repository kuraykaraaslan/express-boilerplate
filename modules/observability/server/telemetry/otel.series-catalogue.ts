/**
 * The series catalogue of the OTel metrics adapter (docs/phases/42-telemetry/04 §4.2): which metric series a tenant has written to the Core
 * store, with their labels and (for a histogram) their bucket bounds. The store holds the numbers under the series' entity id; this table
 * answers label matching (`find`), the metric names of a range (`names`), the kind's read scope (`exists`) and erasure (`purge`).
 *
 * Identity: `seriesId = entityIdOf('observability.series', metric + the sorted labels)`; the labels are the point's resource and data-point
 * attributes as strings, never a key that names a tenant (the adapter stamps the tenant itself, 00 §0.4). Writes are batched per wave and
 * skipped for a series this process upserted less than `RECENT_MS` ago, so a steady sender costs the catalogue one row per series per ten
 * minutes, not per point.
 */
import { entityIdOf } from '@kuraykaraaslan-labs/telemetry/server/telemetry.kinds';
import { OtelSeries } from '../entities/otel_series.entity';
import { isTenantKey } from './telemetry.tenant';
import type { MetricKind, MetricPoint, MetricQuery } from './telemetry.types';
import { TENANT_ATTR, TENANT_LABEL } from './telemetry.types';
import { stringifyAttrs } from './telemetry.util';

export const SERIES_KIND = 'observability.series';
export const RECENT_MS = 10 * 60_000;
/** The most series one metric query reads from the store. */
export const MAX_SERIES_PER_QUERY = 500;

export interface SeriesIdentity {
  seriesId: string;
  metric: string;
  kind: MetricKind;
  unit: string | null;
  labels: Record<string, string>;
  bounds: number[] | null;
}

/** A series with the time span of the points a wave carried for it (the points' own times, not the write time). */
export interface SeriesSeen extends SeriesIdentity {
  firstMs: number;
  lastMs: number;
}

export interface SeriesRow extends SeriesIdentity {
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface SeriesCatalogue {
  /** Remember these series: a new row takes the span as first and last seen; a known row widens its span and takes new bounds and unit. */
  upsert(tenantId: string, series: readonly SeriesSeen[]): Promise<void>;
  /** The series of a metric that match the filters, at most `limit`, in a stable order. */
  find(tenantId: string, metric: string, filters: MetricQuery['filters'], limit: number): Promise<SeriesRow[]>;
  /** The metric names seen inside the range, sorted. */
  names(tenantId: string, range: { fromMs: number; toMs: number }): Promise<string[]>;
  /** Which of these series ids the tenant has. */
  exists(tenantId: string, seriesIds: readonly string[]): Promise<Set<string>>;
  /** Every row of the tenant. Returns how many went. */
  purge(tenantId: string): Promise<number>;
}

/** The series a point belongs to: its metric and its labels (resource first, a data-point attribute of the same name wins), tenant keys removed. */
export function seriesIdentityOf(p: MetricPoint): SeriesIdentity {
  const merged = stringifyAttrs({ ...p.resource, ...p.attributes });
  const labels: Record<string, string> = {};
  for (const k of Object.keys(merged).sort()) if (k !== TENANT_ATTR && k !== TENANT_LABEL && !isTenantKey(k)) labels[k] = merged[k]!;
  const canonical = `${p.name}\u0000${Object.entries(labels).map(([k, v]) => `${k}=${v}`).join('\u0001')}`;
  return {
    seriesId: entityIdOf(SERIES_KIND, canonical), metric: p.name, kind: p.kind, unit: p.unit ?? null, labels,
    bounds: p.kind === 'histogram' && p.histogram ? [...p.histogram.bounds] : null,
  };
}

/** The label match of one query filter against a row's labels (an absent label matches `neq` only). */
export function matchesFilters(labels: Record<string, string>, filters: MetricQuery['filters']): boolean {
  for (const f of filters) {
    const v = labels[f.field];
    if (f.op === 'eq' ? v !== f.value : v === f.value) return false;
  }
  return true;
}

/** The tenant chokepoints, loaded when first used: this file is imported by the backend configuration, which must not open the database at import time. */
const db = () => import('@kuraykaraaslan-labs/db');

/** The catalogue in the tenant's database rows (`otel_series`), through the tenant chokepoint. */
export class TypeormSeriesCatalogue implements SeriesCatalogue {
  private readonly recent = new Map<string, { at: number; firstMs: number }>();

  async upsert(tenantId: string, series: readonly SeriesSeen[]): Promise<void> {
    const now = Date.now();
    const fresh = new Map<string, SeriesSeen>();
    for (const s of series) {
      const k = `${tenantId}|${s.seriesId}`;
      const last = this.recent.get(k);
      // a series this process wrote less than RECENT_MS ago is skipped unless the wave carries a bound change or older points (a backfill)
      if (last !== undefined && now - last.at < RECENT_MS && !s.bounds && s.firstMs >= last.firstMs) continue;
      const have = fresh.get(s.seriesId);
      fresh.set(s.seriesId, have ? { ...s, firstMs: Math.min(have.firstMs, s.firstMs), lastMs: Math.max(have.lastMs, s.lastMs) } : s);
    }
    if (!fresh.size) return;
    const rows = [...fresh.values()];
    const { withTenantTransactionFor } = await db();
    await withTenantTransactionFor(tenantId, async (qr) => {
      // one statement per wave: the arrays are unnested into rows; a known series widens its span and takes the newest bounds and unit
      await qr.manager.query(
        `INSERT INTO "otel_series" ("tenantId", "seriesId", "metric", "kind", "unit", "labels", "bounds", "firstSeenAt", "lastSeenAt")
         SELECT $1, s.id, s.metric, s.kind, s.unit, s.labels::jsonb, s.bounds::jsonb, s.first, s.last
           FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[], $9::timestamptz[]) AS s(id, metric, kind, unit, labels, bounds, first, last)
         ON CONFLICT ("tenantId", "seriesId") DO UPDATE SET
           "firstSeenAt" = LEAST("otel_series"."firstSeenAt", EXCLUDED."firstSeenAt"),
           "lastSeenAt" = GREATEST("otel_series"."lastSeenAt", EXCLUDED."lastSeenAt"),
           "bounds" = COALESCE(EXCLUDED."bounds", "otel_series"."bounds"),
           "unit" = COALESCE(EXCLUDED."unit", "otel_series"."unit")`,
        [
          tenantId, rows.map((r) => r.seriesId), rows.map((r) => r.metric), rows.map((r) => r.kind), rows.map((r) => r.unit), rows.map((r) => JSON.stringify(r.labels)),
          rows.map((r) => (r.bounds ? JSON.stringify(r.bounds) : null)), rows.map((r) => new Date(r.firstMs)), rows.map((r) => new Date(r.lastMs)),
        ],
      );
    });
    for (const r of rows) this.recent.set(`${tenantId}|${r.seriesId}`, { at: now, firstMs: Math.min(r.firstMs, this.recent.get(`${tenantId}|${r.seriesId}`)?.firstMs ?? Infinity) });
    if (this.recent.size > 200_000) this.recent.clear();
  }

  async find(tenantId: string, metric: string, filters: MetricQuery['filters'], limit: number): Promise<SeriesRow[]> {
    const { withTenantRepositoryFor } = await db();
    const rows = await withTenantRepositoryFor(tenantId, OtelSeries, (repo) => {
      const qb = repo.createQueryBuilder('s').where('s.tenantId = :tenantId AND s.metric = :metric', { tenantId, metric });
      filters.forEach((f, i) => {
        if (f.op === 'eq') qb.andWhere(`s.labels @> :eq${i}::jsonb`, { [`eq${i}`]: JSON.stringify({ [f.field]: f.value }) });
        else qb.andWhere(`(s.labels ->> :nf${i}) IS DISTINCT FROM :nv${i}`, { [`nf${i}`]: f.field, [`nv${i}`]: f.value });
      });
      return qb.orderBy('s.seriesId', 'ASC').limit(Math.max(1, limit)).getMany();
    });
    return rows.map(toRow);
  }

  async names(tenantId: string, range: { fromMs: number; toMs: number }): Promise<string[]> {
    const { withTenantRepositoryFor } = await db();
    const rows = await withTenantRepositoryFor(tenantId, OtelSeries, (repo) => repo.createQueryBuilder('s')
      .select('DISTINCT s.metric', 'metric')
      .where('s.tenantId = :tenantId AND s.lastSeenAt >= :from AND s.firstSeenAt < :to', { tenantId, from: new Date(range.fromMs), to: new Date(range.toMs) })
      .orderBy('metric', 'ASC')
      .getRawMany<{ metric: string }>());
    return rows.map((r) => r.metric);
  }

  async exists(tenantId: string, seriesIds: readonly string[]): Promise<Set<string>> {
    if (!seriesIds.length) return new Set();
    const { withTenantRepositoryFor } = await db();
    const rows = await withTenantRepositoryFor(tenantId, OtelSeries, (repo) => repo.createQueryBuilder('s')
      .select('s.seriesId', 'seriesId')
      .where('s.tenantId = :tenantId AND s.seriesId IN (:...ids)', { tenantId, ids: [...seriesIds] })
      .getRawMany<{ seriesId: string }>());
    return new Set(rows.map((r) => String(r.seriesId).toLowerCase()));
  }

  async purge(tenantId: string): Promise<number> {
    for (const k of [...this.recent.keys()]) if (k.startsWith(`${tenantId}|`)) this.recent.delete(k);
    const { withTenantRepositoryFor } = await db();
    const r = await withTenantRepositoryFor(tenantId, OtelSeries, (repo) => repo.delete({ tenantId }));
    return r.affected ?? 0;
  }
}

function toRow(r: OtelSeries): SeriesRow {
  return {
    seriesId: String(r.seriesId).toLowerCase(), metric: r.metric, kind: r.kind as MetricKind, unit: r.unit ?? null, labels: r.labels ?? {},
    bounds: Array.isArray(r.bounds) ? r.bounds.map(Number) : null, firstSeenAt: new Date(r.firstSeenAt).getTime(), lastSeenAt: new Date(r.lastSeenAt).getTime(),
  };
}

/** An in-memory catalogue with the same semantics (tests; the adapter's database test pairs it with the real store). */
export function memorySeriesCatalogue(): SeriesCatalogue & { rows: Map<string, Map<string, SeriesRow>> } {
  const rows = new Map<string, Map<string, SeriesRow>>();
  const of = (t: string) => rows.get(t) ?? rows.set(t, new Map()).get(t)!;
  return {
    rows,
    async upsert(tenantId, series) {
      const m = of(tenantId);
      for (const s of series) {
        const have = m.get(s.seriesId);
        if (have) {
          have.firstSeenAt = Math.min(have.firstSeenAt, s.firstMs); have.lastSeenAt = Math.max(have.lastSeenAt, s.lastMs);
          if (s.bounds) have.bounds = s.bounds;
          if (s.unit) have.unit = s.unit;
        } else {
          const { firstMs, lastMs, ...rest } = s;
          m.set(s.seriesId, { ...rest, firstSeenAt: firstMs, lastSeenAt: lastMs });
        }
      }
    },
    async find(tenantId, metric, filters, limit) {
      return [...(rows.get(tenantId)?.values() ?? [])].filter((r) => r.metric === metric && matchesFilters(r.labels, filters)).sort((a, b) => a.seriesId.localeCompare(b.seriesId)).slice(0, limit);
    },
    async names(tenantId, range) {
      return [...new Set([...(rows.get(tenantId)?.values() ?? [])].filter((r) => r.lastSeenAt >= range.fromMs && r.firstSeenAt < range.toMs).map((r) => r.metric))].sort();
    },
    async exists(tenantId, ids) {
      const m = rows.get(tenantId);
      return new Set(ids.map((i) => i.toLowerCase()).filter((i) => m?.has(i)));
    },
    async purge(tenantId) {
      const n = rows.get(tenantId)?.size ?? 0;
      rows.delete(tenantId);
      return n;
    },
  };
}

let catalogue: SeriesCatalogue | null = null;
/** The process's catalogue (the tenant's rows). */
export function getSeriesCatalogue(): SeriesCatalogue {
  catalogue ??= new TypeormSeriesCatalogue();
  return catalogue;
}
/** Tests and wiring: another catalogue (`undefined` goes back to the rows). */
export function setSeriesCatalogue(c: SeriesCatalogue | undefined): void { catalogue = c ?? null; }
