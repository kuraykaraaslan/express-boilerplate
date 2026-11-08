import { z } from 'zod';
import { KIND_NAME, MAX_KIND_LENGTH } from './telemetry.kinds';
import { KEY_CHARS, MAX_KEY_LENGTH } from './telemetry.rules';

/** The query strings of the read routes (docs/phases/42-telemetry/02 §2.2); every id is checked before any kind is asked. */
const kind = z.string().min(1).max(MAX_KIND_LENGTH).regex(KIND_NAME, 'not a kind name');
const entityId = z.string().uuid();
/** `keys=a,b,c`; at most 50 keys, each under the generic key rule. */
const keys = z.string().min(1).max(50 * (MAX_KEY_LENGTH + 1)).transform((s) => [...new Set(s.split(',').map((k) => k.trim()).filter(Boolean))])
  .refine((ks) => ks.length > 0 && ks.length <= 50 && ks.every((k) => KEY_CHARS.test(k) && k.length <= MAX_KEY_LENGTH), 'bad keys');
const epochMs = z.coerce.number().int().min(0).max(4_102_444_800_000);

export const TelemetryLatestQueryDTO = z.object({ kind, entityId, keys: keys.optional() });
export type TelemetryLatestQuery = z.infer<typeof TelemetryLatestQueryDTO>;

export const TelemetrySeriesQueryDTO = z.object({
  kind,
  entityId,
  keys,
  from: epochMs,
  to: epochMs,
  bucket: z.enum(['auto', 'raw', '1m', '1h', '1d']).default('auto'),
  agg: z.enum(['avg', 'min', 'max', 'last', 'sum', 'count', 'increase']).default('avg'),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
}).refine((q) => q.to > q.from, { message: 'to must be after from' });
export type TelemetrySeriesQuery = z.infer<typeof TelemetrySeriesQueryDTO>;
