import 'reflect-metadata'
import { z } from 'zod'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import DASHBOARD_MESSAGES from './dashboard.messages'
import { CreateWidgetDTO } from './widget.dto'
import { TENANT_TEMPLATE_PREFIX, tenantTemplateId } from './tenant-template'
import { parseTenantLine, type TenantLine } from './tenant-template.schema'

/**
 * Widget import / export (dashboard plan 04 §4.4).
 *
 * Semantics are lifted from `dynamic_page.block.service`'s block transfer —
 * `overwrite`/`skip`, a type collision refused by name, and a system row that
 * an import can never overwrite. Copying the semantics rather than inventing
 * new ones matters: an operator who has moved blocks between tenants already
 * knows what this does.
 *
 * ## Only `template` widgets travel, and that is not a limitation
 *
 * A `component` widget IS its `componentId` — a pointer at first-party code
 * that may not exist in the target tenant — and a `frame` widget IS its
 * `frameListingId`, which is `marketplace`'s to move between tenants, not
 * ours. The plan says neither field is carried; the consequence, spelled out,
 * is that exporting such a row would produce a package that imports into a
 * widget pointing at nothing. So they are skipped at export with a count, the
 * same way `isSystem` blocks are.
 *
 * ## What else stays behind, and why
 *
 * `ownerUserId` (a person in THIS tenant), `source`/`listingId`/
 * `listingVersion` (provenance is re-derived where it lands),
 * `revision`/`publishedVersion` (a history the target does not have), and
 * `status` — an import always arrives as a DRAFT, because publishing is a
 * deliberate act in the target tenant and a package must not be able to put
 * live content on somebody's dashboard.
 *
 * ## The settings template line travels with the published definition (7a)
 *
 * A widget that has been published exports its PUBLISHED definition (the
 * version snapshot: schema with its 7c deprecation markers, template,
 * defaults, data slots) together with its `tenant:<type>` template line
 * (`settingsTemplate` + `settingsMigrations`), so cards on boards exported
 * from the source keep migrating in the target. Draft edits made since the
 * last publish do not travel; a widget never published exports its draft and
 * no line. On import the line is parsed as untrusted input
 * (`tenant-template.schema.ts`; an invalid one skips the widget), re-keyed to
 * `tenant:<type>`, and the row still arrives as a DRAFT: its first publish
 * keeps the carried version and steps. An overwrite takes the package's line
 * only when the target was never published; a published target keeps its own
 * line, and the result says so in `notes`.
 */

/** The package's widget shape. Exactly the plan's field list, plus geometry. */
const PackagedWidgetSchema = z.object({
  type: z.string(),
  label: z.string(),
  category: z.string().optional(),
  description: z.string().nullable().optional(),
  renderTier: z.literal('template').optional(),
  template: z.string().optional(),
  schema: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  defaultProps: z.record(z.string(), z.unknown()).optional(),
  dataSpec: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  icon: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  // Not in the plan's list, added deliberately: a widget that lands at the
  // wrong size is a broken import, and the two numbers carry no tenant
  // coupling whatsoever.
  defaultW: z.number().int().optional(),
  defaultH: z.number().int().optional(),
  // 7a: the template line, typed loosely here and parsed strictly at import (`parseTenantLine`). The package
  // `version` stays 1: an older app strips these fields and imports the widget as before.
  settingsTemplate: z.unknown().optional(),
  settingsMigrations: z.unknown().optional(),
})
export type PackagedWidget = z.infer<typeof PackagedWidgetSchema>

/**
 * A package holds ONE widget or MANY. A single `widget` is what somebody
 * shares; a `widgets` array is what a tenant backs up. Accepting both means a
 * package pasted from a colleague works without being reshaped first.
 */
export const WidgetPackageSchema = z.object({
  format: z.literal('widget-package'),
  version: z.literal(1),
  widget: PackagedWidgetSchema.optional(),
  widgets: z.array(PackagedWidgetSchema).max(500).optional(),
}).refine((p) => Boolean(p.widget || p.widgets?.length), {
  message: 'A widget package must contain `widget` or a non-empty `widgets`',
})
export type WidgetPackage = z.infer<typeof WidgetPackageSchema>

export interface ExportResult {
  format: 'widget-package'
  version: 1
  widgets: PackagedWidget[]
  /** Rows deliberately left out, so an operator is never silently short. */
  skipped: { type: string; reason: string }[]
}

export interface ImportResult {
  created: number
  updated: number
  skipped: { type: string; reason: string }[]
  /** Widgets imported with something worth knowing (7a: a published target kept its own template line). */
  notes: { type: string; note: string }[]
}

