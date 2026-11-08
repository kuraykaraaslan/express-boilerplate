import type { NextRequest } from 'next/server'
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error'
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes'
import DashboardSceneBindingService, { toSceneBindingView, type SceneBindingView } from './scene-binding.service'
import type { SceneRung } from './scene-binding.resolve'
import type { SceneView, SceneViewNote } from './scene-binding.view'
import { slotOf } from './scene-binding'
import { BY_IDS_CAP, sceneKindFor, walkSubjectTopology, type SubjectTopology } from './scene-binding.access'
import { assertSubjectReadable } from './card-overlay.subject'
import { pageSubject, subjectKey, SUBJECT_ID_RE, type CardSubject } from './card-overlay'
import { selectEntityType } from './entity-types'
import { selectSceneKind } from './scene-kinds'
import { displayParamValues } from './display-safe'
import type { DashboardSceneKind, SceneDocumentRef, SceneKeyRef } from './scene-binding.types'
import type { BoardPage } from './board-pages'

/**
 * The scene answers a board opens with (phase 42, D42-5): for the subject each page shows and each (slot, kind) the page's cards draw,
 * what the resolver says (the binding, the document, which rung answered), read once per (subject, slot, kind) and not once per card, so
 * a view opens with its scenes in the request that brought the board (phase 40's one-request rule) and a frame never draws the wrong
 * scene for a moment. The dashboard does not know which widgets draw a scene: a widget says so in its contribution metadata
 * (`sceneKind`, `ext-widget.ts`), and the kinds are the registry's (`dashboard:scene_kind`).
 */

/** What the resolver answers for one (subject, slot, kind), with the document the binding names. */
export interface SceneAnswer {
  rung: SceneRung
  binding?: SceneBindingView
  /** At rung `ancestor`: the role of the asset's row that names this device. */
  focusRole?: string
  /** What the card looks at (D42-6, 42.4.1): the subject's own stored view, or the one derived from where it sits below the bound asset. */
  view?: SceneView
  /** Why a part of the derived view was left out (a level or room code the document or the path holds twice); absent when nothing was. */
  viewNote?: SceneViewNote
  /** The document the binding names (its name and fingerprint); null when it was not found, absent without a binding. */
  document?: SceneDocumentRef | null
}

/** One answer with the key it answers for. */
export interface SceneAnswerEntry extends SceneAnswer {
  subject: CardSubject
  slot: string
  kind: string
}

/** A scene a card needs: the page subject, the card's slot, the kind its widget draws, and whether a card among them has a document of its own. */
export interface SceneNeed {
  subject: CardSubject
  slot: string
  kind: string
  cardDefault: boolean
  /** The documents the cards' own settings name (`cardDefault`'s ids), distinct: what a card draws when no binding answers (a screen needs them in its payload). */
  cardDocumentIds?: string[]
}

/** At most this many (subject, slot, kind) are resolved for one open: a board of many pages cannot make the open a crawl. */
export const MAX_SCENE_NEEDS = 24
/** How many are resolved at once. */
const RESOLVE_AT_ONCE = 4

/** A card as the needs read it: where it is, which widget, its settings. */
export interface SceneCard {
  pageKey?: string | null
  widgetRef: string
  settings?: unknown
}

/** What a widget declares about the scene it draws (`WidgetDescriptor`). */
export interface SceneWidgetInfo {
  sceneKind?: string
  sceneDocumentSetting?: string
}

type PageLike = Pick<BoardPage, 'key' | 'hidden' | 'inputs'>
type SubjectParam = { key: string; entityType?: string }

/**
 * The subject each page shows for `values` (`pageSubject`, the rule the overlays use), by page key; a page with no entity input or an
 * empty one has none. A hidden page (a detail page opened with an item) is left out unless `includeHidden`: a screen never shows one.
 */
export function scenePageSubjects(
  pages: ReadonlyArray<PageLike> | null | undefined, params: ReadonlyArray<SubjectParam> | null | undefined,
  values: Readonly<Record<string, unknown>>, includeHidden: boolean,
): Map<string, CardSubject> {
  const out = new Map<string, CardSubject>()
  for (const page of pages ?? []) {
    if (page.hidden && !includeHidden) continue
    const subject = pageSubject(pages, page.key, params, values)
    if (subject) out.set(page.key, subject)
  }
  return out
}

