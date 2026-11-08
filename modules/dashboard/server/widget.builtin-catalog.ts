import 'reflect-metadata'
import type { Repository } from 'typeorm'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import type { FieldSchema } from './data-source.types'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import { BUILTIN_COMPONENT_PREFIX, COMPONENT_FILE } from './builtin-component-files'
import { BUILTIN_KINDS } from '@kuraykaraaslan-labs/common/server/widget-settings/templates/index'
import type { TemplateField } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/types'

/**
 * The platform's ready-made DATA widgets — phase 4b's "grafikler" half
 * (`docs/phases/07-dashboard/03-data-binding.md` §3.7, `07-phases-and-tests.md` Faz 4).
 *
 * ## Why these are rows and not manifest widgets
 *
 * A manifest widget is a self-contained component: it fetches whatever it wants
 * and takes no binding — `instance.crud.service.ts` refuses a binding on one by
 * name (422), because a `manifest:` ref has no `dataSpec` to check the slot
 * names against. A chart is the opposite kind of thing: the component knows how
 * to draw a series and nothing at all about WHICH series, which is exactly the
 * split `dataSpec` (definition) / `dataBinding` (placement) exists for. So these
 * live where a bindable definition can live — a `dashboard_widgets` row.
 *
 * ## Why they are published from the ROOT tenant rather than seeded per tenant
 *
 * D1 (owner, 2026-09-03). A copy per tenant is N rows and N versions: the day
 * the platform improves a chart the fix reaches nobody who already has it, and a
 * stale copy is indistinguishable from an edit somebody made on purpose.
 * `widget.root-catalog.ts` reads the platform's published rows through from root,
 * and `DashboardWidgetService.list/get` already merge them with a tenant's own —
 * a tenant that copies one and changes it keeps theirs (collision resolved on
 * `type`). This file is the code-defined SOURCE of those rows; `publishBuiltinWidgets`
 * is the idempotent write that materialises them.
 *
 * ## Why `componentId` is a first-party path and never client-authorable
 *
 * `CreateWidgetDTO`/`UpdateWidgetDTO` are `.strict()` and carry no `componentId`
 * — a tenant naming one would be able to mount any shipped component. These rows
 * are written by the platform, and the client resolves the id in a FIXED list
 * (`builtin-component-files.ts`, rendered by WidgetKit through `BuiltinPlacement`),
 * not in the generated module component map, so an id that is not one of ours
 * resolves to nothing.
 */

export interface BuiltinDataSlot {
  key: string
  label: string
  shape: 'scalar' | 'series' | 'table' | 'record'
  required: boolean
  /** May be bound to several sources (18.3). */
  repeatable?: boolean
}

export interface BuiltinWidgetDef {
  /** Stable slug — also the collision key against a tenant's own widgets. */
  type: string
  label: string
  /** A core category, or a CONTRIBUTABLE_FALLBACKS key (resolved via the registry). */
  category: string
  description: string
  /** Key into the first-party builtin component map (client side). */
  componentId: string
  /** Per-placement settings, rendered by the shared schema-form. */
  schema: Record<string, FieldSchema>
  defaultProps: Record<string, unknown>
  dataSpec: BuiltinDataSlot[]
  defaultW: number
  defaultH: number
  icon: string
  /** The versioned settings template (phase 21) placements of this type are validated with. */
  settingsTemplate: { id: string; version: number }
}

/** Every builtin resolves its component under this prefix — asserted in tests. */
export { BUILTIN_COMPONENT_PREFIX }

/** A template's fields as the row's `schema` (a display cache; code stays the authority). */
function schemaOf(fields: Record<string, TemplateField>): Record<string, FieldSchema> {
  const out: Record<string, FieldSchema> = {}
  for (const [k, f] of Object.entries(fields)) {
    if (f.deprecated) continue
    const field: Record<string, unknown> = { ...f }
    delete field.since
    delete field.deprecated
    out[k] = field as unknown as FieldSchema
  }
  return out
}