/** `row` is the published definition when the widget was published (7a); only then does the line travel. */
function toPackaged(row: DashboardWidget): PackagedWidget {
  const line = row.publishedVersion != null && row.settingsTemplate?.id?.startsWith(TENANT_TEMPLATE_PREFIX)
    ? { settingsTemplate: row.settingsTemplate, settingsMigrations: row.settingsMigrations ?? [] }
    : {}
  return {
    type: row.type,
    label: row.label,
    category: row.category,
    description: row.description ?? null,
    renderTier: 'template',
    template: row.template,
    schema: (row.schema ?? {}) as PackagedWidget['schema'],
    defaultProps: (row.defaultProps ?? {}) as PackagedWidget['defaultProps'],
    dataSpec: (row.dataSpec ?? null) as PackagedWidget['dataSpec'],
    icon: row.icon ?? null,
    tags: row.tags ?? null,
    defaultW: row.defaultW,
    defaultH: row.defaultH,
    ...line,
  }
}

export default class WidgetTransferService {
  /**
   * Every portable widget the caller can see, with the omissions reported: the shared library
   * plus the caller's own PRIVATE widgets. Another member's PRIVATE widget is not in the read at
   * all (dashboard.02): the CRUD routes answer 404 for it, so the export must not name it either.
   * Without a viewer only the shared library is exported.
   */
  static async exportWidgets(tenantId: string, viewer?: { userId: string }): Promise<ExportResult> {
    const rows = await withTenantRepositoryFor(tenantId, DashboardWidget, (repo) => repo.find({
      where: [
        { tenantId, visibility: 'TENANT' },
        ...(viewer ? [{ tenantId, visibility: 'PRIVATE', ownerUserId: viewer.userId }] : []),
      ],
      order: { type: 'ASC' },
    }))
    // 7a: a published widget travels as it was last published (one batched read of the snapshots).
    const { default: DashboardWidgetPublishingService } = await import('./widget.publishing.service')
    const published = await DashboardWidgetPublishingService.overlayPublished(tenantId, rows)

    const widgets: PackagedWidget[] = []
    const skipped: ExportResult['skipped'] = []
    for (const row of published) {
      // Seeded first-party widgets belong to the platform, not to the tenant,
      // and exist in the target already — exporting them would produce an
      // import that either collides or duplicates what is already there.
      if (row.isSystem) { skipped.push({ type: row.type, reason: 'system widget' }); continue }
      if (row.renderTier !== 'template') {
        skipped.push({ type: row.type, reason: `${row.renderTier} widgets cannot travel (they point at code or a listing)` })
        continue
      }
      widgets.push(toPackaged(row))
    }
    return { format: 'widget-package', version: 1, widgets, skipped }
  }