/**
 * The scenes the cards on pages with a subject need, one entry per distinct (subject, slot, kind) and at most `MAX_SCENE_NEEDS`. A card
 * on a page without a subject, or of a widget that draws no scene, needs nothing (it draws its own settings, the board's decision 25).
 */
export function sceneNeedsOf(args: {
  pageSubjects: ReadonlyMap<string, CardSubject>
  cards: ReadonlyArray<SceneCard>
  widgets: (widgetRef: string) => SceneWidgetInfo | undefined
}): SceneNeed[] {
  const needs = new Map<string, SceneNeed>()
  for (const card of args.cards) {
    const subject = card.pageKey ? args.pageSubjects.get(card.pageKey) : undefined
    const info = args.widgets(card.widgetRef)
    if (!subject || !info?.sceneKind) continue
    const slot = slotOf(card.settings)
    const settings = card.settings && typeof card.settings === 'object' ? (card.settings as Record<string, unknown>) : {}
    const own = info.sceneDocumentSetting ? settings[info.sceneDocumentSetting] : undefined
    const cardDefault = typeof own === 'string' && own !== ''
    const key = `${subjectKey(subject)}:${slot}:${info.sceneKind}`
    const seen = needs.get(key)
    if (seen) {
      seen.cardDefault ||= cardDefault
      if (cardDefault && !seen.cardDocumentIds?.includes(own as string)) (seen.cardDocumentIds ??= []).push(own as string)
    } else if (needs.size < MAX_SCENE_NEEDS) {
      needs.set(key, { subject, slot, kind: info.sceneKind, cardDefault, ...(cardDefault ? { cardDocumentIds: [own as string] } : {}) })
    }
  }
  return [...needs.values()]
}

/**
 * The parameter values a view opens on: the board's defaults, with the viewer's `p.<key>` of the request laid over the ones the board
 * declares (the URL's own grammar, `board-view-state.ts`). A value that cannot be a subject id is left to the default, so the query
 * names nothing the page's rule would refuse anyway.
 */
export function sceneParamValues(params: unknown, query: URLSearchParams): Record<string, unknown> {
  const values = displayParamValues(params)
  const keys = new Set((Array.isArray(params) ? params : []).map((d) => (d as { key?: unknown })?.key).filter((k): k is string => typeof k === 'string'))
  for (const [name, raw] of query) {
    if (!name.startsWith('p.')) continue
    const key = name.slice(2)
    if (keys.has(key) && SUBJECT_ID_RE.test(raw)) values[key] = raw
  }
  return values
}

/** What a request or a display link is asked about while the answers are read. Each check throws an `AppError` when refused. */
export interface SceneGate {
  locale: string
  /** The caller may read the subject's entity type (404 for a type this build lacks, 403 without the permission). */
  subject(subject: CardSubject): Promise<void>
  /** The kind, the caller holding its read permission. */
  kind(key: string): Promise<DashboardSceneKind>
  /** The asset path above a device or an asset, and the devices under an asset, for what the caller may read (empty otherwise). */
  topology(subject: CardSubject): Promise<SubjectTopology>
}

/**
 * The gate of a signed-in member: the checks of the resolve route. `locale` is the member's app language (`appLocaleOf`, D576), never the
 * browser's Accept-Language.
 */
export function requestSceneGate(request: NextRequest, tenantId: string, session: SubjectSource, locale: string): SceneGate {
  return {
    locale,
    subject: (s) => assertSubjectReadable(request, tenantId, s),
    kind: (key) => sceneKindFor(request, tenantId, key, 'read'),
    topology: (s) => walkSubjectTopology(request, tenantId, session, s),
  }
}

/**
 * The gate of a display link: the same checks, asked as the issuer through the display (`authorize`). `locale` is the workspace's
 * language as the screen reads it (`appLocaleOf`: a screen without the app's language cookie reads the workspace default, D576).
 */
