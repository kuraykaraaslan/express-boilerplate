/**
 * Curated board templates — a named, one-click arrangement of widgets that
 * already exist, applied via `BoardTemplateService.apply` (erp Faz 10, widened
 * to a gallery of several templates per workspace in dashboard Faz 08).
 *
 * Not a new widget kind and not tenant-editable: a template is code, the same
 * way `widget.root-catalog.ts`'s platform widgets are code-shaped rows rather
 * than a form a tenant fills in. Widening this into tenant-authored templates
 * is a real feature (a `dashboard_board_templates` entity, an editor) that this
 * file deliberately does not build — the erp decision (`docs/phases/06-erp/10-end-to-end-proof.md`,
 * 2026-09-03) asks for "a ready template", not a template *builder*.
 */

import type { TimeWindow } from './board-window'
import type { BoardParam } from './board-params'
import type { InstanceActions, InstanceActionsV2 } from './dashboard.dto'
import type { GridCols } from './grid-cols'
import type { BoardPage, MainPage } from './board-pages'

/** The one widget every section places — the countable-driven "at a glance" card grid. */
export const VALUE_CHAIN_WIDGET_REF = 'manifest:entity-counts'

export interface BoardTemplateSection {
  title: string
  /** D118 (e): the dictionary key of the title, stored in the creator's language when the template is applied (`board-template.texts.ts`). */
  titleKey?: string
  /** `dashboard:countable` keys (`<moduleId>.<key>`) this section's card grid is narrowed to. */
  countableKeys: string[]
}

/**
 * What the applied board is filed under (Faz 9, K2/K13) — a workspace or a
 * module, mirroring `BoardAnchor` (`board.crud.service.ts`). Was a bare
 * `workspace: string` until 2026-09-16, when module boards needed the same
 * mechanism a workspace template already had: a template names WHERE it
 * lands, and that "where" is no longer only a workspace.
 */
export interface BoardTemplateAnchor {
  workspace?: string
  moduleId?: string
}

/**
 * One REAL placement a template makes (docs/phases/07-dashboard/13): any widget, with
 * geometry, settings, a data binding (which may use `{ $param }` references to
 * the template's own `params`) and actions. Validated by the SAME schemas a
 * manual placement passes — see `board-template.schema.ts`.
 */
export interface TemplatePlacement {
  widgetRef: string
  x: number
  y: number
  w: number
  h: number
  title?: string | null
  settings?: Record<string, unknown>
  dataBinding?: Record<string, {
    sourceKey: string
    queryKey: string
    params: Record<string, unknown>
    window?: 'board' | TimeWindow
  }> | null
  refreshSeconds?: number | null
  /** The v1 `{ onClick }` shape or the v2 sources (`InstanceActionsInputSchema` validates both). */
  actions?: InstanceActions | InstanceActionsV2 | null
  /** The template page the card sits on (phase 29); absent = the main page. One of `BoardTemplate.pages`. */
  pageKey?: string | null
  /**
   * D118 (e): the dictionary key of the card's title (`<module>.<words>`, the contributing module's dictionary). The card is stored with the text in
   * the creator's language when the template is applied (`board-template.texts.ts`); a language without it keeps `title`. The card stores no key.
   */
  titleKey?: string
  /** D118 (e): the keys of the card's other words: a top-level text setting by its name (a stat card's `label`), an action's name by the action's id. */
  textKeys?: TemplateCardTextKeys
  /**
   * Phase 49b: the card placed instead, on the same cells and page, when this one's widget cannot be placed for the caller (a widget of a module
   * the tenant does not have, or one the caller may not see): the Sites template's 3D view falls back to the 2D drawing. Absent: the card is
   * skipped and reported by name, as before.
   */
  fallback?: TemplateFallback | null
}

/** What a fallback card changes: the widget and what it is bound to; it keeps the main card's cells and page (phase 49b). */
export type TemplateFallback = Pick<TemplatePlacement, 'widgetRef' | 'title' | 'settings' | 'dataBinding' | 'refreshSeconds' | 'actions' | 'titleKey' | 'textKeys'>

