import type { RollupDecl, TimeSeriesTable } from '@kuraykaraaslan-labs/db/server/db.time-series';
import { DEFAULT_LANE, RETENTION_CLASSES, type RetentionClass } from './telemetry.contract';
import { dayTableOf, hourTableOf, minuteRetentionDays, minuteTableOf, rawRetentionDays, rawTableOf } from './telemetry.classes';
import { rawChunkInterval } from './telemetry.chunk-interval';

/**
 * The `db:time_series` contribution (docs/phases/42-telemetry/00 §0.5–§0.6, ED-9, ED-15): per lane and retention class, the raw
 * message table (chunks sized by the install, raw retention at most 90 days, no `rollups`: the generic rollups cannot unnest
 * arrays) and the 1-minute table the lane's job fills, with its hour and day `rollups` that `db`'s job derives (`groupBy` entity
 * and key; avg = sum / count at read time). `db` makes them hypertables owned by the owner role behind `<table>_v`, creates the
 * rollup tables and applies the retention; nothing in `db` is specific to this module. No `compressAfter`: an RLS hypertable
 * cannot be compressed.
 *
 * The rollups keep the 1-minute columns under the generic naming `<column>_<aggregate>`: `sum_sum`, `count_sum`, `min_min`,
 * `max_max`, `last_last`. The hour rollup waits 5 minutes after the hour closes, so the minute job (which closes a minute
 * 2 minutes after its end) has written the last minute first; a minute recomputed later marks the hour dirty (`markRollupDirty`).
 *
 * Lanes (ED-9): the default lane, and `otel` for the OpenTelemetry metric series `observability` writes (docs/phases/42-telemetry/04
 * §4.2: its own tables and its own rollup run, so OTel volume never shares a table with IoT). A lane's class tables exist once the
 * lane is listed here and the deploy ran; its latest/state/dirty tables come from a migration (003 for `otel`); a kind of an unlisted
 * lane cannot write. An empty lane costs catalog rows only: a hypertable without rows has no chunks.
 */
export const MINUTE_VALUES: RollupDecl['values'] = { sum: ['sum'], count: ['sum'], min: ['min'], max: ['max'], last: ['last'] };
export const HOUR_ROLLUP_LAG = '5 minutes';
export const OTEL_LANE = 'otel';
export const TELEMETRY_LANES: readonly string[] = [DEFAULT_LANE, OTEL_LANE];

export function rawTableDecl(d: RetentionClass, lane: string = DEFAULT_LANE): TimeSeriesTable {
  return { table: rawTableOf(d, lane), timeColumn: 'ts', chunkInterval: rawChunkInterval(), retention: `${rawRetentionDays(d)} days`, tenantColumn: 'tenantId' };
}

export function minuteTableDecl(d: RetentionClass, lane: string = DEFAULT_LANE): TimeSeriesTable {
  return {
    table: minuteTableOf(d, lane), timeColumn: 'ts', chunkInterval: '1 day', retention: `${minuteRetentionDays(d)} days`, tenantColumn: 'tenantId',
    rollups: [
      { name: hourTableOf(d, lane), bucket: '1 hour', groupBy: ['entityId', 'keyId'], values: MINUTE_VALUES, retention: `${d} days`, lag: HOUR_ROLLUP_LAG },
      { name: dayTableOf(d, lane), bucket: '1 day', groupBy: ['entityId', 'keyId'], values: MINUTE_VALUES, retention: `${d} days` },
    ],
  };
}

export const TIME_SERIES_TABLES: TimeSeriesTable[] = TELEMETRY_LANES.flatMap((lane) => RETENTION_CLASSES.flatMap((d) => [rawTableDecl(d, lane), minuteTableDecl(d, lane)]));

export default TIME_SERIES_TABLES;