export function displaySceneGate(request: NextRequest, tenantId: string, session: SubjectSource, authorize: (permission: string) => Promise<void>, locale: string): SceneGate {
  return {
    locale,
    subject: async (s) => authorize((await selectEntityType(tenantId, s.type)).requiredPermission),
    kind: async (key) => {
      const kind = await selectSceneKind(tenantId, key)
      await authorize(kind.readPermission)
      return kind
    },
    topology: (s) => walkSubjectTopology(request, tenantId, session, s, async (permissionIds) => {
      const held = new Set<string>()
      for (const p of permissionIds) {
        try { await authorize(p); held.add(p) } catch (e) { if (!degrades(e)) throw e }
      }
      return held
    }),
  }
}

/** A refusal, an unknown or an unavailable thing: the card then draws its own default, never an error for the board. */
const degrades = (e: unknown): boolean => e instanceof AppError && [401, 403, 404, 409].includes(e.statusCode)

/**
 * What a display screen's payload may carry of the documents its scenes draw (phase 42.3.1, SA-6): a screen has no session to read a document with, so
 * the display route asks `resolveSceneNeeds` for them (`content`). Over a cap a document is left out and the card draws what it holds, never an error.
 */
export interface SceneContentCaps {
  /** One document's JSON, in bytes. */
  perDocument: number
  /** All the documents of one payload, in bytes (each distinct document counts once, however many answers draw it). */
  total: number
  /** At most this many distinct documents. */
  documents: number
}

/** The caps the display route uses: a plant diagram is a few tens of KiB; 256 KiB / 1 MiB / 12 leave room for a board of stations and bound a payload. */
export const DISPLAY_SCENE_CONTENT: SceneContentCaps = { perDocument: 256 * 1024, total: 1024 * 1024, documents: 12 }

/**
 * Resolves each need once and answers it. A subject or kind the caller may not read, a kind this build lacks or a module that is off is a
 * `card-default` answer (never an error for the whole board); any other failure leaves that answer out, and the view asks the resolve
 * route for it. The documents the bindings name are looked up once per kind.
 */
export async function resolveSceneNeeds(tenantId: string, needs: readonly SceneNeed[], gate: SceneGate): Promise<SceneAnswerEntry[]> {
  const kinds = new Map<string, Promise<DashboardSceneKind>>()
  const subjects = new Map<string, Promise<void>>()
  const kindOf = (key: string) => kinds.get(key) ?? kinds.set(key, gate.kind(key)).get(key)!
  const readable = (s: CardSubject) => subjects.get(subjectKey(s)) ?? subjects.set(subjectKey(s), gate.subject(s)).get(subjectKey(s))!

  const keyReads = new Map<string, Promise<SceneKeyRef[]>>()
  const keysOnce = (impl: DashboardSceneKind, documentId: string): Promise<SceneKeyRef[]> => {
    const k = `${impl.key}:${documentId.toLowerCase()}`
    return keyReads.get(k) ?? keyReads.set(k, impl.keysOf({ tenantId, locale: gate.locale }, documentId)).get(k)!
  }
  const answers: Array<SceneAnswerEntry | null> = new Array(needs.length).fill(null)
  const resolved: Array<DashboardSceneKind | null> = new Array(needs.length).fill(null)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(RESOLVE_AT_ONCE, needs.length) }, async () => {
    while (next < needs.length) {
      const i = next++
      const need = needs[i]
      const at = { subject: need.subject, slot: need.slot, kind: need.kind }
      try {
        await readable(need.subject)
        resolved[i] = await kindOf(need.kind)
        const impl = resolved[i]!
        const r = await DashboardSceneBindingService.resolve(tenantId, {
          subject: need.subject, slot: need.slot, kind: need.kind, cardDefault: need.cardDefault, topology: () => gate.topology(need.subject),
          // a document's keys are read at most once per open, whoever below the same building asks (a floor page and a room page)
          keysOf: (documentId) => keysOnce(impl, documentId),
        })
        answers[i] = {
          ...at, rung: r.rung, ...(r.binding ? { binding: toSceneBindingView(r.binding) } : {}),
          ...(r.focusRole !== undefined ? { focusRole: r.focusRole } : {}), ...(r.view ? { view: r.view } : {}),
          ...(r.viewNote ? { viewNote: r.viewNote } : {}),
        }
      } catch (e) {
        if (degrades(e)) answers[i] = { ...at, rung: 'card-default' }
        // any other failure: no answer, the view asks the resolve route
      }
    }
  }))

  // the documents the bindings name, once per kind
  const wanted = new Map<string, Set<string>>()
  answers.forEach((a) => { if (a?.binding) (wanted.get(a.kind) ?? wanted.set(a.kind, new Set()).get(a.kind)!).add(a.binding.documentId.toLowerCase()) })
  const refs = new Map<string, Map<string, SceneDocumentRef>>()
  await Promise.all([...wanted].map(async ([kind, ids]) => {
    const impl = resolved.find((k, i) => k && needs[i].kind === kind)
    if (!impl) return
    try {
      const found: SceneDocumentRef[] = []
      const list = [...ids]
      for (let i = 0; i < list.length; i += BY_IDS_CAP) found.push(...await impl.byIds({ tenantId, locale: gate.locale }, list.slice(i, i + BY_IDS_CAP)))
      refs.set(kind, new Map(found.map((d) => [d.id.toLowerCase(), d])))
    } catch {
      // a kind that cannot name its documents: the answer keeps the binding without a name
    }
  }))
  return answers.filter((a): a is SceneAnswerEntry => a !== null).map((a) => {
    const byId = refs.get(a.kind)
    return a.binding && byId ? { ...a, document: byId.get(a.binding.documentId.toLowerCase()) ?? null } : a
  })
}

