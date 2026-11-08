import { z } from 'zod';

/**
 * `G` strictness: only enum / bounded number / hash / uuid values may travel in results and telemetry.
 * No free strings. Free text stays in the node's own log keyed by commandJti.
 */
export const RESULT_CODES = [
  'OK', 'REJECTED', 'FAILED', 'EXPIRED', 'VETOED', 'UNSUPPORTED', 'PARTIAL', 'NOOP',
] as const;
export const ResultCodeSchema = z.enum(RESULT_CODES);

const enumKey = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const objectKey = z.string().regex(/^[A-Za-z0-9._\/-]{1,256}$/);

export const GResultSchema = z
  .object({
    code: ResultCodeSchema,
    counts: z.record(enumKey, z.number().int().nonnegative().max(2 ** 40)).optional(),
    hashes: z.record(enumKey, sha256).optional(),
    keys: z.array(objectKey).max(50).optional(),
  })
  .strict();
export type GResult = z.infer<typeof GResultSchema>;
