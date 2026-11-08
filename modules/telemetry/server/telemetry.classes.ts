import { DEFAULT_LANE, DEFAULT_RETENTION_CLASS, RETENTION_CLASSES, type RetentionClass } from './telemetry.contract';

/**
 * The retention classes as tables (docs/phases/42-telemetry/00 §0.5, ED-9 lanes). Per lane and class `d` days there are:
 *
 *  - `<lane>_msg_r{d}`: one row per message, raw retention `RAW_DAYS[d]` days, hypertable, declared on `db:time_series` WITHOUT
 *    `rollups` (the generic rollups cannot unnest arrays);
 *  - `<lane>_1m_r{d}`: the 1-minute aggregates the lane's own job fills from the raw rows, retention `min(d, 31)` days, declared
 *    WITH the `rollups` `<lane>_1h_r{d}` and `<lane>_1d_r{d}` (retention `d` days) that `db` fills;
 *  - `<lane>_latest`, `<lane>_1m_state`, `<lane>_1m_dirty`: the latest value per entity and key, the minute job's watermarks and
 *    the dirty-minute hints of the lane.
 *
 * The default lane's prefix is `telemetry_`; another lane's is `telemetry_<lane>_`. The key dictionary (`telemetry_keys`) and
 * the class bindings (`telemetry_class_bindings`) are shared by every lane. A tenant's class for a kind is the kind's fixed
 * class or what its resolver says (plans); without either it is 30. Adding a class is one constant here and one migration.
 */
export const RAW_RETENTION_CAP_DAYS = 90;
export const MINUTE_RETENTION_CAP_DAYS = 31;
/**
 * Raw days per class (OD-156): raw messages are kept short and the rollups long. A raw row is ~350 bytes (measured, 8 keys),
 * ~170 GB a day at 5 555 msg/s, and an RLS table cannot be compressed; the class's full length is kept by the hour and day
 * rollups. The default class 30 keeps 7 days raw, 31 days of minutes and 30 days of hours and days.
 */
const RAW_DAYS: Readonly<Record<RetentionClass, number>> = { 7: 7, 30: 7, 90: 30, 365: 90, 1095: RAW_RETENTION_CAP_DAYS };

/** A lane name: short, lower-case, an identifier part (it goes into table names). */
export const LANE_NAME = /^[a-z][a-z0-9_]{0,15}$/;
export const KEYS_TABLE = 'telemetry_keys';
export const BINDINGS_TABLE = 'telemetry_class_bindings';

export function tablePrefix(lane: string = DEFAULT_LANE): string {
  if (!LANE_NAME.test(lane)) throw new Error(`[telemetry] "${lane}" is not a lane name`);
  return lane === DEFAULT_LANE ? 'telemetry_' : `telemetry_${lane}_`;
}

export const rawTableOf = (d: RetentionClass, lane: string = DEFAULT_LANE): string => `${tablePrefix(lane)}msg_r${d}`;
export const minuteTableOf = (d: RetentionClass, lane: string = DEFAULT_LANE): string => `${tablePrefix(lane)}1m_r${d}`;
export const hourTableOf = (d: RetentionClass, lane: string = DEFAULT_LANE): string => `${tablePrefix(lane)}1h_r${d}`;
export const dayTableOf = (d: RetentionClass, lane: string = DEFAULT_LANE): string => `${tablePrefix(lane)}1d_r${d}`;
export const latestTableOf = (lane: string = DEFAULT_LANE): string => `${tablePrefix(lane)}latest`;
export const stateTableOf = (lane: string = DEFAULT_LANE): string => `${tablePrefix(lane)}1m_state`;
export const dirtyTableOf = (lane: string = DEFAULT_LANE): string => `${tablePrefix(lane)}1m_dirty`;

export const rawRetentionDays = (d: RetentionClass): number => RAW_DAYS[d];
export const minuteRetentionDays = (d: RetentionClass): number => Math.min(d, MINUTE_RETENTION_CAP_DAYS);

export const DAY_MS = 86_400_000;

export function isRetentionClass(n: unknown): n is RetentionClass {
  return typeof n === 'number' && (RETENTION_CLASSES as readonly number[]).includes(n);
}

/** The smallest class at least `days`: 30 without a value, 1 095 at most. */
export function classForDays(days: number | null | undefined): RetentionClass {
  if (days === null || days === undefined || !Number.isFinite(days) || days <= 0) return DEFAULT_RETENTION_CLASS;
  return RETENTION_CLASSES.find((c) => c >= days) ?? RETENTION_CLASSES[RETENTION_CLASSES.length - 1];
}

/** The oldest record time the class still keeps raw, for `now` (rows older than this are refused as `too_old`). */
export const oldestRawTs = (d: RetentionClass, now: number): number => now - rawRetentionDays(d) * DAY_MS;
