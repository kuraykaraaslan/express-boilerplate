import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardInstanceService from './instance.crud.service'
import DashboardDisplayLinkService from './display-link.service'
import { resolvePinnedDefinitions, resolvePlacedWidgets, type PinnedDefinition, type WidgetDescriptor } from './widget-catalog.service'
import { resolveDisplayContext } from './display-principal'
import { displayToken } from './display-rate-limit'
import { DISPLAY_REFRESH_STEPS, displayParamValues, displayRenderable, shownOnDisplay, toDisplayDescriptor, toDisplayInstance } from './display-safe'
import { getEmbedHosts } from './embed-hosts'
import { auditDisplay } from './dashboard.audit'
import { applyMergePatch } from './card-overlay'
import { displayOverlays } from './card-overlay.display'
import type { BoardParam } from './board-params'
import { DISPLAY_SCENE_CONTENT, displaySceneAnswer, displaySceneGate, resolveSceneNeeds, sceneContentsOf, sceneNeedsOf, scenePageSubjects } from './scene-binding.open'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/display/board — the board a display link shows (owner decision 2026-10-17 #10).
 *
 * The caller is a SCREEN, not a session: the credential is the `X-Display-Token` header (decision
 * 2026-10-18 #19; `Authorization: Display <token>` is still read, a token in the query string is refused), and any
 * session cookie that happens to come along changes nothing (the GUEST gate's result is not used as an identity).
 * Order: the per-IP limit, the GUEST `dashboard.display.view` gate (an ABAC kill switch for every screen of the
 * tenant), the token and its per-link limit (before any database read), then the display principal
 * (`display-principal.ts`: link, tenant, board, issuer).
 *
 * What comes back is the board's look and layout and only the display-safe cards (`display-safe.ts`), each with its
 * actions dropped and its saved parameters and pinned window kept on the server; each widget goes out through the
 * display projection (`toDisplayDescriptor`), so a preset's saved binding stays on the server too. A pinned card (7b)
 * carries its `pinnedVersion`, and `pinned` holds the definitions of those versions (keyed `<widgetRef>@<version>`). A card
 * on a page that shows an item comes with that item's card overlay merged into its settings (phase 38,
 * `card-overlay.display.ts`), and `scenes` carries each page's subject and the scene its cards draw for it (phase 42,
 * `scene-binding.open.ts`: only what draws the scene, as the issuer may read it). One `dashboard.display.open` audit row per call; `lastUsedAt` at most once a minute.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.display.view', scope: 'GUEST' })
    const token = await displayToken(request, tenantId)
    const ctx = await resolveDisplayContext(request, tenantId, token)

    const all = await DashboardInstanceService.listOnSurface(tenantId, { entityType: 'DASHBOARD', entityId: ctx.board.boardId })
    const resolved = all.length === 0 ? new Map<string, WidgetDescriptor>() : await resolvePlacedWidgets({
      request, tenantId, session: ctx.issuer.session, userId: ctx.issuer.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
      refs: [...new Set(all.map((i) => i.widgetRef))],
      includeUnavailable: true, // a kind whose module is off: the board draws it inert, a create answers 422 (`dashboard:widget_kinds`)
    })
    const safe = new Map([...resolved].filter(([, d]) => displayRenderable(d)))
    // A card shown only while a rule holds (phase 35) is judged here, against the board's defaults: the screen runs on
    // them and nobody there changes them, so the rule's answer is fixed and the client never sees the rule.
    const defaults = displayParamValues(ctx.board.params)
    const candidates = all.filter((i) => safe.has(i.widgetRef) && shownOnDisplay(i.visibility, defaults))
    // 7b: a pinned card renders the definition of its version, as on the board; asked only for the cards a screen may
    // show. The pin replaces the template, so the card is checked again with it laid over the latest definition.
    const pins = await resolvePinnedDefinitions(tenantId, candidates, safe)
    const pinOf = (i: { widgetRef: string; pinnedVersion?: number | null }): [string, PinnedDefinition] | null => {
      const key = `${i.widgetRef}@${i.pinnedVersion}`
      return i.pinnedVersion != null && pins[key] ? [key, pins[key]] : null
    }
    const shown = candidates.filter((i) => {
      const pin = pinOf(i)
      return !pin || displayRenderable({ ...safe.get(i.widgetRef)!, ...pin[1] })
    })
    const widgets = new Map([...safe].filter(([ref]) => shown.some((i) => i.widgetRef === ref)))
    const pinned = Object.fromEntries(shown.map(pinOf).filter((p): p is [string, PinnedDefinition] => !!p))
    // Phase 38 (38.2.4b): a page shows its default item on a screen, so a card customised for that item (a station's own
    // diagram) goes out with its overlay merged in, as the board draws it; the screen's client never sees an overlay.
    const overlays = await displayOverlays({
      tenantId, boardId: ctx.board.boardId, pages: ctx.board.pages, params: ctx.board.params as BoardParam[] | null | undefined,
      values: defaults, cards: shown, authorize: ctx.authorize,
    })
    // Phase 42 (D42-5): the scene each shown page's subject has for the cards that draw one, read as the issuer through the display; a
    // refusal is a `card-default` answer, never an error for the screen, and a screen's client gets only what draws the scene.
    const pageSubjects = scenePageSubjects(ctx.board.pages, ctx.board.params as BoardParam[] | null | undefined, defaults, false)
    const sceneNeeds = sceneNeedsOf({ pageSubjects, cards: shown, widgets: (ref) => widgets.get(ref) })
    const sceneGate = displaySceneGate(request, tenantId, ctx.issuer.session, ctx.authorize, await appLocaleOf(request, tenantId))
    const resolvedScenes = await resolveSceneNeeds(tenantId, sceneNeeds, sceneGate)
    const sceneAnswers = resolvedScenes.map(displaySceneAnswer)
    // The documents those scenes draw (42.3.1, SA-6): a screen has no session to read them with, so they travel in this payload, once each, inside the caps,
    // read under the same read permission the answers were (a screen that does not hold it gets none and draws what its cards hold).
    const sceneContents = await sceneContentsOf(tenantId, sceneNeeds, resolvedScenes, sceneGate, DISPLAY_SCENE_CONTENT)
    const instances = shown.map((i) => {
      const o = overlays.get(i.instanceId)
      return toDisplayInstance(o ? { ...i, settings: applyMergePatch(i.settings as Record<string, unknown> | null, o.settings), ...(o.title ? { title: o.title } : {}) } : i)
    })

    await DashboardDisplayLinkService.touch(tenantId, ctx.link.displayLinkId)
    await auditDisplay({
      tenantId, action: 'dashboard.display.open', linkId: ctx.link.displayLinkId, boardId: ctx.board.boardId,
      issuerUserId: ctx.issuer.userId, request, metadata: { cards: instances.length, ...(overlays.size ? { overlays: overlays.size } : {}) },
    })
    const b = ctx.board
    return NextResponse.json({
      board: {
        boardId: b.boardId, title: b.title, settings: b.settings ?? null, gridCols: b.gridCols, timeWindow: b.timeWindow ?? null,
        params: b.params ?? null, pages: b.pages ?? null, mainPage: b.mainPage ?? null, layoutVersion: b.layoutVersion,
      },
      instances,
      widgets: Object.fromEntries([...widgets].map(([ref, d]) => [ref, toDisplayDescriptor(d)])),
      pinned,
      // each page's subject and the scenes its cards draw (phase 42); the client reads a card's scene by its page's subject
      scenes: { pages: Object.fromEntries(pageSubjects), answers: sceneAnswers, contents: sceneContents },
      embedHosts: await getEmbedHosts(tenantId),
      expiresAt: new Date(ctx.link.expiresAt).toISOString(),
      refreshSteps: DISPLAY_REFRESH_STEPS,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return normalizeError(e)
  }
}