/** D118 (e): the dictionary keys of a card's words besides its title. */
export interface TemplateCardTextKeys {
  /** A top-level setting whose value is a text a person reads (a stat card's `label`), by the setting's name. */
  settings?: Record<string, string>
  /** An action's name (a header button's label), by the action's id. */
  actions?: Record<string, string>
}

/** D118 (e): the dictionary keys of the words a template stores on the board itself. */
export interface TemplateBoardTextKeys {
  /** The main page's title. */
  mainPage?: string
  /** A page's title, by the page's key. */
  pages?: Record<string, string>
  /** A parameter's label (the filter bar's name of it), by the parameter's key. */
  params?: Record<string, string>
}

/** A text of a template a person reads: its English, and the contributor's dictionary key that says it in the viewer's language. */
export interface TemplateText {
  label: string
  /** A key of the contributing module's dictionary (`<module>.<words>`); absent: the English is shown. */
  labelKey?: string
}

/**
 * Phase 49b: the one question a person creating a board from the template answers ("Which sites?"): which entities one of its entity parameters
 * of many holds. `all` keeps the parameter as the template declares it; `subtype` (when offered) takes the entities of one subtype of its entity
 * type (the person picks one); `under` (when offered) the entities directly under one entity of that type (the person picks it), through the
 * relations provider `provider` (`relationType`, default `CONTAINS`, at most `maxLevel` levels, default 1). The answer is stored as the board's
 * parameter (phase 41), an ordinary one the person may change afterwards.
 */
export interface TemplateQuestion extends TemplateText {
  /** An entity parameter of the template, of many, with an entity type. */
  param: string
  all: TemplateText
  subtype?: TemplateText
  under?: TemplateText & { provider: string; relationType?: string; maxLevel?: number }
}

/**
 * A template has `sections` (the original countable-card grids — unchanged) OR
 * `placements` (real, bound widgets with geometry) plus an optional default board
 * window and typed params. Built-ins live in this file; any module may contribute
 * more through `dashboard:board_template` (`board-template.registry.ts`), and the
 * dashboard never names the contributing module.
 */
export interface BoardTemplate {
  key: string
  title: string
  description?: string
  /**
   * Phase 49b: the contributor's dictionary keys of the title and the description (the gallery and the New dashboard dialog say them in the viewer's
   * language; D118 (e): a board applied from the template is stored with them in the creator's language).
   */
  titleKey?: string
  descriptionKey?: string
  /** D118 (e): the keys of the page titles and the parameter labels the board is stored with (`TemplateBoardTextKeys`). */
  textKeys?: TemplateBoardTextKeys
  /** Phase 49b: the question a person answers when a new board is made from the template (`TemplateQuestion`). */
  ask?: TemplateQuestion
  /**
   * Phase 49b review (R49b-3): the modules whose data the template's cards read, by id, beside its anchor. A template is offered, previewed and
   * applied only while every one of them is on for the tenant (`requiredModulesOn`): a contributor's optional dependencies may be off while the
   * contributor is on, and a board whose every card reads a source that is not there helps nobody. Absent: nothing beyond the contributor.
   */
  requires?: string[]
  anchor: BoardTemplateAnchor
  sections?: BoardTemplateSection[]
  placements?: TemplatePlacement[]
  timeWindow?: TimeWindow
  /** Value and entity parameters (phase 41); a contributed template's are read through `BoardParamsInputSchema`. */
  params?: BoardParam[]
  /**
   * The columns the placements' `x` / `w` are written on (owner decision 15): 12 (the default) or 24. A new board
   * applied from the template gets this count; a template placed onto an existing board is rescaled to that board's
   * count (`scaleTemplatePlacements`).
   */
  gridCols?: GridCols
  /** In-board pages (phase 29): a new board applied from the template gets them; placements name theirs in `pageKey`. */
  pages?: BoardPage[]
  /** The main page's name and icon (phase 29). */
  mainPage?: MainPage
}