/** The key a payload's `contents` holds a document under: its kind and its lower-cased id. */
export const sceneContentKey = (kind: string, documentId: string): string => `${kind}:${documentId.toLowerCase()}`

/**
 * The documents a display screen draws (phase 42.3.1, SA-6), for the payload's `scenes.contents`, once per distinct document however many pages draw it:
 * the binding's document of every answer that resolved, and for an answer with no binding the documents its cards' own settings name (`cardDocumentIds`).
 * Read through the kind's `content` as the issuer's display authority already answers the kind's read permission (`gate.kind`, the same check the answers
 * went through); a kind without `content` gives none. Inside the caps, in the order of the needs (a payload over its budget drops the LATER documents,
 * never a random one); a document that is over its cap, not found or unreadable is left out, and the card draws what it holds.
 */
export async function sceneContentsOf(
  tenantId: string, needs: readonly SceneNeed[], answers: readonly SceneAnswerEntry[], gate: SceneGate, caps: SceneContentCaps,
): Promise<Record<string, Record<string, unknown>>> {
  const answerOf = new Map(answers.map((a) => [`${subjectKey(a.subject)}:${a.slot}:${a.kind}`, a]))
  const kinds = new Map<string, Promise<DashboardSceneKind | null>>()
  const kindOf = (key: string) => kinds.get(key) ?? kinds.set(key, gate.kind(key).catch(() => null)).get(key)!
  const out: Record<string, Record<string, unknown>> = {}
  const tried = new Set<string>()
  let total = 0
  for (const need of needs) {
    const a = answerOf.get(`${subjectKey(need.subject)}:${need.slot}:${need.kind}`)
    if (!a) continue
    const ids = a.binding ? (a.binding.status === 'ok' ? [a.binding.documentId] : []) : need.cardDocumentIds ?? []
    for (const raw of ids) {
      const key = sceneContentKey(need.kind, raw)
      if (tried.has(key) || tried.size >= caps.documents) continue
      tried.add(key)
      const impl = await kindOf(need.kind)
      if (!impl?.content) continue
      try {
        const found = await impl.content({ tenantId, locale: gate.locale }, raw.toLowerCase())
        const size = found ? new TextEncoder().encode(JSON.stringify(found)).length : 0
        if (found && size <= caps.perDocument && total + size <= caps.total) { out[key] = found; total += size }
      } catch {
        // a document that cannot be read is left out: the screen draws what the card holds
      }
    }
  }
  return out
}

/**
 * An answer as a display screen gets it: what draws the scene (document, roles, map, hidden keys, view and, since phase 42.6, the rules, which colour
 * and label the items it shows) and nothing of how it was set up (revision, who changed it, the row's id). The rules hold keys, limits and texts
 * the person who set the scene up chose to show; a screen that draws the scene needs them to draw it as the page does.
 */
export function displaySceneAnswer(a: SceneAnswerEntry): SceneAnswerEntry {
  if (!a.binding) return a
  const { revision: _revision, updatedAt: _updatedAt, bindingId: _bindingId, ...kept } = a.binding
  return { ...a, binding: kept as SceneBindingView }
}
