import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { BoardParamKeySchema } from './board-window'
import { EntityIdSchema, SubtypeSchema } from './board-aliases'
import { isEntityParam, type BoardParam, type EntityParamDef } from './board-params'
import { HOLDS_RELATION } from './alias-resolver'
import type { DashboardEntityType, EntityCtx } from './entity-alias.types'
import type { BoardTemplate } from './board-templates'

/**
 * The answer to a template's question (phase 49b, `TemplateQuestion`): which entities the asked parameter holds on the new board. `all` keeps the
 * parameter as the template declares it; `subtype` the entities of one subtype of its type; `under` the entities directly under one entity of its
 * type. Strict: an option the template does not offer, or an answer to a parameter it does not ask, is a 400.
 */
export const TemplateAnswerSchema = z.discriminatedUnion('choose', [
  z.object({ choose: z.literal('all') }).strict(),
  z.object({ choose: z.literal('subtype'), subtype: SubtypeSchema }).strict(),
  z.object({ choose: z.literal('under'), entityId: EntityIdSchema }).strict(),
])
export type TemplateAnswer = z.infer<typeof TemplateAnswerSchema>

/** At most one answer (a template asks one question). */
export const TemplateAnswersSchema = z
  .custom<Record<string, unknown>>((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.prototype.hasOwnProperty.call(v, '__proto__'), 'Invalid answers')
  .pipe(z.record(BoardParamKeySchema, TemplateAnswerSchema))
  .refine((r) => Object.keys(r).length <= 1, 'A template asks one question')
export type TemplateAnswers = z.infer<typeof TemplateAnswersSchema>

/**
 * The two refusals of an answer. The asked parameter's key travels in `details.param` (an API caller learns which answer), never in the message:
 * the New dashboard dialog shows the message to a person, who never reads a key (49b review, R49b-7).
 */
const refuse = (param: string) => new AppError(MSG.TEMPLATE_ANSWER_INVALID, 400, ErrorCode.VALIDATION_ERROR, { details: { param } })
const unknownAnswer = (param: string) => new AppError(MSG.TEMPLATE_ANSWER_UNKNOWN, 422, ErrorCode.VALIDATION_ERROR, { details: { param } })

/** The asked parameter of the template (an entity parameter of many with a type, the schema's rule), or null when the template asks nothing. */
export function askedParam(template: Pick<BoardTemplate, 'ask' | 'params'>): EntityParamDef | null {
  if (!template.ask) return null
  const p = (template.params ?? []).find((x) => x.key === template.ask!.param)
  return p && isEntityParam(p) && p.multiple && p.entityType ? p : null
}

/**
 * The template's parameters with the answers written in (pure): the asked parameter's choice replaced by the answer, every other parameter as it is.
 * Throws a 400 for an answer to a parameter the template does not ask, or for an option it does not offer. No answer = the parameters as declared.
 */
export function answeredParams(template: Pick<BoardTemplate, 'ask' | 'params'>, answers: TemplateAnswers | undefined): BoardParam[] | undefined {
  const entries = Object.entries(answers ?? {})
  if (entries.length === 0) return template.params
  const asked = askedParam(template)
  const [key, answer] = entries[0]!
  if (!asked || key !== asked.key) throw refuse(key)
  const ask = template.ask!
  if (answer.choose === 'all') return template.params
  if (answer.choose === 'subtype' && !ask.subtype) throw refuse(key)
  if (answer.choose === 'under' && !ask.under) throw refuse(key)
  const choose: EntityParamDef['choose'] = answer.choose === 'subtype'
    ? { type: 'subtype', subtypes: [answer.subtype] }
    : {
      type: 'related', provider: ask.under!.provider, root: { entity: { type: asked.entityType!, id: answer.entityId } },
      direction: 'from', maxLevel: ask.under!.maxLevel ?? 1, relationType: ask.under!.relationType ?? HOLDS_RELATION,
    }
  return (template.params ?? []).map((p) => (p.key === asked.key ? { ...asked, choose } : p))
}

/**
 * The answer names something the caller may read in this tenant (phase 49b): a subtype the entity type lists, or an entity of the type that exists
 * and is the caller's to read (the type's read permission asked first, the entity looked up in the caller's tenant, so another tenant's id is
 * unknown). A 422 otherwise; the type's 403 when the caller may not read it.
 */
export async function assertAnswerExists(
  template: Pick<BoardTemplate, 'ask' | 'params'>,
  answers: TemplateAnswers | undefined,
  deps: { ctx: EntityCtx; entityType(key: string): Promise<DashboardEntityType>; authorize(permission: string): Promise<void> },
): Promise<void> {
  const [entry] = Object.entries(answers ?? {})
  const asked = askedParam(template)
  if (!entry || !asked || entry[1].choose === 'all') return
  const answer = entry[1]
  const type = await deps.entityType(asked.entityType!)
  await deps.authorize(type.requiredPermission)
  if (answer.choose === 'subtype') {
    const listed = type.subtypes ? await type.subtypes(deps.ctx, { search: answer.subtype, limit: 50 }) : []
    if (!listed.some((s) => s.value === answer.subtype)) throw unknownAnswer(asked.key)
    return
  }
  const found = await type.byIds(deps.ctx, [answer.entityId])
  if (!found.some((e) => e.id.toLowerCase() === answer.entityId.toLowerCase())) {
    throw unknownAnswer(asked.key)
  }
}
