import { z } from 'zod';

/**
 * The override route's input (docs/phases/55-ai-firewall/04-tree-models.md 4.7, FWD-12): `PUT /api/ai-firewall/models`. Strict: a ROOT
 * owner names the model and either holds it in shadow or releases the hold, with a reason for the audit row. There is no `promote`: the
 * gate alone promotes (a release only lets the next evaluation decide).
 */
export const MODEL_OVERRIDE_REASON_MAX = 200;

export const ModelOverrideDTO = z.object({
  model: z.enum(['behaviour', 'attack']),
  action: z.enum(['hold', 'release']),
  reason: z.string().trim().min(1).max(MODEL_OVERRIDE_REASON_MAX),
}).strict();
export type ModelOverrideInput = z.infer<typeof ModelOverrideDTO>;
