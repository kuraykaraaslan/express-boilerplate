import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import { DashboardWidgetVersion } from './entities/dashboard_widget_version.entity'
import DashboardWidgetService, { assertNotSystem, lockOwnWidget, type WidgetViewer } from './widget.crud.service'
import { applyPinnedSnapshot, applyPublishedSnapshot } from './widget-snapshot'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { definitionDefaultsOf, kindForWidget } from './widget-settings'
import { assertPlacementGuards, effectiveKindSettings, isGuardedType } from './placement-guard'
import { deriveSchemaOps, nextTenantTemplate, publishedSchema, type FieldRename } from './tenant-template'
import { parseTenantLine } from './tenant-template.schema'
import MSG from './dashboard.messages'
import { assertKindAvailable, kindTypeOf } from './widget-kind-groups'
import { WIDGET_ACTIONS, availableActions, assertLegal, type WidgetAction } from './widget.transitions'

export default class DashboardWidgetPublishingService {
  /** What this widget can do next — re-exported so callers need one import. */
  static availableActions = availableActions

  /**
   * Publish: snapshot the definition and move `publishedVersion` forward.
   *
   * The snapshot is what a pinned placement renders, so it is taken at publish
   * time and never touched again — editing the widget afterwards writes the next
   * draft, not this row. Publishing an already-published widget is legal and
   * cuts a new version; that is how an author ships a fix.
   *
   * Phase 21.8: a tenant-authored widget's settings template (`tenant:<type>`) moves here too. The
   * schema being published is compared with the one last published; a change old settings cannot be
   * read with (a rename the author names in `renames`, a removed or retyped field, a removed option, a
   * narrowed range, a changed default) bumps the template version and appends one step of declarative
   * ops, which placements then migrate through at read and on save. A builtin, or a preset of one,
   * follows its code-owned template and is left alone.
   *
   * 7c: a removed field is published deprecated first and dropped by the next publish
   * (`publishedSchema`). The markers live on the SNAPSHOT only; the live row keeps the author's draft.
   */
  static async publish(
    tenantId: string,
    widgetId: string,
    viewer: WidgetViewer,
    changelog?: string | null,
    opts: { renames?: FieldRename[]; keepOldDefaults?: boolean } = {},
  ): Promise<{ widget: DashboardWidget; version: DashboardWidgetVersion }> {
    // On the LOCKED widget: two publishes (a double click, two editors) used
    // to read the same publishedVersion and both write version N+1 — a
    // duplicate or a unique-violation 500 — and publish saved the whole
    // widget, overwriting a draft edit made in between.
    return withTenantTransactionFor(tenantId, async (qr) => {
    const widget = await lockOwnWidget(qr, tenantId, widgetId, viewer)
    assertNotSystem(widget)
    assertLegal(widget.status, 'publish')
    // A preset of a kind whose module is off for this tenant stays a draft (`dashboard:widget_kinds`).
    await assertKindAvailable(tenantId, kindTypeOf(widget))

    const nextVersion = (widget.publishedVersion ?? 0) + 1
    const versionRepo = qr.manager.getRepository(DashboardWidgetVersion)
    // A preset's defaults reach its placements on publish: the guards of its kind judge them against the version
    // published last (none on a first publish), 31 (C4).
    const builtin = kindForWidget(widget)
    if (builtin && await isGuardedType(builtin.type)) {
      const last = widget.publishedVersion != null
        ? await versionRepo.findOne({ where: { tenantId, widgetId, version: widget.publishedVersion } })
        : null
      await assertPlacementGuards({
        tenantId,
        widgetType: builtin.type,
        settings: effectiveKindSettings(builtin, null, definitionDefaultsOf(widget)),
        previous: last ? effectiveKindSettings(builtin, null, definitionDefaultsOf((last.snapshot ?? {}) as DashboardWidget)) : null,
      })
    }
    let template: Pick<DashboardWidget, 'settingsTemplate' | 'settingsMigrations'> = {}
    let snapshotSchema: object | null | undefined = widget.schema
    if (!kindForWidget(widget)) {
      // The last PUBLISHED definition is the baseline, not the live row (that is the draft being published).
      const previous = widget.publishedVersion != null
        ? await versionRepo.findOne({ where: { tenantId, widgetId, version: widget.publishedVersion } })
        : null
      const derived = deriveSchemaOps((previous?.snapshot ?? null) as DashboardWidget | null, widget, opts)
      if (derived.invalidRenames.length) {
        throw new AppError(`${MSG.SETTINGS_RENAME_INVALID}: ${derived.invalidRenames.map((r) => `${r.from} -> ${r.to}`).join(', ')}`, 422, ErrorCode.VALIDATION_ERROR)
      }
      // A first publish has nothing to migrate from: the template starts at v1 (D-21.3).
      const next = nextTenantTemplate(widget.type, widget, previous ? derived : { ops: [], defaultChanges: [], changes: [] })
      // A line this app writes must import elsewhere (7a): the import parser is the one check of both.
      if (next.bumped) {
        const line = parseTenantLine({ settingsTemplate: next.settingsTemplate, settingsMigrations: next.settingsMigrations })
        if (!line.ok) throw new AppError(`${MSG.SETTINGS_LINE_INVALID}: ${line.reason}`, 422, ErrorCode.VALIDATION_ERROR)
      }
      template = { settingsTemplate: next.settingsTemplate, settingsMigrations: next.settingsMigrations }
      Object.assign(widget, template)
      const prevSchema = (previous?.snapshot as { schema?: object | null } | null | undefined)?.schema
      snapshotSchema = publishedSchema(widget.schema, prevSchema, derived, next.settingsTemplate.version, { firstPublish: !previous })
    }
    const version = await versionRepo.save(versionRepo.create({
      tenantId,
      widgetId,
      version: nextVersion,
      snapshot: { ...widget, schema: snapshotSchema },
      changelog: changelog ?? null,
      publishedByUserId: viewer.userId,
    }))

    const patch = { status: 'PUBLISHED', publishedVersion: nextVersion, revision: widget.revision + 1, ...template }
    await qr.manager.getRepository(DashboardWidget).update({ tenantId, widgetId }, patch as never)
    return { widget: Object.assign(widget, patch), version }
    })
  }