/**
 * The value chain end to end — the same eight modules and sixteen cards
 * `dashboard.countables.boundary.test.ts` pins, grouped into the six stages
 * `docs/phases/06-erp/10-end-to-end-proof.md` names (satın alma → stok → üretim → saha → satış → iade).
 * "Sales" is the composite of the three modules that sell (lead → deal →
 * order) rather than a seventh stage of its own — the boundary test's own
 * comment reads the chain the same way ("leads → deals → orders → stock →
 * buying → floor → making → returns").
 */
export const BOARD_TEMPLATES: Record<string, BoardTemplate> = {
  'value-chain': {
    key: 'value-chain',
    title: 'Value Chain',
    titleKey: 'dashboard.boardTemplate.valueChain',
    anchor: { workspace: 'erp' },
    sections: [
      { title: 'Procurement', titleKey: 'dashboard.boardTemplate.section.procurement', countableKeys: ['procurement.awaiting_approval', 'procurement.open_orders'] },
      { title: 'Stock', titleKey: 'dashboard.boardTemplate.section.stock', countableKeys: ['inventory.reorder_due', 'inventory.held_reservations'] },
      { title: 'Manufacturing', titleKey: 'dashboard.boardTemplate.section.manufacturing', countableKeys: ['manufacturing.open_work_orders', 'manufacturing.mrp_suggestions'] },
      { title: 'Floor', titleKey: 'dashboard.boardTemplate.section.floor', countableKeys: ['warehouse.tasks_pending', 'warehouse.tasks_in_progress'] },
      {
        title: 'Sales',
        titleKey: 'dashboard.boardTemplate.section.sales',
        countableKeys: [
          'crm_lead.untouched', 'crm_lead.unassigned',
          'crm_opportunity.open_deals', 'crm_opportunity.overdue',
          'commerce_order.awaiting_fulfillment', 'commerce_order.unpaid',
        ],
      },
      { title: 'Returns', titleKey: 'dashboard.boardTemplate.section.returns', countableKeys: ['commerce_return.awaiting_decision', 'commerce_return.awaiting_goods'] },
    ],
  },

  /**
   * The CRM workspace's own board — the same lead/deal cards the value chain
   * borrows for its "Sales" stage, read the way a salesperson reads them:
   * what has nobody touched, and what is slipping.
   *
   * Two sections rather than one because they are two different questions
   * asked of two different people: "untouched / unassigned" is a queue an
   * operations lead works through, "open / overdue" is a forecast a manager
   * reads. A single grid of four numbers would have neither meaning.
   */
  'sales-pipeline': {
    key: 'sales-pipeline',
    title: 'Sales Pipeline',
    titleKey: 'dashboard.boardTemplate.salesPipeline',
    anchor: { workspace: 'crm' },
    sections: [
      { title: 'Leads', titleKey: 'dashboard.boardTemplate.section.leads', countableKeys: ['crm_lead.untouched', 'crm_lead.unassigned'] },
      { title: 'Deals', titleKey: 'dashboard.boardTemplate.section.deals', countableKeys: ['crm_opportunity.open_deals', 'crm_opportunity.overdue'] },
    ],
  },

  /**
   * The Commerce workspace's board — the shop's day, in the order a shopkeeper
   * asks about it: what is for sale, what has been ordered and not yet sent,
   * what has been billed and not yet paid, and what is coming back.
   *
   * Every key here is already published by a `dashboard:countable`
   * contribution; nothing new is counted for the template's sake. A section
   * whose module a tenant has not installed simply renders no cards — the card
   * grid asks the same permission-and-activation-aware endpoint the rest of
   * the dashboard does.
   */
  'storefront-health': {
    key: 'storefront-health',
    title: 'Storefront Health',
    titleKey: 'dashboard.boardTemplate.storefrontHealth',
    anchor: { workspace: 'commerce' },
    sections: [
      { title: 'Catalogue', titleKey: 'dashboard.boardTemplate.section.catalogue', countableKeys: ['commerce_catalog.products', 'coupon.coupons'] },
      { title: 'Orders', titleKey: 'dashboard.boardTemplate.section.orders', countableKeys: ['commerce_order.awaiting_fulfillment', 'commerce_order.unpaid'] },
      { title: 'Money', titleKey: 'dashboard.boardTemplate.section.money', countableKeys: ['invoice.invoices', 'payment.payments'] },
      { title: 'Returns', titleKey: 'dashboard.boardTemplate.section.returns', countableKeys: ['commerce_return.awaiting_decision', 'commerce_return.awaiting_goods'] },
    ],
  },

  /**
   * Faz 9, dilim 9.4's example module-anchored template — the first real
   * registration on `BoardTemplateAnchor.moduleId` (the mechanism itself was
   * generalised in dilim 9.1; this is the row that was still missing). Applied
   * from `crm_opportunity`'s own board (`module-board.page.tsx`), the same
   * "start from a template" entry a workspace board already offers.
   *
   * Reuses the two keys `sales-pipeline` already reads (a countable key is not
   * spent by one template — the boundary test's "used at most once" rule is
   * per-template, not global) because they are exactly what this module's OWN
   * board should open on: nobody visiting `crm_opportunity`'s board wants a
   * different pipeline number than the CRM workspace shows for it.
   */
  'pipeline-overview': {
    key: 'pipeline-overview',
    title: 'Pipeline Overview',
    titleKey: 'dashboard.boardTemplate.pipelineOverview',
    anchor: { moduleId: 'crm_opportunity' },
    sections: [
      { title: 'Deals', titleKey: 'dashboard.boardTemplate.section.deals', countableKeys: ['crm_opportunity.open_deals', 'crm_opportunity.overdue'] },
    ],
  },
}

