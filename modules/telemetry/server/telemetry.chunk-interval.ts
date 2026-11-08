import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The chunk interval of the raw tables (docs/phases/42-telemetry/00 §0.6, ED-15). Sized by the install: one hour when the IoT
 * package is installed (at 5 555 msg/s an hour is ~20 M rows, the size whose index still fits the benchmark's memory), one day
 * otherwise (a Core install writing a few rows a second would hold ~10 000 near-empty hourly chunks across the five classes).
 * `TELEMETRY_CHUNK_INTERVAL_RAW` overrides it, from a fixed set (the env schema refuses anything else at boot). A changed value
 * reaches an existing hypertable through `set_chunk_time_interval` in db's deploy phase: forward-only, existing chunks keep
 * their size, nothing is moved or locked.
 */
export const RAW_CHUNK_INTERVALS = ['1 hour', '1 day', '7 days'] as const;
export type RawChunkInterval = (typeof RAW_CHUNK_INTERVALS)[number];
export const RAW_CHUNK_INTERVAL_ENV = 'TELEMETRY_CHUNK_INTERVAL_RAW';

/** Installed = the module directory is in the tree; the registry decides what is enabled, but the table shape is per install. */
export function iotPackageInstalled(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, 'modules', 'iot_telemetry', 'module.json'));
}

// eslint-disable-next-line no-restricted-syntax -- read in db's deploy phase, which runs before env validation (like DB_DEPLOY_MODE); env.schema.core.ts validates the value at boot
export function rawChunkInterval(env: Readonly<Record<string, string | undefined>> = process.env, cwd?: string): RawChunkInterval {
  const v = env[RAW_CHUNK_INTERVAL_ENV]?.trim();
  if (v) {
    if (!(RAW_CHUNK_INTERVALS as readonly string[]).includes(v)) {
      throw new Error(`[telemetry] ${RAW_CHUNK_INTERVAL_ENV}="${v}" is not one of ${RAW_CHUNK_INTERVALS.join(', ')}`);
    }
    return v as RawChunkInterval;
  }
  return iotPackageInstalled(cwd) ? '1 hour' : '1 day';
}
