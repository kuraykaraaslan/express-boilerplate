import { z } from 'zod'
import {
  WidgetRefSchema, DataBindingSchema, InstanceActionsInputSchema, BoardSlugSchema,
} from './dashboard.dto'
import { BoardParamKeySchema, TimeWindowSchema, isParamRef } from './board-window'
import { BoardParamsInputSchema, entityParamRefIssues, isEntityParam } from './board-params'
import { ContributionKeySchema, MAX_RELATION_LEVEL, RelationTypeSchema } from './board-aliases'
import type { BoardTemplate } from './board-templates'
import { GridColsSchema, MAX_GRID_COLS, normalizeGridCols } from './grid-cols'
import { BoardPageKeySchema, BoardPagesSchema, MainPageSchema, pageInputParamKeys, pageKeysOf, referencedActionPageKeys, missingPageInputs } from './board-pages'
import { allActionsOf } from './instance-actions'

/**
 * Validation for contributed board templates (docs/phases/07-dashboard/13).
 *
 * A placement passes the SAME pieces a manual `POST …/instances` does — the
 * `widgetRef` shape, `DataBindingSchema.strict()` (no URL field exists in the
 * model), the closed action set, geometry bounds — so a template is a shortcut
 * for placing widgets, never a second, looser way to store one. What cannot be
 * checked here (does the widget resolve for THIS caller, do the binding slots
 * match its `dataSpec`) is checked at apply time, per placement.
 */

// Static bounds for the widest grid; `x + w` is bounded by the template's own `gridCols` below (owner decision 15).
const geometry = {
  x: z.number().int().min(0).max(MAX_GRID_COLS - 1),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(MAX_GRID_COLS),
  h: z.number().int().min(1).max(48),
}

/**
 * `builtin:<type>` names a PLATFORM builtin by its stable type (`chart.line`,
 * `gauge`, …). A contributor cannot know the `db:<uuid>` a root-published row got,
 * so the ref is resolved at apply / render time (`expandBuiltinRefs`); one that
 * does not resolve is skipped and reported by name like any unavailable widget.
 */
export const BUILTIN_REF_PATTERN = /^builtin:([a-z0-9][a-z0-9._-]*)$/

export const TemplateWidgetRefSchema = z.union([
  WidgetRefSchema,
  z.string().regex(BUILTIN_REF_PATTERN, 'Invalid widget reference'),
])

/** A dictionary key a template names for a text (`<module>.<words>`), as a refusal names one (phase 49b). */
export const TemplateMessageKeySchema = z.string().max(160).regex(/^[a-z][a-z0-9_]*(\.[A-Za-z0-9_]+)+$/, 'Invalid dictionary key')
/** A small map of names to dictionary keys (D118 (e): a card's text settings and action names, a board's pages and parameters). */
const TextKeyMapSchema = z.record(z.string().min(1).max(64), TemplateMessageKeySchema).refine((m) => Object.keys(m).length <= 50, { message: 'At most 50 keys' })

/** D118 (e): a card's words besides its title, by setting name and by action id (`TemplateCardTextKeys`). */
export const TemplateCardTextKeysSchema = z.object({ settings: TextKeyMapSchema.optional(), actions: TextKeyMapSchema.optional() }).strict()

/** What a card is: its widget and what it is bound to (the parts a fallback card replaces, phase 49b). */
const cardFields = {
  widgetRef: TemplateWidgetRefSchema,
  title: z.string().max(120).nullable().optional(),
  /** D118 (e): the title's dictionary key, stored in the creator's language at apply. */
  titleKey: TemplateMessageKeySchema.optional(),
  textKeys: TemplateCardTextKeysSchema.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  dataBinding: DataBindingSchema.nullable().optional(),
  refreshSeconds: z.number().int().min(5).max(86_400).nullable().optional(),
  actions: InstanceActionsInputSchema.nullable().optional(),
}

/** Phase 49b: the card placed instead when the main card's widget cannot be placed for the caller; it keeps the main card's cells and page. */
export const TemplateFallbackSchema = z.object(cardFields).strict()