/**
 * Every template a workspace offers. Order is the dictionary's, which is code
 * order. `pool` defaults to the built-ins; pass the merged list (built-in +
 * contributed, `board-template.registry.ts`) to include contributions.
 */
export function templatesForWorkspace(workspace: string, pool: BoardTemplate[] = Object.values(BOARD_TEMPLATES)): BoardTemplate[] {
  return pool.filter((tpl) => tpl.anchor.workspace === workspace)
}

/** Every template a module offers (Faz 9, K13) — `pipeline-overview` (`crm_opportunity`) is the first. */
export function templatesForModule(moduleId: string, pool: BoardTemplate[] = Object.values(BOARD_TEMPLATES)): BoardTemplate[] {
  return pool.filter((tpl) => tpl.anchor.moduleId === moduleId)
}

/**
 * The templates the "New dashboard" dialog offers (phase 49b, `?for=new`): every template of placements, whatever it is filed under (a new board
 * of its own is made from it, never an anchor's default), by title. The section templates are a workspace's own overview and stay in that
 * workspace's gallery.
 */
export function templatesForNewBoard(pool: BoardTemplate[] = Object.values(BOARD_TEMPLATES), enabled?: ReadonlySet<string>): BoardTemplate[] {
  return pool
    .filter((t) => !!t.placements?.length && placeableAnywhere(t, enabled))
    .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key))
}

/**
 * A template filed under a module is offered as a board of its own only while that module is on for the tenant (its cards read that module's
 * data: "Line live" reads `manufacturing`'s), the rule its own module board already follows (K15); and only while every module it `requires` is
 * on (R49b-3). Without the set, every template counts.
 */
export function placeableAnywhere(template: Pick<BoardTemplate, 'anchor' | 'requires'>, enabled?: ReadonlySet<string>): boolean {
  return !enabled || ((!template.anchor.moduleId || enabled.has(template.anchor.moduleId)) && requiredModulesOn(template, enabled))
}

/**
 * Every module the template's cards read (`requires`) is on for the tenant (phase 49b review, R49b-3): the rule of every gallery, the preview
 * and every apply, whatever the template is filed under. Without the set, every template counts.
 */
export function requiredModulesOn(template: Pick<BoardTemplate, 'requires'>, enabled?: ReadonlySet<string>): boolean {
  return !enabled || (template.requires ?? []).every((m) => enabled.has(m))
}

/** How many cards a template would place — what a preview promises. */
export function templateCardCount(template: BoardTemplate): number {
  if (template.placements) return template.placements.length
  return (template.sections ?? []).reduce((sum, section) => sum + section.countableKeys.length, 0)
}
