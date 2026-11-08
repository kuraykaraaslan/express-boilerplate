import { z } from 'zod';

/**
 * The installation's rate-limit and ban tightening (limiter.settings-policy.ts). Stored on and read from the ROOT tenant only; each
 * can only make a limit stricter than the built-in value (a lower rate or threshold, a longer ban), never looser.
 */
export const LimiterSettingKeySchema = z.enum([
  'limiterAuthPerMinute',
  'limiterLoginPerMinute',
  'limiterStrikeThreshold',
  'limiterBanBaseMinutes',
  'limiterApiPerMinute',
]);
export type LimiterSettingKey = z.infer<typeof LimiterSettingKeySchema>;
export const LIMITER_SETTING_KEYS = LimiterSettingKeySchema.options;