export const TemplatePlacementSchema = z.object({
  ...cardFields,
  ...geometry,
  /** The template page the card sits on (phase 29); absent = the main page. */
  pageKey: BoardPageKeySchema.nullable().optional(),
  fallback: TemplateFallbackSchema.nullable().optional(),
}).strict()

const TemplateTextSchema = z.object({ label: z.string().trim().min(1).max(120), labelKey: TemplateMessageKeySchema.optional() }).strict()

/** Phase 49b: the question a person answers when a new board is made from the template (`TemplateQuestion`). */
export const TemplateQuestionSchema = TemplateTextSchema.extend({
  param: BoardParamKeySchema,
  all: TemplateTextSchema,
  subtype: TemplateTextSchema.optional(),
  under: TemplateTextSchema.extend({
    provider: ContributionKeySchema,
    relationType: RelationTypeSchema.optional(),
    maxLevel: z.number().int().min(1).max(MAX_RELATION_LEVEL).optional(),
  }).strict().optional(),
}).strict()

const SectionSchema = z.object({
  title: z.string().min(1).max(120),
  titleKey: TemplateMessageKeySchema.optional(),
  countableKeys: z.array(z.string().min(1).max(200)).min(1).max(50),
}).strict()

export const ContributedTemplateSchema = z.object({
  key: BoardSlugSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  anchor: z.object({
    workspace: z.string().max(64).optional(),
    moduleId: z.string().max(64).optional(),
  }).strict().refine((a) => !!a.workspace !== !!a.moduleId, { message: 'A template anchors to a workspace or a module, exactly one' }),
  sections: z.array(SectionSchema).max(50).optional(),
  placements: z.array(TemplatePlacementSchema).max(100).optional(),
  timeWindow: TimeWindowSchema.optional(),
  /** Either age (phase 41): read as one list of value and entity parameters. */
  params: BoardParamsInputSchema.optional(),
  /** The columns the placements are written on: 12 (omitted) or 24. */
  gridCols: GridColsSchema.optional(),
  /** In-board pages (phase 29), as a board stores them; placements name theirs in `pageKey`. */
  pages: BoardPagesSchema.optional(),
  mainPage: MainPageSchema.optional(),
  /** Phase 49b: the dictionary keys of the title and the description in the contributing module's dictionary. */
  titleKey: TemplateMessageKeySchema.optional(),
  descriptionKey: TemplateMessageKeySchema.optional(),
  /** D118 (e): the keys of the main page's title, the pages' titles and the parameters' labels (`TemplateBoardTextKeys`). */
  textKeys: z.object({ mainPage: TemplateMessageKeySchema.optional(), pages: TextKeyMapSchema.optional(), params: TextKeyMapSchema.optional() }).strict().optional(),
  /** Phase 49b: the question asked when a new board is made from the template. */
  ask: TemplateQuestionSchema.optional(),
  /** Phase 49b review (R49b-3): the modules (by id) the template's cards read; it is offered and applied only while all of them are on. */
  requires: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Invalid module id')).max(20).optional(),
}).strict()
  .refine((t) => !!t.sections?.length !== !!t.placements?.length, { message: 'A template has sections or placements, not both and not neither' })
  .superRefine((t, ctx) => {
    // Every `$param` a binding uses must name a param THIS template declares.
    const declared = new Set((t.params ?? []).map((p) => p.key))
    // What an entity parameter reads of another (a page value, a relation root) is one of them (phase 41, E36-7).
    for (const issue of entityParamRefIssues(t.params ?? [])) ctx.addIssue({ code: 'custom', path: ['params', issue.index], message: issue.message })
    const cols = normalizeGridCols(t.gridCols)
    // Phase 29: the same page rules a board write applies, checked when the template is read, not when it is applied.
    const pages = pageKeysOf(t.pages ?? [])
    for (const k of pageInputParamKeys(t.pages ?? [])) {
      if (!declared.has(k)) ctx.addIssue({ code: 'custom', path: ['pages'], message: `A page takes '${k}', which the template does not declare` })
    }
    // D118 (e): a text key names a page or a parameter the template has
    for (const k of Object.keys(t.textKeys?.pages ?? {})) {
      if (!pages.has(k)) ctx.addIssue({ code: 'custom', path: ['textKeys', 'pages', k], message: `A text key names unknown template page '${k}'` })
    }
    for (const k of Object.keys(t.textKeys?.params ?? {})) {
      if (!declared.has(k)) ctx.addIssue({ code: 'custom', path: ['textKeys', 'params', k], message: `A text key names '${k}', which the template does not declare` })
    }
    // Phase 49b: the question scopes an entity parameter of many with an entity type (its set is what the answer narrows).
    if (t.ask) {
      const asked = (t.params ?? []).find((p) => p.key === t.ask!.param)
      if (!asked || !isEntityParam(asked) || !asked.multiple || !asked.entityType) {
        ctx.addIssue({ code: 'custom', path: ['ask', 'param'], message: `The question names '${t.ask.param}', which is not an entity parameter of many with an entity type` })
      }
    }
    ;(t.placements ?? []).forEach((pl, i) => {
      // A placement lies inside the template's OWN grid: a 24-column template is never read as 12, nor 12 as 24.
      if (pl.x + pl.w > cols) {
        ctx.addIssue({ code: 'custom', path: ['placements', i, 'w'], message: `x + w exceeds the template's ${cols} columns` })
      }
      if (pl.pageKey && !pages.has(pl.pageKey)) {
        ctx.addIssue({ code: 'custom', path: ['placements', i, 'pageKey'], message: `Unknown template page '${pl.pageKey}'` })
      }
      for (const key of referencedActionPageKeys([pl.actions])) {
        if (!pages.has(key)) ctx.addIssue({ code: 'custom', path: ['placements', i, 'actions'], message: `An action opens unknown page '${key}'` })
      }
      for (const a of allActionsOf(pl.actions) as Array<{ kind: string; page?: string | null; set?: Record<string, unknown> }>) {
        if (a.kind !== 'openPage') continue
        const missing = missingPageInputs(a, t.pages ?? [], t.params ?? [], pl.pageKey)
        if (missing.length) ctx.addIssue({ code: 'custom', path: ['placements', i, 'actions'], message: `An action opens '${a.page}' without '${missing.join("', '")}'` })
      }
      // Phase 49b: a fallback card is checked as the card it stands in for (its actions, its page's inputs, its params).
      for (const [card, base] of [[pl, ['placements', i]], ...(pl.fallback ? [[pl.fallback, ['placements', i, 'fallback']]] : [])] as Array<[typeof pl | NonNullable<typeof pl.fallback>, Array<string | number>]>) {
        if (card !== pl) {
          for (const key of referencedActionPageKeys([card.actions])) {
            if (!pages.has(key)) ctx.addIssue({ code: 'custom', path: [...base, 'actions'], message: `An action opens unknown page '${key}'` })
          }
          for (const a of allActionsOf(card.actions) as Array<{ kind: string; page?: string | null; set?: Record<string, unknown> }>) {
            if (a.kind !== 'openPage') continue
            const missing = missingPageInputs(a, t.pages ?? [], t.params ?? [], pl.pageKey)
            if (missing.length) ctx.addIssue({ code: 'custom', path: [...base, 'actions'], message: `An action opens '${a.page}' without '${missing.join("', '")}'` })
          }
        }
        for (const [slot, q] of Object.entries(card.dataBinding ?? {})) {
          for (const value of Object.values(q.params)) {
            if (isParamRef(value) && !declared.has(value.$param)) {
              ctx.addIssue({ code: 'custom', path: [...base, 'dataBinding', slot], message: `Unknown template param '${value.$param}'` })
            }
          }
        }
      }
    })
  })

export function parseContributedTemplate(raw: unknown): { ok: true; template: BoardTemplate } | { ok: false; error: string } {
  const parsed = ContributedTemplateSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  return { ok: true, template: parsed.data as BoardTemplate }
}
