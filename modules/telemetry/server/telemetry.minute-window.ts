/**
 * The clock of the 1-minute aggregates, shared by the writer (which leaves a dirty-minute hint for late rows) and the minute job
 * (which aggregates closed minutes). A minute is closed `MINUTE_JOB_LAG_MS` after its end: rows that arrive later than that for a
 * minute are late, and the writer's hint makes the job recompute that minute (00 P0-T-07b, 02 P0-T-08b). Buckets are UTC minutes
 * aligned to the epoch, which is `date_bin('1 minute', ts, '2000-01-01')` too.
 */
export const MINUTE_MS = 60_000;
export const MINUTE_JOB_LAG_MS = 2 * MINUTE_MS;

/** The newest minute edge before which every minute counts as closed at `now`. */
export const closedMinuteEdge = (now: number): number => Math.floor((now - MINUTE_JOB_LAG_MS) / MINUTE_MS) * MINUTE_MS;
