import { z } from 'zod';

/**
 * PUT /api/ai-firewall/actions (docs/phases/55-ai-firewall/01 §1.8): one action's mode for the URL tenant.
 *
 * - `actionId`: a registered action id (`<module>.<verb>`, lower case; the same shape as the setting key family
 *   `aiFirewallMode:<actionId>` accepts). An id nobody registered is a 404 in the service.
 * - `mode`: `observe`, `suggest` or `auto`; null returns the action to the tenant's default mode (the row is removed).
 * - `confirmAuto`: must be `true` with `mode: 'auto'`, the server's half of the ConfirmDialog: a switch to Auto is never a side effect
 *   of a stray request or a replayed form.
 *
 * Strict: the tenant comes from the URL (the guard binds it), never from the body.
 */
export const ACTION_ID_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const ACTION_ID_MAX = 128;

export const ActionModeUpdateDTO = z.object({
  actionId: z.string().min(3).max(ACTION_ID_MAX).regex(ACTION_ID_RE),
  mode: z.enum(['observe', 'suggest', 'auto']).nullable(),
  confirmAuto: z.literal(true).optional(),
}).strict();
export type ActionModeUpdateInput = z.infer<typeof ActionModeUpdateDTO>;
