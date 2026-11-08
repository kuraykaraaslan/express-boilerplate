import type { NextRequest } from 'next/server'
import { resolvePlacedWidgets, type WidgetDescriptor } from './widget-catalog.service'
import { VALUE_CHAIN_WIDGET_REF, type BoardTemplate } from './board-templates'
import { BUILTIN_REF_PATTERN } from './board-template.schema'
import { listRootPublishedWidgets } from './widget.root-catalog'
import type { dashboardContext } from './dashboard.route.helpers'

type Ctx = Awaited<ReturnType<typeof dashboardContext>>

/** Every widget ref a template places, its fallback cards' too (phase 49b; sections place one known manifest widget). */
export function templateRefs(template: BoardTemplate): string[] {
  return template.placements?.length
    ? [...new Set(template.placements.flatMap((p) => [p.widgetRef, ...(p.fallback ? [p.fallback.widgetRef] : [])]))]
    : [VALUE_CHAIN_WIDGET_REF]
}

/**
 * The widgets of a template this caller may actually place or see, resolved
 * EXACTLY as a manual placement is (`resolvePlacedWidgets`), plus the K10 rule: a
 * PRIVATE widget never lands on a shared board. Used by both apply and the
 * transient render, so what a preview shows is what an apply would store.
 */
export async function resolveTemplateWidgets(args: {
  request: NextRequest
  tenantId: string
  ctx: Ctx
  template: BoardTemplate
  targetScope: 'TENANT' | 'PRIVATE'
}): Promise<{ descriptors: Map<string, WidgetDescriptor>; resolvable: Set<string> }> {
  const { request, tenantId, ctx, template, targetScope } = args
  const descriptors = await resolvePlacedWidgets({
    request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
    refs: templateRefs(template),
  })
  const resolvable = new Set(
    [...descriptors.entries()]
      .filter(([, d]) => targetScope !== 'TENANT' || d.visibility !== 'PRIVATE')
      .map(([ref]) => ref),
  )
  return { descriptors, resolvable }
}

/**
 * Replace `builtin:<type>` refs with the `db:<widgetId>` the platform published
 * for that type. A type with no published row keeps its `builtin:` ref, which
 * resolves to nothing and is therefore skipped and reported by name — never
 * guessed at. Pure function of the template and the catalogue rows.
 */
export function expandBuiltinRefs(template: BoardTemplate, byType: Map<string, string>): BoardTemplate {
  if (!hasBuiltinRef(template)) return template
  const expand = (ref: string): string => {
    const m = BUILTIN_REF_PATTERN.exec(ref)
    const id = m ? byType.get(m[1]) : undefined
    return id ? `db:${id}` : ref
  }
  return {
    ...template,
    placements: template.placements!.map((p) => {
      const widgetRef = expand(p.widgetRef)
      const fallback = p.fallback ? { ...p.fallback, widgetRef: expand(p.fallback.widgetRef) } : p.fallback
      return widgetRef === p.widgetRef && fallback?.widgetRef === p.fallback?.widgetRef ? p : { ...p, widgetRef, ...(fallback ? { fallback } : {}) }
    }),
  }
}

/** A template names a `builtin:` ref, on a card or on a fallback card. */
const hasBuiltinRef = (template: BoardTemplate): boolean =>
  !!template.placements?.some((p) => BUILTIN_REF_PATTERN.test(p.widgetRef) || (!!p.fallback && BUILTIN_REF_PATTERN.test(p.fallback.widgetRef)))

export async function expandTemplate(tenantId: string, template: BoardTemplate): Promise<BoardTemplate> {
  if (!hasBuiltinRef(template)) return template
  const rows = await listRootPublishedWidgets(tenantId)
  return expandBuiltinRefs(template, new Map(rows.map((r) => [r.type, r.widgetId])))
}