  /**
   * Apply a package. `overwrite: false` (the default) leaves an existing type
   * untouched and reports it; `true` replaces its design fields.
   *
   * Defaults to NOT overwriting, unlike the block importer. A widget carries a
   * tenant's own layout work in its schema and template, and the safe direction
   * for a destructive default is "refuse and say so" — the operator can re-run
   * with the flag once they have read the skip list.
   */
  static async importWidgets(
    tenantId: string,
    pkg: WidgetPackage,
    /** `userId`: the importer; without it no PRIVATE row counts as theirs, so none is overwritten. */
    opts: { overwrite?: boolean; userId?: string } = {},
  ): Promise<ImportResult> {
    // An import creates SHARED rows, so it spends the shared plan limit like the create route
    // (dashboard.04), counted per row under the tenant's widget-quota lock. The limit is read once.
    // Lazy, like the root catalogue below: the plan gate is only needed once a package is applied.
    const { resolveWidgetLimit } = await import('./widget.entitlement')
    const limit = await resolveWidgetLimit(tenantId)

    const incoming = pkg.widgets ?? (pkg.widget ? [pkg.widget] : [])

    let created = 0
    let updated = 0
    const skipped: ImportResult['skipped'] = []
    const notes: ImportResult['notes'] = []

    for (const raw of incoming) {
      // 7a: the template line is not a widget field (the DTO is strict): taken out and parsed on its own.
      const { settingsTemplate: rawTemplate, settingsMigrations: rawSteps, ...fields } = raw
      let carried: TenantLine | null = null
      if (rawTemplate !== undefined || rawSteps !== undefined) {
        const line = parseTenantLine({ settingsTemplate: rawTemplate, settingsMigrations: rawSteps ?? [] })
        if (!line.ok) {
          skipped.push({ type: String(raw.type ?? '?'), reason: `invalid settings template line: ${line.reason}` })
          continue
        }
        carried = line.line
      }
      // Validated through the SAME DTO a hand-authored widget goes through, so
      // a package cannot smuggle in a shape the create route would refuse.
      // `componentId` / `frameListingId` are not accepted by it at all, which
      // is the guard against a package mounting arbitrary shipped code.
      const parsed = CreateWidgetDTO.safeParse({ ...fields, renderTier: 'template' })
      if (!parsed.success) {
        skipped.push({ type: String(raw.type ?? '?'), reason: parsed.error.issues[0]?.message ?? 'invalid widget' })
        continue
      }
      const data = parsed.data
      // Re-keyed to this widget's type: the id is only ever `tenant:<type>` (a renamed type keeps its line).
      const line = carried
        ? { settingsTemplate: { id: tenantTemplateId(data.type), version: carried.settingsTemplate.version }, settingsMigrations: carried.settingsMigrations }
        : null

      // Each widget in its own block, under the same per-(tenant, type) lock
      // widget create takes — an import racing a hand-made widget of the same
      // type no longer trips the unique index.
      const outcome = await withTenantTransactionFor(tenantId, async (qr) => {
      // The quota lock first (same order as widget create, so the two never deadlock), then the type lock.
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:widget-quota:${tenantId}`])
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`dashboard:widget-type:${tenantId}:${data.type}`])
      const repo = qr.manager.getRepository(DashboardWidget)
      // Lazy: the root catalogue reads redis and the platform tenant, which a transfer that never reaches a
      // collision check should not need to load.
      const { isPlatformWidgetType } = await import('./widget.root-catalog')
      if (await isPlatformWidgetType(tenantId, data.type)) return { skip: DASHBOARD_MESSAGES.WIDGET_TYPE_RESERVED }
      const existing = await repo.findOne({ where: { tenantId, type: data.type } })
      if (existing) {
        if (existing.isSystem) return { skip: 'a system widget of this type exists' }
        // Another member's PRIVATE widget is theirs (dashboard.03). The reason is the plain "type taken",
        // so the skip list does not tell the importer that a private widget of this type exists.
        if (existing.visibility === 'PRIVATE' && (!opts.userId || existing.ownerUserId !== opts.userId)) return { skip: DASHBOARD_MESSAGES.WIDGET_TYPE_TAKEN }
        if (!opts.overwrite) return { skip: DASHBOARD_MESSAGES.WIDGET_TYPE_TAKEN }
        // Only the design fields move. `isSystem`, ownership, provenance,
        // revision and publication state are the TARGET's facts about its own
        // row, and an import has no standing to rewrite them.
        Object.assign(existing, {
          label: data.label, category: data.category, description: data.description ?? null,
          template: data.template, schema: data.schema, defaultProps: data.defaultProps,
          dataSpec: data.dataSpec ?? null, icon: data.icon ?? null, tags: data.tags ?? null,
          defaultW: data.defaultW, defaultH: data.defaultH,
        })
        // 7a: a target never published has no cards on a line of its own, so it takes the package's. A published
        // one keeps its line: its cards are stamped on it, and its next publish diffs the new draft against it.
        let note: string | undefined
        if (existing.publishedVersion == null) {
          existing.settingsTemplate = line?.settingsTemplate ?? null
          existing.settingsMigrations = line?.settingsMigrations ?? null
        } else if (line) {
          note = `kept this tenant's settings template (v${existing.settingsTemplate?.version ?? 1}); the package's v${line.settingsTemplate.version} line was not applied to a published widget`
        }
        await repo.save(existing)
        return { updated: true, note }
      }

      // Re-counted under the quota lock (dashboard.14): a create that committed while this import ran is seen.
      if (limit !== Infinity && await repo.count({ where: { tenantId, isSystem: false, visibility: 'TENANT' } }) >= limit) {
        return { skip: DASHBOARD_MESSAGES.WIDGET_LIMIT_REACHED }
      }
      await repo.save(repo.create({
        ...data,
        ...(line ?? {}),
        tenantId,
        renderTier: 'template',
        isSystem: false,
        // A package never arrives published: putting live content on somebody
        // else's dashboard must be a decision made in the target tenant.
        status: 'DRAFT',
      } as Partial<DashboardWidget>))
      return { created: true }
      })
      if ('skip' in outcome) skipped.push({ type: data.type, reason: outcome.skip as string })
      else if ('updated' in outcome) {
        updated += 1
        if (outcome.note) notes.push({ type: data.type, note: outcome.note })
      } else created += 1
    }

    Logger.info(`[dashboard] widget import tenant=${tenantId} created=${created} updated=${updated} skipped=${skipped.length} notes=${notes.length}`)
    return { created, updated, skipped, notes }
  }
}

/** Parse an untrusted package body, or fail with a 422 rather than a 500. */
export function parseWidgetPackage(body: unknown): WidgetPackage {
  const parsed = WidgetPackageSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError(
      `${DASHBOARD_MESSAGES.WIDGET_PACKAGE_INVALID}: ${parsed.error.issues[0]?.message ?? 'unreadable'}`,
      422, ErrorCode.VALIDATION_ERROR,
    )
  }
  return parsed.data
}