  /**
   * Every other transition. Deliberately does NOT touch `publishedVersion`:
   * archiving a widget stops it being offered in the library, but boards that
   * already carry it keep rendering the version they follow. Yanking live boards
   * is a separate, explicit act (delete, which is refused while in use).
   */
  static async transition(
    tenantId: string,
    widgetId: string,
    action: Exclude<WidgetAction, 'publish'>,
    viewer: WidgetViewer,
  ): Promise<DashboardWidget> {
    // Transition checked on the locked row; only status + revision written.
    return withTenantTransactionFor(tenantId, async (qr) => {
      const widget = await lockOwnWidget(qr, tenantId, widgetId, viewer)
      assertNotSystem(widget)
      assertLegal(widget.status, action)
      const patch = { status: WIDGET_ACTIONS[action].to, revision: widget.revision + 1 }
      await qr.manager.getRepository(DashboardWidget).update({ tenantId, widgetId }, patch as never)
      return Object.assign(widget, patch)
    })
  }

  static async listVersions(
    tenantId: string,
    widgetId: string,
    viewer: WidgetViewer,
  ): Promise<DashboardWidgetVersion[]> {
    await DashboardWidgetService.get(tenantId, widgetId, viewer)
    return withTenantRepositoryFor(tenantId, DashboardWidgetVersion, (repo) => repo.find({
      where: { tenantId, widgetId },
      order: { version: 'DESC' },
    }))
  }

  /**
   * The definition a placement should render: the pinned snapshot when it pins
   * one, otherwise the live row. A pin naming a version that no longer exists
   * falls back to live rather than rendering nothing — a deleted version should
   * degrade, not blank the card. Only the definition fields come from the
   * snapshot (`applyPinnedSnapshot`); status, versions and ownership stay live.
   */
  static async resolveForPlacement(
    tenantId: string,
    widgetId: string,
    pinnedVersion: number | null | undefined,
    viewer: WidgetViewer,
  ): Promise<DashboardWidget> {
    const live = await DashboardWidgetService.get(tenantId, widgetId, viewer)
    if (pinnedVersion == null) return live
    const snapshot = await withTenantRepositoryFor(tenantId, DashboardWidgetVersion, (repo) =>
      repo.findOne({ where: { tenantId, widgetId, version: pinnedVersion } }))
    return snapshot ? applyPinnedSnapshot(live, snapshot.snapshot as object | null) : live
  }

  /**
   * The snapshots of several pinned versions in one query (7b), keyed `<widgetId>@<version>`. Read with
   * the caller's tenant in every clause, so another tenant's version rows are never seen.
   */
  static async pinnedSnapshots(tenantId: string, pins: Array<{ widgetId: string; version: number }>): Promise<Map<string, object>> {
    const unique = [...new Map(pins.map((p) => [`${p.widgetId}@${p.version}`, p])).values()]
    if (unique.length === 0) return new Map()
    const rows = await withTenantRepositoryFor(tenantId, DashboardWidgetVersion, (repo) => repo.find({
      where: unique.map((p) => ({ tenantId, widgetId: p.widgetId, version: p.version })),
    }))
    return new Map(rows.filter((v) => v.tenantId === tenantId).map((v) => [`${v.widgetId}@${v.version}`, v.snapshot as object]))
  }

  /**
   * Swap each tenant-authored row's definition for the snapshot of the version it
   * last published (15.4a). Platform rows (`isSystem`) have no version rows and are
   * returned as they are; a row whose snapshot is missing degrades to live, the same
   * rule `resolveForPlacement` follows.
   */
  static async overlayPublished<T extends { widgetId: string; isSystem?: boolean; publishedVersion?: number | null }>(
    tenantId: string,
    rows: T[],
  ): Promise<T[]> {
    const versioned = rows.filter((r) => !r.isSystem && r.publishedVersion != null)
    if (versioned.length === 0) return rows
    const snapshots = await withTenantRepositoryFor(tenantId, DashboardWidgetVersion, (repo) => repo.find({
      where: versioned.map((r) => ({ tenantId, widgetId: r.widgetId, version: r.publishedVersion as number })),
    }))
    const byWidget = new Map(snapshots.map((v) => [v.widgetId, v.snapshot]))
    return rows.map((r) => (byWidget.has(r.widgetId) ? applyPublishedSnapshot(r, byWidget.get(r.widgetId)) : r))
  }
}
