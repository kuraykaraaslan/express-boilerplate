import { z } from 'zod'
import { CHAT_EVENTS, PUBLIC_CHAT_EVENTS } from './chat.format'
import { MAX_CHAT_URL } from './chat.destination'
import { IncidentSeverityEnum } from './uptime.enums'

const Events = z.array(z.enum(CHAT_EVENTS)).max(CHAT_EVENTS.length)
const Severities = z.array(IncidentSeverityEnum).max(3)

const refineAudience = (v: { audience?: string; events?: readonly string[] | null }, ctx: z.RefinementCtx) => {
  if (v.audience === 'PUBLIC' && v.events && v.events.some((e) => !(PUBLIC_CHAT_EVENTS as readonly string[]).includes(e))) {
    ctx.addIssue({ code: 'custom', path: ['events'], message: 'A public destination can only receive: ' + PUBLIC_CHAT_EVENTS.join(', ') })
  }
}

/** The URL is write-only: it is accepted here and never appears in any response. */
export const CreateChatDestinationDTO = z.object({
  kind: z.enum(['SLACK', 'TEAMS']),
  label: z.string().trim().min(1).max(120),
  url: z.string().max(MAX_CHAT_URL),
  audience: z.enum(['INTERNAL', 'PUBLIC']).default('INTERNAL'),
  events: Events.nullish(),
  severities: Severities.nullish(),
  enabled: z.boolean().default(true),
}).strict().superRefine(refineAudience)
export type CreateChatDestinationInput = z.infer<typeof CreateChatDestinationDTO>

/** Everything optional; `url` replaces the stored webhook URL (rotation). `kind` cannot change: a Slack URL is not a Teams URL. */
export const UpdateChatDestinationDTO = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  url: z.string().max(MAX_CHAT_URL).optional(),
  audience: z.enum(['INTERNAL', 'PUBLIC']).optional(),
  events: Events.nullish(),
  severities: Severities.nullish(),
  enabled: z.boolean().optional(),
}).strict().superRefine(refineAudience)
export type UpdateChatDestinationInput = z.infer<typeof UpdateChatDestinationDTO>
