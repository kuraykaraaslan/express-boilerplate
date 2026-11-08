import { z } from 'zod';
import { ACTOR_KINDS } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { ATTACK_CLASSES } from './labels/ai_firewall.label-model';

/**
 * The incident routes' input (docs/phases/55-ai-firewall/02 §2.4). Strict: the tenant comes from the URL (the guard binds it), never
 * from a body or a query.
 *
 * - `IncidentIdParam`: the incident in the path, a uuid.
 * - `IncidentChangeDTO` (PATCH): `acknowledge`, `resolve` with a reason (`resolved` or `false_positive`; `expired` is the grouping's
 *   own), or `reopen`. The page confirms a resolve in a ConfirmDialog first; the server needs no flag for it (a resolve is undone by a
 *   reopen).
 * - `IncidentLabelDTO` (PUT .../label, 03 §3.2): a person's verdict: `true_positive` with its attack class (a detector's id or `other`;
 *   `benign` is a false positive and `honeytoken_touch` the system's), `false_positive`, or `unsure`. Nothing else: who labelled, when, the
 *   confidence, the source and the incident's detectors are the server's.
 * - `ActorQueryDTO` (GET /api/ai-firewall/actors): the actor kind and its id as the incident names it (a user, session or key uuid, a
 *   device or node id, an address). Bounded and charset-limited: an id is never a path, a pattern or SQL.
 */
export const IncidentIdParam = z.string().uuid();

export const IncidentChangeDTO = z.discriminatedUnion('action', [
  z.object({ action: z.literal('acknowledge') }).strict(),
  z.object({ action: z.literal('resolve'), closeReason: z.enum(['resolved', 'false_positive']) }).strict(),
  z.object({ action: z.literal('reopen') }).strict(),
]);
export type IncidentChangeInput = z.infer<typeof IncidentChangeDTO>;

export const IncidentLabelDTO = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('true_positive'), labelClass: z.enum(ATTACK_CLASSES) }).strict(),
  z.object({ verdict: z.literal('false_positive') }).strict(),
  z.object({ verdict: z.literal('unsure') }).strict(),
]);
export type IncidentLabelInput = z.infer<typeof IncidentLabelDTO>;

export const ACTOR_ID_MAX = 128;
/** Letters, digits and `: . _ - @ / + =` (uuids, addresses, device serials, node ids), starting with a letter or digit; no space or quote. */
export const ACTOR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._@/+=-]*$/;

export const ActorQueryDTO = z.object({
  kind: z.enum(ACTOR_KINDS),
  id: z.string().min(1).max(ACTOR_ID_MAX).regex(ACTOR_ID_RE),
}).strict();
export type ActorQueryInput = z.infer<typeof ActorQueryDTO>;
