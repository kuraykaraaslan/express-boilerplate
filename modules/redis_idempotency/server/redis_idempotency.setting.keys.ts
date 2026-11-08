import { z } from 'zod';

/**
 * How long the installation keeps Idempotency-Key claims (redis_idempotency.settings-policy.ts). Stored on and read from the ROOT
 * tenant only; each can only lengthen the built-in time (a duplicate is refused for longer), never shorten it.
 */
export const RedisIdempotencySettingKeySchema = z.enum([
  'idempotencyReplayHours',
  'idempotencyPendingMinutes',
]);
export type RedisIdempotencySettingKey = z.infer<typeof RedisIdempotencySettingKeySchema>;
export const REDIS_IDEMPOTENCY_SETTING_KEYS = RedisIdempotencySettingKeySchema.options;
