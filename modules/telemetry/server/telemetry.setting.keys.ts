import { z } from 'zod';

/**
 * The telemetry module's setting keys (2026-10-27). Installation settings, read ONLY from the ROOT tenant
 * (telemetry.settings-policy.ts): the minute rollup job serves every tenant from one scheduler, so its tuning is the
 * operator's, and a copy of a key in any other tenant is never read.
 */
export const TelemetrySettingKeySchema = z.enum([
  'telemetryRollupDbSharePercent',
  'telemetryRollupMaxSteps',
  'telemetryRollupFullSweepEvery',
]);
export type TelemetrySettingKey = z.infer<typeof TelemetrySettingKeySchema>;
export const TELEMETRY_SETTING_KEYS = TelemetrySettingKeySchema.options;