/** Every builtin, generated from the WidgetKit kind specs (one source of truth for both repos). */
export const BUILTIN_DATA_WIDGETS: BuiltinWidgetDef[] = BUILTIN_KINDS.map((k) => {
  const file = COMPONENT_FILE[k.type]
  if (!file) throw new Error(`widget.builtin-catalog: no component for builtin type ${k.type}`)
  return {
    type: k.type,
    label: k.label,
    category: k.category,
    description: k.description,
    componentId: `${BUILTIN_COMPONENT_PREFIX}${file}`,
    schema: schemaOf(k.template.fields),
    // Defaults live in the template (code), layered at read time; nothing is frozen onto the row.
    defaultProps: {},
    dataSpec: k.slots.map((sl) => ({ key: sl.key, label: sl.label, shape: sl.shape, required: sl.required, ...(sl.repeatable ? { repeatable: true } : {}) })),
    defaultW: k.defaultW,
    defaultH: k.defaultH,
    icon: k.icon,
    settingsTemplate: { id: k.template.id, version: k.template.version },
  }
})

/** The row a builtin definition materialises to in the root tenant. */
export function builtinWidgetRow(def: BuiltinWidgetDef): Partial<DashboardWidget> {
  return {
    tenantId: ROOT_TENANT_ID,
    type: def.type,
    label: def.label,
    category: def.category,
    description: def.description,
    schema: def.schema as unknown as object,
    defaultProps: def.defaultProps,
    template: '',
    renderTier: 'component',
    componentId: def.componentId,
    dataSpec: def.dataSpec,
    defaultW: def.defaultW,
    defaultH: def.defaultH,
    icon: def.icon,
    settingsTemplate: def.settingsTemplate,
    // The three conditions `listRootPublishedWidgets` requires, together: a
    // platform widget that is not all three is simply invisible to tenants.
    isSystem: true,
    visibility: 'TENANT',
    status: 'PUBLISHED',
    publishedVersion: 1,
    ownerUserId: null,
    source: 'platform',
  }
}

/** JSON with object keys sorted: a jsonb column comes back with its keys in Postgres' order, not the code's. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  )) ?? 'undefined'
}

/** Whether `existing` already carries every platform-owned field of `row` (null and undefined are the same absence). */
function rowIsCurrent(existing: DashboardWidget, row: Partial<DashboardWidget>): boolean {
  const current = existing as unknown as Record<string, unknown>
  return Object.entries(row).every(([key, value]) => canonical(current[key] ?? null) === canonical(value ?? null))
}

export interface BuiltinPublishResult {
  created: number
  updated: number
  /** Rows already identical to the code: not written at all (no `updatedAt` bump). */
  unchanged: number
}

/**
 * Materialise the builtin catalogue into the root tenant, idempotently.
 *
 * Upsert on `type` (the row's natural key, `@Unique(['tenantId','type'])`) so
 * running it twice is a no-op and improving a definition in code is a rerun
 * rather than a migration. Only the platform's OWN fields are written: a row's
 * `widgetId` survives, which is what placements point at — republishing must not
 * silently empty every board that carries a chart. A row that already matches
 * the code is not saved at all, so a deploy that changed no definition writes
 * nothing; `publishedVersion` is the constant 1 and `revision` is never written,
 * so a rerun bumps no version. Only root-tenant rows are touched: a tenant's own
 * copy of a builtin (collision on `type`) is theirs and never read here.
 */
export async function publishBuiltinWidgets(
  repo: Repository<DashboardWidget>,
): Promise<BuiltinPublishResult> {
  let created = 0
  let updated = 0
  let unchanged = 0
  for (const def of BUILTIN_DATA_WIDGETS) {
    const row = builtinWidgetRow(def)
    const existing = await repo.findOne({ where: { tenantId: ROOT_TENANT_ID, type: def.type } })
    if (existing && rowIsCurrent(existing, row)) {
      unchanged += 1
    } else if (existing) {
      await repo.save(repo.merge(existing, row as DashboardWidget))
      updated += 1
    } else {
      await repo.save(repo.create(row as DashboardWidget))
      created += 1
    }
  }
  return { created, updated, unchanged }
}

/** `publishBuiltinWidgets` against the root tenant's own connection (the runtime DataSource). */
export async function publishBuiltinWidgetsToRoot(): Promise<BuiltinPublishResult> {
  // Loaded here, not at the top: this file is also imported by the db:post_deploy step
  // (dashboard.post-deploy.ts), which runs inside the deploy and must not open the runtime
  // DataSource or a Redis client (an open client keeps the deploy process alive).
  const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db')
  const { bustRootWidgetCache } = await import('./widget.root-catalog')
  // One transaction for the whole catalogue: a half-published catalogue is
  // not left behind. Cache busted after commit.
  const result = await withTenantTransactionFor(ROOT_TENANT_ID, (qr) =>
    publishBuiltinWidgets(qr.manager.getRepository(DashboardWidget)))
  await bustRootWidgetCache()
  return result
}
