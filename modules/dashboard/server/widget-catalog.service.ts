import type { NextRequest } from 'next/server';
import { moduleRegistry, UNIVERSAL_WORKSPACE, type RuntimeWidget } from '@kuraykaraaslan-labs/common/server/module-registry';
import type { ModuleScope } from '@kuraykaraaslan-labs/common/server/module-manifest.types';
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes';
import { extWidgetContract, sceneContractOf, type SceneContract } from './ext-widget';
import { activeListingIds } from './dashboard.listing-activity';
import type { TenantMigrationStep } from './tenant-template';
import { needsCustomRoles, widgetAllowsMember } from './widget-roles.acl';
import { blockedKindTypes, builtinSceneContract, kindTypeOf } from './widget-kind-groups';
import { builtinKind } from '@kuraykaraaslan-labs/common/server/widget-settings/templates/index';
import {
  codeWords, englishLabels, explicitLabelKey, localizeActions, localizeFields, localizeSlots, widgetLabelKey, widgetShelfKey, type LabelText,
} from './contributed-labels';

/** The tenant's active custom role keys (`allowedRoles` matching); imported lazily, like the widget store. */
export async function activeCustomRoleKeys(tenantId: string): Promise<Set<string>> {
  const { default: TenantRoleService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_role.service');
  const { roles } = await TenantRoleService.roleSet(tenantId);
  return new Set(roles.filter((r) => !r.isBuiltin && r.isActive !== false).map((r) => r.key));
}

/**
 * One entry in the widget catalog, whatever it was declared as.
 *
 * `ref` is prefixed rather than a bare id because the catalog is a UNION and will
 * stay one: today every widget is `manifest:` — declared in a module.json and
 * resolved through the generated component map — and from phase 3 tenant-authored
 * definitions arrive as `db:`. Prefixing from the start means placing, favouriting
 * and counting usages never branch on which kind a widget is.
 */
export interface WidgetDescriptor {
  ref: `manifest:${string}` | `db:${string}` | `ext:${string}`;
  /** Stable id within its origin (the manifest widget id). */
  key: string;
  name: string;
  /** Component id in the generated client map — tier 1 only. */
  componentId: string;
  moduleId: string;
  /** Which renderer runs this: first-party React, or a tenant-authored template. */
  renderTier: 'component' | 'template' | 'iframe';
  /** Tier 2: the HTML document, rendered opaque-origin. */
  template?: string;
  /** Tier 3: the plugin_runtime listing whose UI bundle is framed. */
  frameListingId?: string | null;
  /** Field descriptors for the per-placement settings form. */
  schema?: Record<string, unknown>;
  defaultProps?: Record<string, unknown>;
  /** Abstract data slots (phase 4b §3.5); bound per placement. db widgets only. */
  dataSpec?: Array<{ key: string; label: string; shape: 'scalar' | 'series' | 'table' | 'record'; required: boolean; repeatable?: boolean }> | null;
  category?: string;
  icon?: string | null;
  origin: 'manifest' | 'tenant' | 'marketplace' | 'extension';
  /**
   * `TENANT` (shared) | `PRIVATE` (the author's own). Manifest and `ext:`
   * widgets carry no personal concept — they belong to whichever workspace/
   * module contributes them — so they are always `TENANT` here. Only a `db:`
   * definition can be `PRIVATE`, and only its own author's boards ever resolve
   * it (`resolvePlacedWidgets`'s visibility check). Used by
   * `assertWidgetPlaceable` (Faz 9, K10) to refuse placing a private widget on
   * a shared board — without this field that check would have to re-fetch the
   * row a second time.
   */
  visibility: 'TENANT' | 'PRIVATE';
  /** Width in 12-column grid units, derived from the manifest's t-shirt `size`. */
  w: number;
  /**
   * Height in grid row units (Faz 9, K8) — what the one-time `layoutVersion:
   * 1 → 2` repack places a newly-migrated card at, and what `firstFreeSlot`
   * uses when a widget is added fresh. Optional because nothing needed a
   * height before the free-positioning grid existed; a descriptor without
   * one degrades to a caller-chosen fallback rather than a required field
   * every origin has to invent a value for.
   */
  defaultH?: number;
  order: number;
  /**
   * K12: what a FRESH placement of this widget should start bound to — copied
   * onto the new instance's own `dataBinding` at add-time
   * (`board-view.component.tsx`'s `addWidget`). `db:` presets only; every
   * other origin has no such column and stays `undefined`.
   */
  defaultDataBinding?: Record<string, { sourceKey: string; queryKey: string; params: Record<string, unknown> }> | null;
  /** A contributed widget's own action sources (16.9): the events it can fire, keyed `<type>.<name>`. */
  actionSources?: Array<{ key: string; name: string; label: string; row: boolean }>;
  /**
   * Whether this row is a platform-shipped builtin (K12) — the one thing that
   * decides whether "Save as widget" (§6.5) may offer it as a preset base.
   * `undefined` for `manifest:`/`ext:` origins, which carry no such concept.
   */
  isSystem?: boolean;
  /**
   * 21.8: a `db:` widget's PUBLISHED settings template (`tenant:<type>` for a tenant-authored one) and
   * its declarative steps, so the board migrates a card's settings at read exactly as the server does
   * on save, and an export stamps them. `undefined` for other origins.
   */
  settingsTemplate?: { id: string; version: number } | null;
  settingsMigrations?: TenantMigrationStep[] | null;
  /**
   * An `ext:` contribution's promise (`metadata.displaySafe: true`) that it reads data only through its slots and
   * never calls the session API itself, so it may render on a display link's screen (decision #10, `display-safe.ts`).
   * `undefined` for other origins.
   */
  displaySafe?: boolean;
  /**
   * An `ext:` contribution that draws a scene bound to its page's subject (`metadata.sceneKind`, phase 42), or a placed builtin kind whose group
   * says it does (`dashboard:widget_kinds`, phase 42.5): the scene kind it
   * draws and the card setting that holds the card's own default document. Read by the open of a board (`scene-binding.open.ts`)
   * without knowing the widget. `undefined` for a widget that draws no scene.
   */
  sceneKind?: string;
  sceneDocumentSetting?: string;
  /**
   * The category line of a widget whose category the registry does not know, in the viewer's language (D551: the declaring module's
   * `<module>.dashboardWidgetShelf`); set only when the catalogue was read for a language other than English, where the picker
   * writes the module's name in words itself.
   */
  shelf?: string;
  /**
   * `dashboard:widget_kinds`: the builtin kind this placement renders belongs to a group whose module is not active for the
   * tenant. The placement is kept as stored and shows the inert "not available" card; `undefined` (never `false`) otherwise.
   * Only `resolvePlacedWidgets` sets it; the picker leaves such kinds out altogether.
   */
  unavailable?: boolean;
}

/**
 * Manifest `size` → 12-column grid width. The existing grid is 4 columns with
 * `SIZE_SPAN` mapping these to `lg:col-span-1..4`; ×3 preserves every current
 * layout exactly while giving phase 2's drag-resize a finer unit to snap to.
 */
const SIZE_W: Record<NonNullable<RuntimeWidget['size']>, number> = {
  small: 3,
  medium: 6,
  large: 9,
  full: 12,
};

/**
 * Manifest `size` → default grid HEIGHT (Faz 9, K8). Nothing read this before
 * the free-positioning grid existed — every widget just flowed at its natural
 * content height — so there was never a real answer to "how tall is a
 * `small` widget" until the grid engine needed one to repack a pre-Faz-9
 * board's geometry. `full`'s 8 (not `MAX_H`) is deliberately modest: a
 * full-width widget is usually a card ROW (the countable summary grid), not
 * a tall single card, and packing rows too tall wastes space above the fold.
 */
const SIZE_H: Record<NonNullable<RuntimeWidget['size']>, number> = {
  small: 4,
  medium: 6,
  large: 8,
  full: 8,
};

/** The shelf of a module's widgets in the language of `text` (none in English, see `WidgetDescriptor.shelf`). */
const shelfOf = (moduleId: string, text: LabelText): Pick<WidgetDescriptor, 'shelf'> =>
  (text === englishLabels ? {} : { shelf: text(widgetShelfKey(moduleId), codeWords(moduleId)) });

/**
 * A manifest widget as a catalog entry; `text` names it in the viewer's language (D551, `<module>.dashboardWidget.<id>`), English as
 * declared by default.
 */
const toDescriptor = (w: RuntimeWidget, text: LabelText = englishLabels): WidgetDescriptor => ({
  ref: `manifest:${w.id}`,
  key: w.id,
  name: w.name ? text(widgetLabelKey(w.moduleId, w.id), w.name) : w.id,
  ...shelfOf(w.moduleId, text),
  componentId: w.componentId,
  moduleId: w.moduleId,
  renderTier: 'component',
  origin: 'manifest',
  visibility: 'TENANT',
  w: SIZE_W[w.size ?? 'medium'],
  defaultH: SIZE_H[w.size ?? 'medium'],
  order: w.order,
});

/** The name of a platform builtin of `type` in the language of `text`: its kit template's label, else the stored name. */
export function builtinNameText(type: string, stored: string, text: LabelText): string {
  const templateId = text === englishLabels ? undefined : builtinKind(type)?.template.id;
  return templateId ? text(`dashboard.kit.tpl.${templateId}.label`, stored) : stored;
}

/**
 * A tenant-authored definition as a catalog entry.
 *
 * Only PUBLISHED widgets are placeable. A draft is the author's working copy, and
 * offering it would mean a board could carry something nobody has said is ready —
 * which is the entire point of having a publish step.
 */
export const toDbDescriptor = (widget: {
  widgetId: string; type: string; label: string; category: string;
  renderTier: string; template: string; schema: object; defaultProps: object;
  dataSpec?: object | null;
  defaultW: number; defaultH?: number; icon?: string | null; isSystem: boolean; source?: string | null;
  frameListingId?: string | null; componentId?: string | null; visibility: string;
  defaultDataBinding?: object | null;
  settingsTemplate?: { id: string; version: number } | null; settingsMigrations?: TenantMigrationStep[] | null;
}, text: LabelText = englishLabels): WidgetDescriptor => ({
  ref: `db:${widget.widgetId}`,
  key: widget.type,
  // a platform builtin is named by its kit template in the viewer's language (`dashboard.kit.tpl.builtin:<type>.label`, the settings
  // drawer's own words); a tenant's widget keeps the name its author gave it
  name: widget.source === 'platform' ? builtinNameText(widget.type, widget.label, text) : widget.label,
  // A row only carries a componentId when the PLATFORM wrote it (phase 4b's
  // builtin data widgets — `widget.builtin-catalog.ts`); the authoring DTOs are
  // `.strict()` and have no such field, so a tenant-authored row is always ''
  // and stays unable to mount shipped code.
  componentId: widget.componentId ?? '',
  moduleId: 'dashboard',
  renderTier: widget.renderTier as WidgetDescriptor['renderTier'],
  template: widget.template,
  frameListingId: widget.frameListingId ?? null,
  schema: widget.schema as Record<string, unknown>,
  defaultProps: widget.defaultProps as Record<string, unknown>,
  dataSpec: (widget.dataSpec ?? null) as WidgetDescriptor['dataSpec'],
  category: widget.category,
  icon: widget.icon ?? null,
  origin: widget.source === 'marketplace' ? 'marketplace' : 'tenant',
  // A marketplace row is always TENANT-visible (`createMaterializedWidget`
  // hardcodes it); `widget.visibility` is trusted here for the tenant-authored
  // case, which is the only one that can ever be 'PRIVATE'.
  visibility: widget.visibility === 'PRIVATE' ? 'PRIVATE' : 'TENANT',
  // a platform builtin's size is the code's (the kit's kind spec), not the stored row's: a row published before the kit changed a size kept the old one
  // (e2e round 4, M-R4-08: a Stat card still started one row high and its number was cut off)
  w: (widget.source === 'platform' ? builtinKind(widget.type)?.defaultW : undefined) ?? widget.defaultW,
  defaultH: (widget.source === 'platform' ? builtinKind(widget.type)?.defaultH : undefined) ?? widget.defaultH,
  order: 500,
  defaultDataBinding: (widget.defaultDataBinding ?? null) as WidgetDescriptor['defaultDataBinding'],
  isSystem: widget.isSystem,
  settingsTemplate: widget.settingsTemplate ?? null,
  settingsMigrations: widget.settingsMigrations ?? null,
});

/**
 * A `dashboard:widget` extension contribution as a catalog entry.
 *
 * `componentId` is the CONTRIBUTION id, not a component-map key: the component
 * itself lives in the generated client map for this point, which the browser
 * resolves by that id. Everything the server needs to filter and lay it out
 * comes from the contribution's `metadata`.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `sceneKind` and `sceneDocumentSetting` of a contribution that draws a scene, else nothing. */
function sceneOfMetadata(metadata: Record<string, unknown>): Pick<WidgetDescriptor, 'sceneKind' | 'sceneDocumentSetting'> {
  const contract = sceneContractOf(metadata);
  return contract ? { sceneKind: contract.kind, ...(contract.documentSetting ? { sceneDocumentSetting: contract.documentSetting } : {}) } : {};
}

const extActionSources = (ext: { id: string; metadata: Record<string, unknown> }) => extWidgetContract(ext.metadata, ext.id).actionSources;

/**
 * The key prefix of a contribution's texts (D551): `<module>.dashboardWidget.<contribution key>`; a contribution without a key (none
 * today) by its widget type.
 */
const extLabelPrefix = (ext: { id: string; moduleId: string; key?: string | null; metadata: Record<string, unknown> }): string =>
  widgetLabelKey(ext.moduleId, ext.key ?? String(ext.metadata.type ?? ext.id));

/**
 * A `dashboard:widget` contribution as a catalog entry. `text` gives its name, its settings' texts, its data slots' and its events' labels
 * in the viewer's language (D551; `metadata.labelKey` may name the name's key); English as declared by default.
 */
export const toExtDescriptor = (ext: {
  id: string; moduleId: string; order: number; key?: string | null; metadata: Record<string, unknown>;
}, text: LabelText = englishLabels): WidgetDescriptor => ({
  ref: `ext:${ext.id}`,
  key: String(ext.metadata.type ?? ext.id),
  name: typeof ext.metadata.label === 'string' && ext.metadata.label
    ? text(explicitLabelKey(ext.metadata.labelKey, ext.moduleId) ?? extLabelPrefix(ext), ext.metadata.label)
    : String(ext.metadata.type ?? ext.id),
  ...(ext.metadata.category ? {} : shelfOf(ext.moduleId, text)),
  componentId: ext.id,
  moduleId: ext.moduleId,
  renderTier: 'component',
  origin: 'extension',
  visibility: 'TENANT',
  category: ext.metadata.category ? String(ext.metadata.category) : undefined,
  icon: ext.metadata.icon ? String(ext.metadata.icon) : null,
  w: SIZE_W[(ext.metadata.size as keyof typeof SIZE_W) ?? 'medium'] ?? 6,
  defaultH: SIZE_H[(ext.metadata.size as keyof typeof SIZE_H) ?? 'medium'] ?? 6,
  order: ext.order,
  // A contribution may declare its own settings schema, default props and data
  // slots in `metadata` (15.4b), so a contributed widget is configurable and
  // bindable like a builtin. Anything that is not an object is ignored.
  ...(isPlainObject(ext.metadata.schema) ? { schema: localizeFields(ext.metadata.schema, extLabelPrefix(ext), text) } : {}),
  ...(isPlainObject(ext.metadata.defaultProps) ? { defaultProps: ext.metadata.defaultProps } : {}),
  ...(Array.isArray(ext.metadata.dataSpec) ? {
    dataSpec: (text === englishLabels
      ? ext.metadata.dataSpec
      : localizeSlots(ext.metadata.dataSpec as Array<{ key: string; label: string }>, extLabelPrefix(ext), text)) as WidgetDescriptor['dataSpec'],
  } : {}),
  ...(extActionSources(ext).length > 0 ? { actionSources: text === englishLabels ? extActionSources(ext) : localizeActions(extActionSources(ext), extLabelPrefix(ext), text) } : {}),
  displaySafe: ext.metadata.displaySafe === true,
  ...sceneOfMetadata(ext.metadata),
});

/**
 * The modules whose dictionaries name the catalogue's widgets (D551): the dashboard (its builtins), every module that declares a manifest
 * widget or contributes a `dashboard:widget`. What `contributedLabelTexts` loads for a route that answers a person.
 */
export function widgetLabelModules(): string[] {
  return [...new Set(['dashboard',
    ...moduleRegistry.getWidgets({}).map((w) => w.moduleId),
    ...moduleRegistry.getComponentExtensions('dashboard:widget', {}).map((e) => e.moduleId)])];
}

/**
 * The widgets a caller may actually see on a workspace dashboard.
 *
 * Widget selection is done HERE, on the server, and not in the browser — which is
 * the whole point of this function. `useWidgets` called `getWidgets` without a
 * permission set, and `matchesFilter` only gates on permissions when the caller
 * passes one, so every widget's declared `permissions[]` was inert. The set cannot
 * be assembled client-side: there is no permission context in the tree and no
 * endpoint that reports a caller's effective permissions.
 *
 * Only the DISTINCT permissions across candidate widgets are evaluated (eight
 * widgets are five distinct ids today), and `grantedPermissions` applies both the
 * catalog's role floor and the PDP — see its comment for why either alone is wrong.
 */
export async function resolveWorkspaceWidgets(args: {
  request: NextRequest;
  tenantId: string;
  session: SubjectSource;
  workspace?: string;
  /**
   * Faz 9, dilim 9.4: the add-widget drawer's library view for a MODULE's own
   * board. Deliberately handled here rather than folded into
   * `resolveModuleWidgets` — that function is K13's narrower "what a module's
   * board shows before anyone has customised it" (manifest widgets + one
   * countable summary card, `dashboard:widget` contributions excluded on
   * purpose). This is "what can be ADDED", the same broader manifest +
   * contributed union a workspace board's picker already offers, just matched
   * on `moduleId` instead of `workspace`. Ignored when `workspace` is set.
   */
  moduleId?: string;
  scope?: ModuleScope;
  enabledIds?: Set<string>;
  /** D551: the names and texts in the viewer's language (a route that answers a person); English as declared by default. */
  labels?: LabelText;
}): Promise<WidgetDescriptor[]> {
  const { request, tenantId, session, workspace, moduleId, scope, enabledIds, labels = englishLabels } = args;
  const candidates = [
    ...moduleRegistry.getWidgets({ enabledIds, scope, workspace }),
    ...moduleRegistry.getComponentExtensions('dashboard:widget', { enabledIds, scope }),
  ];
  if (candidates.length === 0) return [];

  const granted = await grantedPermissions({
    request,
    tenantId,
    session,
    permissionIds: candidates.flatMap((w) => w.permissions),
  });

  const manifestWidgets = moduleRegistry
    .getWidgets({ enabledIds, scope, workspace, permissions: [...granted] })
    // `moduleId` only takes over when there is no `workspace` to filter by — a
    // caller sends one or the other, never both.
    .filter((w) => workspace || !moduleId || w.moduleId === moduleId || w.workspace === UNIVERSAL_WORKSPACE)
    .map((w) => toDescriptor(w, labels));

  // Third source: satellites contributing into a dashboard they do not own. Same
  // filter, so enabled-module and permission gating are identical to the manifest
  // path; the workspace match is on `metadata` because a contribution has no
  // first-class workspace column.
  const contributed = moduleRegistry
    .getComponentExtensions('dashboard:widget', { enabledIds, scope, permissions: [...granted] })
    .filter((e) => !workspace || e.metadata.workspace === workspace || e.metadata.workspace === '*')
    .filter((e) => workspace || !moduleId || e.moduleId === moduleId || e.metadata.workspace === '*')
    .map((e) => toExtDescriptor(e, labels));

  return [...manifestWidgets, ...contributed].sort((a, b) => a.order - b.order);
}

/**
 * The widgets a caller may actually see on a MODULE's own board (Faz 9, K13).
 *
 * Two kinds, both implicit until someone customises: the module's own
 * manifest widgets — filtered by `moduleId`, not `workspace`, because a
 * module's board is not tied to any one workspace — and, when the module
 * publishes a `dashboard:countable` contribution, ONE "at a glance" card
 * pre-filtered to its own keys. The card's `keys` filter travels in
 * `defaultProps` rather than a placement's `settings` (which only exists once
 * someone has actually placed something): `widget-grid.component.tsx` merges
 * `defaultProps` under `instance?.settings`, so this descriptor renders
 * correctly filtered whether or not this board has ever been customised —
 * the same descriptor a "Customise" would materialize into a real placement.
 *
 * `dashboard:widget` contributions are deliberately NOT included here (unlike
 * `resolveWorkspaceWidgets`): K13 names only manifest widgets and the
 * countable card. A satellite wanting into a module's board is a real
 * extension of this seam for later, not silently inherited from the
 * workspace path.
 */
export async function resolveModuleWidgets(args: {
  request: NextRequest;
  tenantId: string;
  session: SubjectSource;
  moduleId: string;
  scope?: ModuleScope;
  enabledIds?: Set<string>;
  /** D551: the names in the viewer's language; English as declared by default. */
  labels?: LabelText;
}): Promise<WidgetDescriptor[]> {
  const { request, tenantId, session, moduleId, scope, enabledIds, labels = englishLabels } = args;
  const all = moduleRegistry.getWidgets({ enabledIds, scope });
  const own = all.filter((w) => w.moduleId === moduleId);

  const granted = own.length
    ? await grantedPermissions({ request, tenantId, session, permissionIds: own.flatMap((w) => w.permissions) })
    : new Set<string>();
  const manifestWidgets = moduleRegistry
    .getWidgets({ enabledIds, scope, permissions: [...granted] })
    .filter((w) => w.moduleId === moduleId)
    .map((w) => toDescriptor(w, labels))
    .sort((a, b) => a.order - b.order);

  // Imported lazily so a module with no countable contribution — most of them
  // — never pulls in `getEnabledModuleIds`'s DataSource, and a unit test for
  // the manifest-only half of this function never boots env (the same reason
  // `resolvePlacedWidgets` below imports `widget.crud.service` lazily).
  const { countableKeysForModule } = await import('./entity-count.source');
  const keys = await countableKeysForModule(tenantId, moduleId);
  if (keys.length === 0) return manifestWidgets;

  // The summary card is `dashboard`'s own `entity-counts` widget, the same one
  // `board-templates.ts`'s sections place (`VALUE_CHAIN_WIDGET_REF`) — found
  // by id rather than hardcoding its componentId/order/size a second time.
  const summaryBase = all.find((w) => w.id === 'entity-counts');
  if (!summaryBase) return manifestWidgets; // degrade — the dashboard module itself is what would have to be disabled for this

  const summaryGranted = summaryBase.permissions.length
    ? await grantedPermissions({ request, tenantId, session, permissionIds: summaryBase.permissions })
    : new Set<string>();
  if (summaryBase.permissions.some((p) => !summaryGranted.has(p))) return manifestWidgets;

  const base = toDescriptor(summaryBase, labels);
  // its title is the widget's own name ("At a glance"), in the viewer's language when the board was read for one
  const summary: WidgetDescriptor = {
    ...base,
    defaultProps: { keys, title: labels === englishLabels ? 'At a glance' : base.name },
  };
  return [...manifestWidgets, summary];
}

/**
 * Resolve the widget refs PLACED on a surface into renderable descriptors, keeping
 * only what this caller may see.
 *
 * The permission check happens here and not only when a widget is placed, because
 * placement and viewing are different moments: a board is shared, roles change,
 * and a module can be disabled long after someone dropped its widget onto a page.
 * A ref that no longer resolves — module uninstalled, widget renamed, permission
 * revoked — is dropped from the payload rather than erroring, so one dead
 * placement degrades to a gap instead of taking the board down with it.
 *
 * `db:` refs resolve to nothing today; tenant-authored definitions arrive in
 * phase 3 and this is the single place that has to learn about them.
 */
export async function resolvePlacedWidgets(args: {
  request: NextRequest;
  tenantId: string;
  session: SubjectSource;
  userId: string;
  refs: string[];
  scope?: ModuleScope;
  enabledIds?: Set<string>;
  /**
   * `dashboard:widget_kinds`: also resolve a placement of a kind whose module is off for the tenant, flagged `unavailable`
   * (the board's own read, which draws it inert, and a placement create, which then answers 422 `WIDGET_KIND_UNAVAILABLE`).
   * Every other caller (queries, export, duplicate, import, templates) leaves it out: to them the widget is not there.
   */
  includeUnavailable?: boolean;
  /** D551: the names and texts in the viewer's language (the board's own read); English as declared by default. */
  labels?: LabelText;
}): Promise<Map<string, WidgetDescriptor>> {
  const { request, tenantId, session, userId, refs, scope, enabledIds, includeUnavailable = false, labels = englishLabels } = args;
  const out = new Map<string, WidgetDescriptor>();

  // ── manifest widgets: the module registry plus a permission check ──────────
  const wanted = new Set(refs.filter((r) => r.startsWith('manifest:')).map((r) => r.slice('manifest:'.length)));
  if (wanted.size > 0) {
    const candidates = moduleRegistry.getWidgets({ enabledIds, scope }).filter((w) => wanted.has(w.id));
    if (candidates.length > 0) {
      const granted = await grantedPermissions({
        request, tenantId, session,
        permissionIds: candidates.flatMap((w) => w.permissions),
      });
      for (const descriptor of moduleRegistry
        .getWidgets({ enabledIds, scope, permissions: [...granted] })
        .filter((w) => wanted.has(w.id))
        .map((w) => toDescriptor(w, labels))) {
        out.set(descriptor.ref, descriptor);
      }
    }
  }

  // ── contributed (`dashboard:widget`) widgets: same gates as the picker ─────
  // Placed refs used to resolve to nothing, so a saved board lost every
  // contributed widget on reload (15.4b). Enabled-module and permission gating are
  // identical to `resolveWorkspaceWidgets`.
  const wantedExt = new Set(refs.filter((r) => r.startsWith('ext:')).map((r) => r.slice('ext:'.length)));
  if (wantedExt.size > 0) {
    const extCandidates = moduleRegistry.getComponentExtensions('dashboard:widget', { enabledIds, scope })
      .filter((e) => wantedExt.has(e.id));
    if (extCandidates.length > 0) {
      const granted = await grantedPermissions({
        request, tenantId, session,
        permissionIds: extCandidates.flatMap((e) => e.permissions ?? []),
      });
      for (const e of moduleRegistry
        .getComponentExtensions('dashboard:widget', { enabledIds, scope, permissions: [...granted] })
        .filter((x) => wantedExt.has(x.id))) {
        const d = toExtDescriptor(e, labels);
        out.set(d.ref, d);
      }
    }
  }

  // ── tenant-authored definitions ───────────────────────────────────────────
  // Visibility does the gating here rather than the permission catalog: a
  // definition is a tenant's own row, and `list` already excludes someone else's
  // private widget. Only PUBLISHED rows resolve — a draft on a live board would
  // defeat the point of having a publish step.
  const dbIds = refs.filter((r) => r.startsWith('db:')).map((r) => r.slice('db:'.length));
  if (dbIds.length > 0) {
    // Imported lazily so a board of manifest-only widgets never pulls a DataSource
    // (and, in a unit test, never boots env) to answer a question about code.
    const { default: DashboardWidgetService } = await import('./widget.crud.service');
    const { default: DashboardWidgetPublishingService } = await import('./widget.publishing.service');
    const { rendersOnBoards } = await import('./widget-snapshot');
    // Kinds of a group that is off for this tenant are still resolved, flagged `unavailable`: the placement is kept and
    // renders inert instead of vanishing (`dashboard:widget_kinds`).
    const live = (await DashboardWidgetService.list(tenantId, { userId }, { includeUnavailable: true })).filter(rendersOnBoards);
    const blocked = await blockedKindTypes(tenantId);
    const rows = await DashboardWidgetPublishingService.overlayPublished(tenantId, live);
    const byId = new Map(rows.map((row) => [row.widgetId, row]));

    // A marketplace-materialized widget carries `moduleId: 'dashboard'`, so the
    // enabled-module filter cannot see the LISTING behind it — pausing a plugin
    // would have left its widget rendering on every board it was on. Ask the
    // module that owns the install markers, and drop rows whose listing is not
    // active; the row itself stays, so reactivating brings the widget straight
    // back to the boards it was already on.
    const paused = new Set<string>();
    const listingIds = dbIds
      .map((id) => byId.get(id))
      .filter((row) => row?.source === 'marketplace' && row.listingId)
      .map((row) => row!.listingId as string);
    if (listingIds.length > 0) {
      const active = await activeListingIds(tenantId, listingIds);
      for (const [id, row] of byId) {
        if (row.source === 'marketplace' && row.listingId && !active.has(row.listingId)) paused.add(id);
      }
    }

    // A tier-3 widget frames third-party UI that can call the plugin's own API
    // through the host. Someone who may not invoke plugins should not be handed
    // the frame at all — placement and viewing are both authorization decisions
    // (POSTURE §4), and this reuses the permission that already guards that RPC
    // route rather than inventing a second allowlist to drift from it.
    const framed = dbIds.some((id) => byId.get(id)?.renderTier === 'iframe');
    const mayFrame = framed
      ? (await grantedPermissions({
          request, tenantId, session, permissionIds: ['marketplace.plugins.invoke'],
        })).has('marketplace.plugins.invoke')
      : false;

    // Custom role keys in an `allowedRoles` match only roles the tenant still has active: read once, only when needed.
    const placedRows = dbIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const activeCustomKeys = (session.tenantMember?.roleKeys?.length && needsCustomRoles(placedRows))
      ? await activeCustomRoleKeys(tenantId)
      : undefined;

    const sceneOfKind = new Map<string, Promise<SceneContract | undefined>>();
    for (const id of dbIds) {
      const row = byId.get(id);
      if (!row || paused.has(id)) continue;
      if (row.renderTier === 'iframe' && !mayFrame) continue;
      // `allowedRoles` (owner decision 2026-10-16): a widget outside the caller's roles neither renders nor places,
      // and its placements' data routes answer like a hidden widget's.
      if (!widgetAllowsMember(row, session.tenantMember, activeCustomKeys)) continue;
      const kind = kindTypeOf(row);
      // a builtin kind that draws a scene bound to its page's subject says so through its group (`dashboard:widget_kinds`, phase 42.5)
      const contract = kind && !blocked.has(kind) ? await (sceneOfKind.get(kind) ?? sceneOfKind.set(kind, builtinSceneContract(tenantId, kind)).get(kind)!) : undefined;
      const descriptor = {
        ...toDbDescriptor(row, labels),
        ...(contract ? { sceneKind: contract.kind, ...(contract.documentSetting ? { sceneDocumentSetting: contract.documentSetting } : {}) } : {}),
      };
      if (kind && blocked.has(kind)) {
        if (includeUnavailable) out.set(`db:${id}`, { ...descriptor, unavailable: true });
        continue;
      }
      out.set(`db:${id}`, descriptor);
    }
  }

  return out;
}

/** What a pinned placement renders with instead of its widget's latest published definition (7b). */
export type PinnedDefinition = Pick<WidgetDescriptor, 'schema' | 'defaultProps' | 'template' | 'dataSpec' | 'settingsTemplate' | 'settingsMigrations'>;

const pickPinned = (d: Record<string, unknown>): PinnedDefinition => ({
  schema: d.schema as PinnedDefinition['schema'],
  defaultProps: d.defaultProps as PinnedDefinition['defaultProps'],
  template: d.template as PinnedDefinition['template'],
  dataSpec: (d.dataSpec ?? null) as PinnedDefinition['dataSpec'],
  settingsTemplate: (d.settingsTemplate ?? null) as PinnedDefinition['settingsTemplate'],
  settingsMigrations: (d.settingsMigrations ?? null) as PinnedDefinition['settingsMigrations'],
});

/**
 * The definitions pinned placements render with (7b), keyed `<ref>@<version>`. Only a placement whose
 * `db:` ref is already in `resolved` (so it passed every visibility, permission, role and
 * `rendersOnBoards` gate for this viewer) and is not a platform row is looked up, in one query scoped
 * to the caller's tenant; a pin naming a version that is gone gets no entry and renders the latest
 * one. Each entry carries only the definition fields above, never the snapshot's ownership or ids.
 */
export async function resolvePinnedDefinitions(
  tenantId: string,
  instances: Array<{ widgetRef: string; pinnedVersion?: number | null }>,
  resolved: Map<string, WidgetDescriptor>,
): Promise<Record<string, PinnedDefinition>> {
  const pins: Array<{ widgetId: string; version: number }> = [];
  for (const i of instances) {
    if (i.pinnedVersion == null || !i.widgetRef.startsWith('db:')) continue;
    const d = resolved.get(i.widgetRef);
    if (!d || d.isSystem) continue;
    pins.push({ widgetId: i.widgetRef.slice('db:'.length), version: i.pinnedVersion });
  }
  if (pins.length === 0) return {};
  const { default: DashboardWidgetPublishingService } = await import('./widget.publishing.service');
  const { applyPinnedSnapshot } = await import('./widget-snapshot');
  const snapshots = await DashboardWidgetPublishingService.pinnedSnapshots(tenantId, pins);
  const out: Record<string, PinnedDefinition> = {};
  for (const { widgetId, version } of pins) {
    const snapshot = snapshots.get(`${widgetId}@${version}`);
    const ref = `db:${widgetId}`;
    if (!snapshot) continue;
    out[`${ref}@${version}`] = pickPinned(applyPinnedSnapshot({ ...pickPinned(resolved.get(ref) as unknown as Record<string, unknown>) }, snapshot) as Record<string, unknown>);
  }
  return out;
}

// K10's placement check lives in `widget-placement.acl.ts`, kept import-light
// so a unit test can call it without booting env/db; re-exported here so every
// route that already imports this service gets it from the same place.
export { assertWidgetPlaceable } from './widget-placement.acl';
