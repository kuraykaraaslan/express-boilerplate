import { z } from 'zod'
import { SUBJECT_ID_RE, SUBJECT_TYPE_RE } from './card-overlay'
import { DEFAULT_SLOT, SCENE_KIND_RE, SCENE_SLOT_RE, UUID_RE } from './scene-binding'

/**
 * `GET …/dashboard/scene-bindings/placements?subjectType=&subjectId=&kind=[&slot=]` (phase 48.3): where one view of a subject is shown. The subject as
 * every scene read takes it (a uuid lower-cased), the kind of the view (`diagram`, `design`) and its slot (default `main`).
 */
export const PlacementsQuerySchema = z.object({
  subjectType: z.string().regex(SUBJECT_TYPE_RE, 'Invalid entity type'),
  subjectId: z.string().regex(SUBJECT_ID_RE, 'Invalid entity id').transform((s) => (UUID_RE.test(s) ? s.toLowerCase() : s)),
  kind: z.string().regex(SCENE_KIND_RE, 'Invalid scene kind'),
  slot: z.string().regex(SCENE_SLOT_RE, 'Invalid slot').default(DEFAULT_SLOT),
}).strict()
export type PlacementsQuery = z.infer<typeof PlacementsQuerySchema>
