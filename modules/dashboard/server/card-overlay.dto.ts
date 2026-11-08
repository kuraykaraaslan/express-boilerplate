import { z } from 'zod'
import { SUBJECT_ID_RE, SUBJECT_TYPE_RE, hasUnsafeKeys } from './card-overlay'

/** A page's subject in a query string or a body (phase 38, E38-7). */
export const CardSubjectSchema = z.object({
  subjectType: z.string().regex(SUBJECT_TYPE_RE, 'Invalid entity type'),
  subjectId: z.string().regex(SUBJECT_ID_RE, 'Invalid entity id'),
}).strict()

/** PUT …/dashboard/instances/[instanceId]/overlays: a card's settings (as a merge patch on its own) and title for one subject. */
export const SetCardOverlayDTO = z.object({
  subjectType: z.string().regex(SUBJECT_TYPE_RE, 'Invalid entity type'),
  subjectId: z.string().regex(SUBJECT_ID_RE, 'Invalid entity id'),
  settings: z.record(z.string(), z.unknown()).refine((v) => !hasUnsafeKeys(v), 'A settings key may not be __proto__, constructor or prototype'),
  title: z.string().trim().max(120).nullable().optional(),
  /** The overlay's revision the editor started from; 0 when it started from the board's settings (no overlay yet). */
  expectedRevision: z.number().int().min(0).optional(),
}).strict()
export type SetCardOverlayInput = z.infer<typeof SetCardOverlayDTO>

/** The subject named by a query string (`?subjectType=&subjectId=`), or null when neither is given. 400 for half of one. */
export function subjectFromQuery(params: URLSearchParams): { type: string; id: string } | null {
  const type = params.get('subjectType')
  const id = params.get('subjectId')
  if (type === null && id === null) return null
  const parsed = CardSubjectSchema.parse({ subjectType: type ?? '', subjectId: id ?? '' })
  return { type: parsed.subjectType, id: parsed.subjectId }
}
