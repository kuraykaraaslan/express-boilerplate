import { z } from 'zod';
import { GResultSchema } from './g.schema';
import { MigrationKeyAttestationSchema } from './migration-step';
import { SealedNamesSchema } from './migration-names';

/**
 * Bodies of the node -> control plane `result` and `event` envelopes (03 §4, §8.4). The result is a `G` summary and
 * nothing else: enums, bounded numbers, hashes, object keys. Free text stays in the node's own log under the command jti.
 */
export const RESULT_STATES = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'UNKNOWN'] as const;
export type ResultState = (typeof RESULT_STATES)[number];

/**
 * What an executor may answer: the `G` summary, plus, for a `tenant.migrate.preflight` only, the target's signed key attestation (ids, an ephemeral public
 * key, an expiry and a signature: still G), which the control plane relays opaquely to the source (05 section 6.2). The agent lets the attestation through
 * only from the preflight's executor (`stepResultSchemaFor`) and the control plane refuses it on any other command.
 *
 * Likewise `sealedNames`, for a `tenant.migrate.seal_names` only: the tenant's slug and domains SEALED to the target's attested ephemeral key
 * (`migration-names.ts`), an opaque box the control plane can neither open nor read a name out of, relayed to the target's names check.
 */
export const StepResultSchema = GResultSchema.extend({ migrationKeyAttestation: MigrationKeyAttestationSchema.optional(), sealedNames: SealedNamesSchema.optional() }).strict();
export type StepResult = z.infer<typeof StepResultSchema>;
const PreflightResultSchema = GResultSchema.extend({ migrationKeyAttestation: MigrationKeyAttestationSchema.optional() }).strict();
const SealNamesResultSchema = GResultSchema.extend({ sealedNames: SealedNamesSchema.optional() }).strict();
/** What an executor of `kind` may answer: each extra field only from the one kind that produces it. */
export const stepResultSchemaFor = (kind: string): z.ZodType<StepResult> =>
  kind === 'tenant.migrate.preflight' ? PreflightResultSchema : kind === 'tenant.migrate.seal_names' ? SealNamesResultSchema : GResultSchema;

export const ResultBodySchema = StepResultSchema.extend({
  state: z.enum(RESULT_STATES),
  attempt: z.number().int().min(1).max(10),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type ResultBody = z.infer<typeof ResultBodySchema>;

export const EVENT_PHASES = ['PREPARING', 'RUNNING', 'VERIFYING', 'FINISHING'] as const;
export const EventBodySchema = z.object({ phase: z.enum(EVENT_PHASES), percent: z.number().int().min(0).max(100) }).strict();
export type EventBody = z.infer<typeof EventBodySchema>;
