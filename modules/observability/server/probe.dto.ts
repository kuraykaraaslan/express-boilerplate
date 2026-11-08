import { z } from 'zod'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'
import { LOCATION_KEY_RE } from './probe.quorum'

/** A short list of lowercase capability names; anything else is dropped by the service (unknown capabilities are never trusted for anything). */
const CapabilitiesDTO = z.array(z.string().min(1).max(20)).max(10)

const PolicyDTO = z.object({
  cidrs: z.array(z.string().min(1).max(64)).max(100).default([]),
  hostnames: z.array(z.string().min(1).max(253)).max(100).default([]),
})

export const CreateLocationDTO = z.object({
  key: z.string().min(1).max(64).regex(LOCATION_KEY_RE, 'lowercase letters, digits, - and _'),
  label: z.string().min(1).max(120),
  /** Only honoured for the ROOT tenant (it publishes public locations); anyone else always creates a private one. */
  kind: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  targetPolicy: PolicyDTO.optional(),
  /** Only honoured for a PUBLIC location (ROOT): BROWSER checks may be placed there. A private location is the tenant's own runner and needs no flag. */
  browserEnabled: z.boolean().optional(),
})
export type CreateLocationInput = z.infer<typeof CreateLocationDTO>

export const UpdateLocationDTO = patchSchema(z.object({
  label: z.string().min(1).max(120),
  enabled: z.boolean(),
  targetPolicy: PolicyDTO,
  /** Whether a status page may show this location (outward-facing: needs `observability.status.publish` as well). null = the default of its kind. */
  publicVisible: z.boolean().nullable(),
  /** The name a status page shows for it; null clears it. A private location needs one before it may be shown. */
  publicLabel: z.string().max(120).nullable(),
  browserEnabled: z.boolean(),
}))

export const EnrolDTO = z.object({
  token: z.string().min(1).max(100),
  publicKey: z.string().min(1).max(2000),
  name: z.string().min(1).max(120).default('runner'),
  version: z.string().max(40).nullish(),
  /** What this runner can do beyond the base checks (`browser`). Additive: an older runner omits it and is a base runner. */
  capabilities: CapabilitiesDTO.optional(),
})

export const LeaseRequestDTO = z.object({
  max: z.number().int().min(1).max(50).optional(),
  /** How many BROWSER checks this runner can take right now (its free browser slots). Additive; omitted = the runner's default of one when it reports the capability. */
  browserSlots: z.number().int().min(0).max(10).optional(),
}).default({})
export const RunnerHeartbeatDTO = z.object({ version: z.string().max(40).nullish(), capabilities: CapabilitiesDTO.optional() }).default({})
