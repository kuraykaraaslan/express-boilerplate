# Dashboard Module

The admin home screen and the widget platform behind it. `dashboard` owns `/admin`
and answers **which contributed widgets a given caller may actually see**.

It is **Platform Core**, a sibling of `app_shell`: a composition surface every
workspace consumes and none owns. It is not Content (it authors no public pages)
and not Data (it owns no metrics — it reads other modules'). The audit's §5 domain
map predates it; the placement argument is in
[`docs/phases/07-dashboard/00-master-plan.md`](../../docs/phases/07-dashboard/00-master-plan.md) §A.5.

Forward roadmap: [`docs/phases/07-dashboard/`](../../docs/phases/07-dashboard/). Phases 2–7 add
boards, widget definitions, the three render tiers and the data-source seam; this
README describes what exists **today**.

---

## What it does today

- Serves `/admin`, the workspace-scoped dashboard, taken over from `common` (audit
  MIS-02: `common` is primitives only).
- Resolves the widget list for a workspace **on the server**, permission-filtered.
- Saved **boards**: add, remove, reorder and resize widgets, with per-placement
  title and refresh settings, shared or personal.
- Renders each widget in its own Suspense + error boundary, so one slow or broken
  module cannot block or crash the board; a card that fails while it draws keeps
  its cell with its title and "Failed to load" (`FailedWidgetCard`), for every
  viewer, in view mode and on the editor's canvas (phase 52.3, UI test 3 #2).
  That card is the widget kit's `FailedPlacementCard` in the kit's words
  (`dashboard.kit.card.failed*`, phase 52.10.2, D597); a builtin card's kit
  `PlacementCard` is told `isolate={false}`, so its failure reaches the grid's
  slot boundary, which reports it, as every other tier's does.
- A **widget library**: browse system, tenant and personal widgets, star them,
  and author tenant-owned widgets with a draft → published → archived lifecycle
  and version history.
- Falls back to the built-in overview (stat cards + recent activity) when a
  workspace has no board and contributes no widgets the caller may see.

## Render tiers

| Tier | What | How |
|---|---|---|
| `component` | first-party React from a module manifest | the generated lazy component map |
| `template` | tenant-authored HTML with `{{token}}` interpolation | an **opaque-origin** iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) loading the `…/dashboard/frame` shell, which carries the frame's own CSP |
| `iframe` | third-party bundle | `plugin_runtime`'s `PluginFrame`, reused as-is (separate origin, message auth on origin AND source window) |

Tier 2 reuses only the *substitution* half of `dynamic_page`'s template renderer.
Its delivery is deliberately different: dp writes into the host tree and injects
the block's `script` on the page, which on `/admin` would let a widget author run
code inside every admin's authenticated session. See [`POSTURE.md`](POSTURE.md).

## Where a widget can come from

Three origins, one prefixed namespace, so placing / favouriting / counting never
branches on which kind it is:

| ref | Origin | Declared as |
|---|---|---|
| `manifest:<id>` | a module's own `module.json` `widgets[]` | build time |
| `ext:<contributionId>` | a satellite contributing into a dashboard it does not own, via `dashboard:widget` | build time |
| `db:<uuid>` | tenant-authored, materialized from a marketplace listing, or **published by the platform** (the builtin data widgets, read through from the root tenant) | runtime |

`workspace: '*'` on a manifest widget means every workspace — that is how the
launcher and the counts appear on boards no module contributes to. Omitting
`workspace` entirely leaves a widget unreachable, deliberately: making absence
mean "everywhere" would turn a typo into a silent seventeen-workspace broadcast.

Third-party path: [`docs/marketplace-widget-seam.md`](docs/marketplace-widget-seam.md).
A paused listing's widget stops resolving without being deleted, so reactivating
puts it back on the boards it was already on.

## Column parity with `dynamic_page_blocks`

Thirteen columns share byte-identical names. The tables are **not** merged — the
60% test was computed and the union came out at 48%, below the AGENTS.md §10.1
bar — but the shared half is the same concept, so a future merge stays a rename.
`server/tests/column-parity.test.ts` fails if either side drifts.

## Entities

| Entity | Table | Description |
|---|---|---|
| `DashboardBoard` | `dashboard_boards` | A named arrangement: `slug`, `title`, `workspace`, `scope` (`TENANT`\|`PRIVATE`) + `ownerUserId`, `isDefault`, `gridCols`, `revision`. Unique `(tenantId, slug)`; one default per `(tenant, workspace, owner)` via a partial index. |
| `DashboardWidgetInstance` | `dashboard_widget_instances` | One widget placed on one surface: the `entityType`/`entityId` seam, a prefixed `widgetRef`, geometry, `settings`, `dataBinding`, `actions`, `title`, `refreshSeconds`, `pinnedVersion`. |
| `DashboardWidget` | `dashboard_widgets` | A tenant-authored definition: `type`, `label`, `category`, `schema`, `defaultProps`, `template`, `renderTier`, `visibility` + `ownerUserId`, `status`, `publishedVersion`, marketplace provenance. Unique `(tenantId, type)`. |
| `DashboardWidgetVersion` | `dashboard_widget_versions` | Immutable snapshot per publish. A pinned placement renders the snapshot it names, so a new version cannot silently rewrite boards. |
| `DashboardWidgetFavorite` | `dashboard_widget_favorites` | One person's starred widgets, keyed by the same prefixed `widgetRef`. |
| `DashboardDisplayLink` | `dashboard_display_links` | A display link (decision 2026-10-17 #10): the SHA-256 of its token (never the token), a hint, a label, the board, the issuer, expiry, revocation, last use. Migration `008`, tenant RLS. |

There is deliberately **no SYSTEM scope** and no nullable `tenantId`: rows live in
per-tenant databases, so a null-tenant row would be invisible from a tenant's own
connection, and `hasTenantId` is what marketplace's data-deletion map reads to know
a table is tenant-scoped. What the platform publishes instead is **read through**
from the root tenant (`server/widget.root-catalog.ts`, owner decision D1): a
tenant's own row always answers first, so a copy somebody edited is never shadowed
by the shared one.

## Builtin data widgets

`server/widget.builtin-catalog.ts` is the platform's own catalogue of bindable
widgets — charts (line, bar, area, pie / donut, scatter, histogram, heatmap), data cards (stat, stat with
trend, attributes, progress, state, gauge, table, activity feed, map), content (text/markdown, image, quick links,
embed) and controls — published
into the root tenant on **every deploy**: `server/dashboard.post-deploy.ts` is a
`db:post_deploy` step that `deployDatabase` (`npm run db:deploy`, the `migrate`
image, the demo reset) runs after the migrations, so no installation needs a manual
step (owner decision 22, 2026-10-18). Seeding the root tenant does the same write,
and `npm run dashboard:publish-widgets` stays for an operator who wants it now,
without a deploy. Idempotent: it upserts on `type` in one root-tenant transaction,
never touches `widgetId`, skips a row that already matches the code (a deploy that
changed no definition writes nothing, `updatedAt` included), never bumps
`publishedVersion` or `revision`, and reads no tenant's row, so a tenant's own copy
of a builtin type is left alone; republishing an improved definition leaves every
board that already carries one intact. The deploy step does not bust the Redis
catalogue cache (`dash:rootwidgets:v1`, no Redis client in the deploy), so a changed
definition reaches tenants within that cache's 5-minute TTL; the manual script busts it.

They are rows rather than `module.json` widgets because a manifest widget takes no
binding: it has no `dataSpec` for `instance.crud.service.ts` to check slot names
against, and a chart is precisely the widget that knows how to draw a series and
nothing about which one. The component itself is still code — the row names a
`componentId` that resolves in a FIXED first-party map
(`ui/data-widgets/builtin-widgets.ts`), never in the generated module component
map, so a `componentId` nobody shipped resolves to nothing. The authoring DTOs stay
`.strict()` with no such field, which is what keeps a tenant from naming one.

## Widget categories

`dashboard_widgets.category` holds a key of the category registry (`server/widget-category.ts`): the core
**Charts**, **Data**, **Content**, **Controls**, plus categories contributed through the `dashboard:widget_category`
extension point by the module that owns the widgets (enabled modules only). Creating a widget, or changing its
category, is validated against the registry (422); a stored value outside it stays readable (`General` shows as
Content, anything else under **Other**). The picker's tabs follow the registry order. Plan:
[`docs/phases/07-dashboard/14`](../../docs/phases/07-dashboard/14-widget-catalog-and-categories.md).

Content widgets author-supply strings, so they never build HTML: `content.markdown` renders a parsed node tree,
links / images pass a scheme allow-list, and `content.embed` is a https-only, private-host-refusing, opaque-origin
sandboxed frame (details in phase 14) that frames only the sites the tenant lists under **Dashboard Settings**
(`/admin/dashboards/settings`, setting `dashboardEmbedHosts`: one hostname per line, `*.example.com` for
subdomains; empty, the default, allows none). Cards read the list from `GET …/api/dashboard/embed-hosts` and frame
nothing until it arrives; a placement save that points a card at an unlisted site is a 422.

## The surface seam

`entityType`/`entityId` — the `EntityRef` spelling fixed by
`common.crm-contracts.ts`. Today the only value is `'DASHBOARD'` pointing at a
board; a report, portal page or kiosk screen can host the same widget later
without this module learning those exist. It is a bare label plus a bare uuid with
**no foreign key**, which is also why deleting a board removes its placements by
an explicit query — the database has nothing to cascade along.

`widgetRef` is prefixed (`manifest:<id>` today, `db:<uuid>` from phase 3) rather
than two nullable id columns with a CHECK between them: one column, no uuid
pointing at a table that does not exist yet, and nothing to migrate when the
second kind arrives.

## Migrating without losing anything

A workspace dashboard is **implicit** until someone edits it — no rows, and the
page renders whatever the manifests contribute. Pressing *Customise* materialises
a board from the widgets that caller can currently see, in the order and at the
widths already on screen. A tenant that never presses it keeps the pre-boards
behaviour with zero rows written.

## Giving a module its own dashboard

A board's anchor is one of two closed, already-known vocabularies — `workspace`
or `moduleId` (never both; a database CHECK enforces it, migration `095`) — not
the polymorphic `entityType`/`entityId` seam above, because neither one is a
surface this module has never heard of. Faz 9, K7/K13.

Nothing is required to get one: `/admin/dashboards/module/<moduleId>` renders
for any active module, the same implicit-until-customised board a workspace
gets. Its starting content (`resolveModuleWidgets`, K13) is the module's own
`widgets[]` — workspace-independent, unlike the workspace path — plus, if the
module also publishes a `dashboard:countable` contribution, one "At a glance"
summary card pre-filtered to its own keys. A module with neither renders an
empty shell rather than 404ing; disabling the module 404s the route instead
(K15) without deleting anything it may already have saved.

**Reaching it (K14).** The hub's own "Modules" tab lists every module with
implicit or saved content, no module-side work needed. A module that wants a
direct link adds one line to its own `menu[]` — no import of `dashboard`, no
`requires` edge:

```json
{ "id": "crm-opportunity-board", "label": "Dashboard", "href": "/admin/dashboards/module/crm_opportunity", "icon": "fas fa-gauge", "group": "CRM", "workspace": "crm", "order": 50, "scope": "tenant" }
```

**A starting layout (optional).** `board-templates.ts`'s `BoardTemplate.anchor`
takes `moduleId` exactly like it takes `workspace` — `pipeline-overview`
(anchored to `crm_opportunity`) is the first registered example. A template is
still code, not tenant-authored (same reasoning as the workspace ones above):
name the module's own `dashboard:countable` keys in a section, and
`templatesForModule(moduleId)` picks it up for that module's "start from a
template" prompt automatically.

## Why the resolve endpoint exists

Widgets are declared in `module.json` `widgets[]` with a `permissions[]` array.
Until this module, that array was **inert**: `useWidgets` called
`moduleRegistry.getWidgets({ enabledIds, scope, workspace })` without a permission
set, and `matchesFilter` only gates on permissions when the caller passes one. So
`hr.self.read` and friends were declared and never enforced at selection time.

The set cannot be assembled in the browser — there is no permission context in the
tree, and no endpoint reports a caller's effective permissions. So selection moved
to the server. The permission answer itself lives in `auth_abac`
(`grantedPermissions`), not here: it applies both the catalog's coarse role floor
**and** the PDP, because neither alone is right. `can()` deliberately permits an
unseeded permission so adding one cannot lock a tenant out — correct for migration
safety, wrong for "should this widget be in the payload".

> The same defect exists on the sidebar menu (`getMenuItems` is also called without
> `permissions`). That is `app_shell`'s to fix, with the same helper.

---

## HTTP surface

| Route | Who | What |
|---|---|---|
| `GET …/api/dashboard/embed-hosts` | `dashboard.boards.read` | The sites an embed card may frame (the tenant's `dashboardEmbedHosts`, parsed) |
| `GET …/api/dashboard/frame` | `dashboard.boards.read` | The shell a template widget's iframe loads, with the frame's own CSP |
| `GET …/api/dashboard/widgets/resolve?workspace=<id>` | `dashboard.boards.read` | The widgets this caller may see on that workspace dashboard |
| `GET …/api/dashboard/workspaces/[workspace]/board` | `dashboard.boards.read` | The default board for a workspace, or `null` |
| `POST …/api/dashboard/workspaces/[workspace]/board` | `dashboard.boards.write` | Start customising: create + seed the board (idempotent) |
| `GET \| POST …/api/dashboard/boards` | read / write | List or create boards |
| `GET \| PATCH \| DELETE …/api/dashboard/boards/[boardId]` | read / write | A board with its placements and resolved widgets; `GET ?include=overlays,commands,embedHosts,aliasEntities` adds, under `included`, what a view opening it would ask those routes for, each part checked as its route checks it and absent when refused (phase 40, D40-12) |
| `GET \| PUT \| POST \| DELETE …/api/dashboard/scene-bindings` | read / write (+ the kind's) | Phase 42 (D42-9): which document a subject (device, asset) shows and which device is which, one row per subject, slot and kind. `GET ?subjectType=&subjectId=[&slot=&kind=]` or `?kind=&documentId=` ("who uses this document"); `PUT` saves a row whole (`expectedRevision`, 409), `DELETE` resets it; `POST` (phase 47.1, D106) adds a NEW view without a slot: the server stores it in the next free slot of that subject and kind (`main` while free, then `view_2`, `view_3` …, a taken one skipped, under an allocation lock so concurrent creates never collide; at most 50 per subject and kind, 422), 201 with the binding. A slot is the row key only: no screen a customer reaches shows or asks for one. The route's static permission is the board's read / write; inside the service the kind's `readPermission` / `writePermission` (from `dashboard:scene_kind`) and the subject type's read permission are asked as well, the subject, the document and every device must exist in the tenant, and every write is audited (`dashboard.scene_binding.set` / `.reset`) |
| `GET …/api/dashboard/scene-bindings/resolve?subjectType=&subjectId=&kind=[&slot=&cardDefault=true]` | `dashboard.boards.read` (+ the kind's and the subject type's) | `{ rung, binding?, document?, focusRole?, view? }` (`document` = `{ id, name, hash }` of the document the binding names, null when it is gone: the card compares `hash` with the binding's `documentHash`, TK-6), rung one of `subject`, `ancestor`, `single-device`, `card-default`, `placeholder` (D42-5). The topology walk is made for a device (the assets above it) and an asset (the assets above it AND the devices under it): an asset with no row answers with its single device's row, else the nearest ancestor asset's row (a floor or a room under a bound building, D42-6), else a placeholder. `view` (42.4.1) is what the card looks at: the subject's own stored `view`, or, at rung `ancestor`, the `{ level, focus }` derived from the assets between the answering row and the subject (`deriveView`, `scene-binding.view.ts`: a code that is a key of kind `level` / `room` of the document; two of one kind in the path are ambiguous and left out) |
| `GET \| POST …/api/dashboard/scene-bindings/bulk` | read / write (+ the kind's, + the device type's read) | Phase 42.3.2, the bulk action of D42-7: `POST { subjectType: 'iot_device', profileId, kind, slot?, documentId, mapFrom?: 'identity' \| 'twin-index' }` binds every device of the profile that has NO binding for (slot, kind) to the document (the device in the main role, revision 1, the caller as creator), never overwriting a row, never writing a profile-level default, at most 500 devices per call (by name; `truncated` says there are more), in chunks of 100 each in its own transaction, audited ONCE per call (`dashboard.scene_binding.bulk`, with the counts); `{ bound, skipped, truncated }`. `twin-index` maps an item the document labels with an element's name to that element (for a design without keys). `GET ?profileId=&kind=[&slot=]` answers `{ devices, unbound, total, truncated }` for the drawer |
| `GET …/api/dashboard/scene-bindings/documents?kind=[&search=&limit=]` | `dashboard.boards.read` (+ the kind's read) | Phase 42.2.3: the documents of a scene kind for the Scene drawer, `{ documents: [{ id, name, updatedAt?, usedBy }], total, truncated }`, by name, at most 100. The documents come through the kind (`dashboard:scene_kind` `list`); `usedBy` is one grouped count over the binding index, counted only over the subject types the caller may read |
| `GET …/api/dashboard/scene-bindings/document-keys?kind=&documentId=` | `dashboard.boards.read` (+ the kind's read) | Phase 42.2.3: the keys of one document, `{ keys: [{ key, label, kind, catalogue? }], truncated, hash }`, at most 2 000 (`keysOf` of the kind), `hash` the document's current fingerprint (null: none); a document that does not exist in the tenant is a 422 |
| `GET …/api/dashboard/scene-bindings/slots?kind=` or `?subjectType=&subjectId=[&kind=]` | `dashboard.boards.read` (+ the kind's read, + the subject type's read) | Phase 47 (views by name): the options of a card's "Which view" setting (a `remote-select`, value `slot`, label `label`). `?kind=`: the slots the kind's bindings use in the tenant, `main` first and always there, `{ slots: [{ slot, label }] }`, each named by its place ("First 3D view", "3D view 2") and the drawings it holds, the most used first (counted only over the subject types the caller may read). `?subjectType=&subjectId=`: ONE subject's views, `{ views: [{ slot, kind, documentId, documentName, status, name, label }], slots: [{ slot, label }] }` (`name` the drawing's name with its "(2)"), the label "3D view · Pool plant" with "(2)" for a second view whose label would read the same, one drawing twice or two drawings of one name (phase 52.3, UI test 3 #34) (with `kind`, `main` is offered when the subject has none yet). `&slot=` (with `kind`, review R47-3): the view the card stores, listed last in words when the answer would not hold it ("3D view · not set up on this device", tenant-wide "… not set up anywhere"), so a card's picker never shows a slot. Labels in the app's language (`dashboard.sceneViews.*`) |
| `GET …/api/dashboard/scene-bindings/placements?subjectType=&subjectId=&kind=[&slot=]` | `dashboard.boards.read` (+ the kind's and the subject type's read) | Phase 48.3: where one view of a subject is shown, `{ shown, fixed, fixedBoards }`: the boards the caller may open that show it in a card of the kind (a card whose `points` slot names the device, or a card on a page about one subject of a board that lists the subject's subtype; a following card only in the view's slot), how many keep a picture of their own (`picture: 'own'`), and their titles while at most three. A card that follows whatever device its address names on a board that lists no subtype cannot be counted and is left out (`scene-binding.placements.ts`) |
| `POST …/api/dashboard/boards/[boardId]/instances` | `dashboard.boards.write` | Place a widget (re-checks the placer may see it) |
| `PUT …/api/dashboard/boards/[boardId]/layout` | `dashboard.boards.write` | Commit the whole board's geometry in one transaction |
| `POST …/api/dashboard/boards/[boardId]/snapshots` | `dashboard.boards.write` (+ the board's write rule) | Discard in Customise: the caller's copy of the board (content, cards, card overlays) taken when Customise starts; their copies from other tabs stay (at most 5 per person and board, the oldest goes), copies older than a day go |
| `GET \| DELETE …/api/dashboard/boards/[boardId]/snapshots/[snapshotId]` | `dashboard.boards.write` | The change count since the caller's copy and someone else's change meanwhile (who, when); or drop the copy (Done) |
| `POST …/api/dashboard/boards/[boardId]/restore` | `dashboard.boards.write` (+ the board's write rule) | Discard: the copy put back in one transaction under the board lock; someone else's change since is a 409 (`changedBy`, `changedByLabel`, `changedAt`) unless `overwrite`, which runs the command authoring gates on the cards it writes back |
| `PATCH \| DELETE …/api/dashboard/instances/[instanceId]` | `dashboard.boards.write` | Settings/geometry, or remove a placement |
| `GET \| POST …/api/dashboard/widgets` | read / `dashboard.widgets.author` | The library (manifest + authored + favourites), or author one |
| `GET \| PATCH \| DELETE …/api/dashboard/widgets/[widgetId]` | read / author | A definition with versions and legal next actions |
| `POST …/api/dashboard/widgets/[widgetId]/transition` | `dashboard.widgets.publish` | publish \| unpublish \| archive \| restore |
| `PUT \| DELETE …/api/dashboard/widgets/[widgetId]/favorite` | `dashboard.boards.read` | Star / unstar for the caller |
| `GET …/api/dashboard/boards/[boardId]/export` | `dashboard.boards.read` | The board as a package file (`?report=1` for `{ package, skipped }`) |
| `POST …/api/dashboard/boards/import` | `dashboard.boards.write` (+ `manage` for a shared board) | Import a package: a dry run by default, `dryRun: false` creates the board |
| `GET …/api/dashboard/landing` | `dashboard.boards.read` | The board this caller lands on at the admin home (their personal default of the standalone boards, else the tenant's), or `null` |
| `POST …/api/dashboard/query` | `dashboard.query.execute` + the query's own permission | The free-form runner: `(sourceKey, queryKey, params)` from the caller, authorised per caller; kept for the transient template render and the editor preview |
| `POST …/api/dashboard/boards/[boardId]/instances/[instanceId]/query` | `dashboard.boards.read` + `dashboard.query.execute` | Runs one SLOT of a stored placement from its saved binding: the body is only `{ slot, window?, params?, paging? }`, so a client cannot name a source or a query (the normal render path uses it) |
| `GET \| POST …/api/dashboard/boards/[boardId]/display-links` | `dashboard.boards.manage` | A shared board's display links, or mint one (the token and URL are in this answer only) |
| `DELETE …/api/dashboard/boards/[boardId]/display-links/[linkId]` | `dashboard.boards.manage` | Revoke a display link |
| `GET …/api/dashboard/display/board` | GUEST `dashboard.display.view` + the display token | The board a display link shows: its display-safe cards only (see "Display links") |
| `POST …/api/dashboard/display/query-batch` | GUEST `dashboard.display.view` + the display token | The cards' data, as the link's issuer, stored bindings only |
| `GET …/api/dashboard/display/frame` | GUEST `dashboard.display.view` | The template frame shell for a screen (no data, no token) |
| `GET …/api/dashboard/compute-frame` | `dashboard.boards.read` | The compute shell a board view's hidden iframe loads (35.5): one classic Worker per placement script, under the frame's own CSP (`worker-src blob:`, `connect-src 'none'`) |
| `GET …/api/dashboard/display/compute-frame` | GUEST `dashboard.display.view` | The same compute shell for a screen (no data, no token) |

Placement is an **authorization decision**, not just a write: a widget is
re-resolved for the placer before it is stored, so nobody can place a widget they
may not see and read its data through a board they then share.

## The widget editor

`/admin/dashboards/widgets/[widgetId]` — header, live preview, generated
settings, four tabs.

**The preview is the real renderer.** It goes through `WidgetTemplateFrame`, the
same sandboxed frame (no `allow-same-origin`, the frame's own CSP) a board uses. An editor
that previews through a different path lies about what will ship, and here the
difference between the two paths is a security boundary.

**The settings panel is generated from the widget's own schema** by the same
`SchemaForm` a placement uses — the plan's "a developer does not also have to
write a settings UI" promise, and the only honest preview of what an operator
will get. *Use these as defaults* writes what is on screen into `defaultProps`.

**Tabs.** `TEMPLATE` is a plain textarea (Monaco deferred); on a `component` or
`iframe` widget it says so instead, because those are rendered by code we ship.
`SCHEMA` edits the field map, and deleting a field takes its `defaultProps`
entry with it — a default for a field nobody can set is a value an operator can
never change. `DATA` edits the abstract slots (max 6): a slot says what the
widget NEEDS, never where it comes from, which is what lets one widget serve
two boards reading different data.

The widget-editor `ACTIONS` tab is **read-only** — actions are per-*placement*
config, so there is nothing on the widget row to edit. The editable surface is
the **placement drawer** ("When this card is clicked"), which writes
`instances.actions`.

`instances.actions` holds the closed action kinds and the v2 sources described in the
**Actions** section below (eleven kinds, several triggers per placement) — each a handler the
host runs, the `dynamic_page` `INTERACTION_ACTIONS` precedent. The config is validated
server-side; execution is host-side for every tier. A tenant-authored template frame calls
`window.widgetAction()` (or clicks a `[data-widget-action]` element) and posts a
**payload-free** message — the host runs the action the board editor configured, and the
frame never names a destination. `POSTURE.md` §8 has the security argument. Only
`setVariable` and `openDialog` from the spec's list are still deferred.

**Saving.** Debounced autosave into the DRAFT row, plus `Ctrl+S`. Every write
carries `expectedRevision`: two tabs open on one widget is the ordinary case,
and without it the second save silently discards the first. A conflict is
surfaced even on an autosave — an author has to know their draft is behind
rather than keep typing into a version that cannot be written.

The revision is checked on the **locked** row, in the same transaction as the
write and the bump — for widgets (update, publish, transitions) and for boards
(board edits, and the layout PUT via `DashboardBoardService.saveLayout`, which
moves every card and bumps the revision atomically). Before, the check ran on an
unlocked read, so two saves carrying the same revision could both pass. Card
PATCHes write only the fields they name, so they never undo a concurrent
layout save.

**Discard in Customise** (owner 2026-10-27). Customise saves every change as it is confirmed, so Discard is a server-side
restore (`board-snapshot.service.ts`): the editor takes a copy of the board when Customise starts
(`dashboard_board_snapshots`, migration 017), Discard is offered once the board's revision on screen has moved since
Customise started or a card's "Only <subject>" settings were saved or reset, asks through the ConfirmDialog with the number
of changes (none: it says so and writes nothing), and puts the board's content, cards and card overlays back in one
transaction under the board's row lock. Sharing, home and default, slug and anchor are not part of it. A card whose library
widget was deleted meanwhile stays out (`skipped`, said after the restore). Every card and overlay write marks the board's
copies held by other people on its own transaction, and every revision bump does too (`markSnapshotsChanged`, under the
copies' advisory lock `holdSnapshots`, which a restore takes before it reads its copy), so a restore over someone else's
change is a 409 naming them; the editor then offers to keep the board as it is or to overwrite their change too. Each tab's
Customise keeps its own copy. **Deploy:** migration 017 must run before this code serves requests (NB's deploy migrates
before it switches the release): every board save marks the copies, so without the table every board save fails, not only
Discard.

Undo/redo is a local snapshot stack (`Ctrl+Z` / `Ctrl+Shift+Z`), not shared
editing history — one author edits one widget, and the alignment table says
Yjs is not what that needs. Transition buttons are rendered from
`availableActions`, so the header cannot offer a move the state machine would
refuse.

## Import / export

`GET|POST …/api/dashboard/widgets/transfer` moves widgets between tenants, with
`dynamic_page`'s block transfer as the model — `overwrite`/skip, a type
collision refused by name, and a system row an import can never touch.

**Whose widgets move.** The export carries the shared library plus the caller's own `PRIVATE`
widgets; another member's private widget is not read at all. An overwrite import never rewrites
another member's private widget (it is skipped as "type taken"). Imported rows are shared, so
they spend the tenant's custom-widget plan limit like the create route: rows past the headroom are
skipped with the limit reason. One `dashboard.widget.import` audit row records each applying import.

**The settings template line (2026-10-18, decision 7a).** A widget that has been published exports
its PUBLISHED definition (the version snapshot, deprecation markers included) with its `tenant:<type>`
template line (`settingsTemplate`, `settingsMigrations`); draft edits since the last publish do not
travel, and a never-published widget exports its draft with no line. On import the line is parsed
strictly (`server/tenant-template.schema.ts`: size and version caps, contiguous steps, the declarative
ops only, no `__proto__`/`constructor`/`prototype` or `$` keys; an invalid line skips the widget; a
publish runs the same parser on the line it writes and the widget DTO refuses those field keys, so a
line this app writes always imports), re-keyed to
`tenant:<type>`, and the first publish in the target keeps its version. An overwrite takes the line
only when the target was never published; otherwise the target keeps its own and the answer's
`notes` says so.

**Two budgets.** The plan limit counts shared (`TENANT`) widgets only. A member's `PRIVATE`
widgets count against their own total under the same limit, so members filling their private
libraries cannot lock an admin out of the tenant's shared one; moving a widget between the two
visibilities needs room in the target budget. The route's check is the fast refusal; the create re-counts
under a per-tenant advisory lock (`dashboard:widget-quota:<tenant>`, boards: `lockBoards`), so two creates at the
last free slot cannot both land. Widget create, update, delete, publish and the other
transitions write `dashboard.widget.*` audit rows.

**Only `template` widgets travel, and that is the design rather than a
limitation.** A `component` widget IS its `componentId` — a pointer at
first-party code the target tenant may not have installed — and a `frame`
widget IS its `frameListingId`, which is `marketplace`'s to move, not ours.
Neither field is carried, so exporting such a row would produce a package that
imports into a widget pointing at nothing. They are skipped at export and the
response **names them**: an operator restoring a backup needs to know what was
never in it.

Also left behind: `ownerUserId` (a person in the source tenant),
`source`/`listingId`/`listingVersion` (provenance is re-derived where it lands),
`revision`/`publishedVersion` (a history the target does not have), and
`status` — **an import always arrives DRAFT**, because putting live content on
somebody else's dashboard has to be a decision made in the target tenant.

`defaultW`/`defaultH` DO travel, beyond the plan's field list: a widget landing
at the wrong size is a broken import and the two numbers carry no tenant
coupling.

`overwrite` defaults to **false**, unlike the block importer. A widget holds a
tenant's own template and schema work, and the safe direction for a destructive
default is to refuse and report — the operator re-runs with the flag once they
have read the skip list.

Every entry is validated through the **same `CreateWidgetDTO`** a hand-authored
widget goes through, which is what stops a package naming a `componentId` and
mounting arbitrary shipped code.

### Board package (phase 19)

`GET …/api/dashboard/boards/[boardId]/export` returns one JSON document (`format:
"dashboard-board-package"`, `packageVersion: 1`, `server/board-package.ts`): the board's title,
description, icon, window and parameters; each placement's geometry, title, refresh interval,
settings, bindings and actions; and per placement a widget **reference** by kind and key
(`manifest` and `ext` by id, `builtin` and `tenant` by `type`). It carries no tenant id, user id,
board id, scope, anchor or revision, and no widget definition (a tenant-authored one travels
through the widget transfer above). `references` lists what the package points at but cannot
carry: boards an `openBoard` action opens, command keys and data source keys, so an importer can
name the gaps. A placement whose widget the exporter cannot resolve is left out and reported in
`skipped`: an export never reveals a widget its exporter may not open. The same rules as opening
the board apply (someone else's private board is a 404).

`POST …/api/dashboard/boards/import` takes `{ package, dryRun?, title?, scope? }`. The package is
parsed strictly (`BoardPackageSchema`) and then believed for nothing: each widget is looked up again
in the importing tenant by kind and key and gated exactly like a manual placement
(`resolvePlacedWidgets`, `server/board-package.env.ts`); a definition is never created from a package,
and the importing tenant must already have a `tenant` widget of that type. The plan
(`server/board-package.import.ts`, pure) decides what is created: a placement whose widget is
missing, or private on a shared board, is **skipped and named**; a slot the widget does not declare, a
data source this tenant does not have, a `$param` to a parameter the board does not define, an
`openBoard` to a board that does not exist here and a command the importer could not author are
**repaired** (dropped, and reported) so the rest of the card still imports; settings the widget schema
refuses are dropped. The dry run (the default) returns that report and writes nothing; `dryRun: false`
runs the same plan through `DashboardBoardPackageService`, which creates a plain, non-default,
unanchored board (personal unless the caller holds `dashboard.boards.manage` and asks for `TENANT`)
and its placements through the normal services, and removes the board again if a placement is
refused. The board limit applies and the import is audited as `dashboard.board.import`.

### Contributed widgets: data and actions (phases 18.2, 16.9)

A `dashboard:widget` contribution declares its contract in `metadata`: `schema` (settings),
`defaultProps`, `dataSpec` (slots, optionally `repeatable`) and `actionSources`
(`[{ name, label?, row? }]`). The server reads it from the build-time registry (`server/ext-widget.ts`),
never from a request: a placement may only bind slots the contribution declares, its settings are
validated against the declared schema, and entries stored under `<type>.<name>` must be declared
sources (`row: true` is the only case where `{ $row }` is accepted). A widget that declares slots or
sources is rendered with the same runtime as a builtin and receives `data`, `settings`, `loading`,
`placement`, `rowActions`, `paging`, `actionSources` and `fireAction(name, { row? })`. `fireAction` runs
the placement's authored entries for that source; the widget never names a destination or an action,
only a source and, for a `row: true` source, a row it already holds. A command entry is never run from
a widget event. A component deeper in the widget's tree reaches the same function through
`useFireAction()` (and the declared list through `useActionSources()`) from
`@kuraykaraaslan-labs/dashboard/ui/fire-action.context`, without threading the prop; outside a
placement that declares sources it returns `undefined`.

## Board window, parameters, live data, controls and contributed templates (phases 10–13)

- **Board window and params** (`server/board-window.ts`). `dashboard_boards.timeWindow` / `.params` (schema-sync columns,
  CHECKs in `server/migrations/001_board_window_params.sql`). A query opts in with `window: 'board'`; a slot value may be
  `{ "$param": key }`. The viewer's choice lives in the URL (`?tw=7d&p.site=…`), "Save as default" is writers-only.
  Queries without `window: 'board'` keep a byte-identical cache key.
- **Query cache identity** (`server/data-source.validate.ts`, `server/query-runner.ts`). `ctx.userId` and `ctx.locale` are
  watched getters: a query that reads the user under tenant `cacheScope`, or the locale without `cacheByLocale: true`, is
  answered live and not cached. `cacheByLocale: true` keys the entry per (sanitised) locale. A cache hit of the wrong
  shape is a miss.
- **Live queries** (`server/live.*.ts`, `realtime-namespace.ts`, `ui/board-live-connection.tsx`). A query declares
  `live: { topics, merge }`; `POST /api/dashboard/live-ticket` authorises it, the `/dashboard` namespace pushes deltas,
  one socket per board; without a gateway the widget polls. First proof: analytics `events_last_hour`. The socket stays
  for the board view's life (phase 40.4, D40-4 / D40-5): a page switch, a frame's new context or a card added re-tickets
  it in place (`ticket:replace`, the gateway's `websocket.ticket-replace.ts`; the slots hear their new answer once the
  gateway acked), and so does an unchanged set about a minute before the 15 minute re-authorisation (`sessionExpiresIn`
  on the ticket answer), so nothing re-queries but a card whose answer changed (an alias that names another device now,
  a device the viewer may no longer read). A replace the gateway paces (`rate_limited`, `busy`) keeps the socket and is
  asked again after the reconnect backoff; a new socket only when there is none or a replace was refused as
  `unauthorized` or not answered.
- **Entity slots and parameters (phases 36, 41, 49a)**. A query's entity slot takes any entity parameter of the board, resolved as the
  slot takes it (`alias-resolver.ts` `forSlot`): an entity of another kind hands the slot what it holds through every active
  `dashboard:entity_relations` contribution (CONTAINS, every level; a site for a slot of devices, D112), a slot of many takes them all,
  a slot of one takes the one when exactly one is there, else a 422 "<site> holds N devices; pick one" (`details.messageKey`, the card
  and the drawer say it in the viewer's language); the same one-of-many rule holds for a parameter of many (AD-12); a command stays
  strict. `POST /api/dashboard/aliases/preview` reads the open page as a card query reads it (its values `params` and the bar picks
  `aliasEntities`), says which followed parameter has no value (`waitingFor`) and what a card of one entity gets (`single`), and with
  `key` + `slot` (+ the reference's `boardFilter`) answers a board parameter in a card's slot. A
  query param's `entityKeys` hint (`common/server/schema-form.types.ts`) makes the drawer pick a comma list of an entity type's keys by
  name (`GET …/entity-types/<key>/keys?subtype=`). A single entity slot that a page-set parameter of its own entity type can fill offers
  "The <parameter> this page shows" first, above "A <kind> chosen here" (run 3 #9, #52, D541; `ui/page-entity-choice.component.tsx`),
  stored as `{ $param }` (D41-7); a new card is not filled by default, and a command parameter is not offered it (owner questions).
- **Generic widgets**: `gauge`, `heatmap`, `state`, `map` and four `control.*` widgets, all lazy builtins; charts render through the
  vendored kui-react Chart (`common/ui/kui/chart`; line and area use its time axis with viewer-local zoom). View mode renders the free-grid geometry the editor saved.
- **Commands** (`dashboard:command`, `server/command.*.ts`): see `POSTURE.md` §9. A typed confirmation asks for `typedConfirmText`
  (`server/command.types.ts`: the command's `confirmText`, else its label, else its key), one rule for the server's check, the catalogue
  and every dialog, so the phrase is one a person can read (41-ui-fixes/18 1.4). A run waits at most 30 s for its answer; what a run says
  (`ui/command-outcome.ts`: a reply as text, a queued request as waiting, a cancelled prompt as nothing, no answer as unknown; a
  refusal in the viewer's language: the dashboard's own, else the provider's `<module>.error.<details.reason>` key (the module is the
  command key's first segment), else a sentence for the status, with the provider's English detail only for an English reader; a
  catalogue still loading or failed is not "not allowed") is shared by controls, row commands and a widget kind's runtime
  (41-ui-fixes/18 decision (d), C4, C5). Under a command parameter the editor says where its names come from (run 3 #35, D543): the
  parameter's `description`, and what its `remote-select` list answers beside its rows, `description` (in the viewer's language) and
  `manageLink { href, label }` (an app path, opened in a new tab; any other link is ignored, `ui/command-field-help.ts`). The dashboard
  never names who answers them.
- **Contributed board templates** (`dashboard:board_template`, `server/board-template.*.ts`): placements with geometry,
  bindings, window and params; `builtin:<type>` names a platform builtin; `BoardView` can render one transiently
  (`anchor: { kind: 'template', id }`) with no board row.
- **Widget-kind seams** (tasks 28.1 and 28.3, [`docs/phases/07-dashboard/28-dashboard-scada-module.md`](../../docs/phases/07-dashboard/28-dashboard-scada-module.md)):
  the process diagram lives in the add-on module [`dashboard_scada`](../dashboard_scada/) (edition `iot`); it reaches the dashboard through six
  points, and the dashboard names none of its kinds and never imports it (`server/tests/dashboard.scada-boundary.test.ts`; the 3D model widget is the
  second add-on module, [`dashboard_viewer`](../dashboard_viewer/), task 29, same mechanism). The widget kit
  tags a builtin kind with an optional product `group` (`scada.symbol`, `scada.scene`: `scada`; `viewer.model`: `viewer`); `dashboard:widget_kinds`
  (`server/widget-kind-groups.ts`) makes a grouped kind available only while an ACTIVE contributor of that group (contribution `key` = the
  group id) exists for the tenant. Module off, not licensed, or not in the build: the kinds leave the picker, a placement create/update,
  a preset and its publish are a 422 `WIDGET_KIND_UNAVAILABLE`, and a stored placement stays and draws the inert "not available" card; a kind
  without a group is never gated. The contribution's metadata is documentation only (`category`, optional `types`), except for the scene a kind of the group
  draws (phase 42.5, D42-12: `sceneType`, `sceneKind`, `sceneDocumentSetting`, `sceneOwnedSettings`, the keys an `ext:` widget declares it with, read by
  `builtinSceneContract`): a placed card of that kind is resolved at board open like an `ext:` widget's (its descriptor carries `sceneKind`), and the overlay
  write path (and a snapshot restore) refuses the owned settings.
  `dashboard:element_actions` (`server/element-actions.registry.ts`) is the per-widget-type provider of commands on element gestures
  (`allowsCommands`, `validateEntries`, `keepsEntries`, `hasElement`, `confirmFloor`, `auditFields`, the optional `elementSettings` (phase 42.5: the settings the three element checks read, when the card's elements come from a stored document), and the optional `authoringPermission`: the permission a caller needs to add or change a command entry, asked by the placement save for the caller `{ authoring }` the routes pass, `element-authoring.ts`); the DTO keeps the shape checks, the gates
  of the command path stay here. `dashboard:placement_editor` (`ui/placement-editor.registry.ts`) is the client side: a full-screen editor
  (settings drawer, customise mode) that edits its own copy of the settings and the actions draft and hands both back on Apply (nothing reaches
  the host before, 41-ui-fixes/18 1.1), the element sources the drawer edits (with "Run a command" offered only to a member the catalogue's
  `elementAuthoring` allows, 3.3), and a `runtime` hook `BuiltinPlacement` calls (element actions, the pending/failed overlay, a dialog, the
  scene patch with that overlay, and the `settings` the card draws instead of its own, phase 42.5). `dashboard:kit_runtime` (`ui/kit-runtime.registry.ts`, phase 31, C3) is the kit's on-demand code: a
  contribution's `() => import()` loaders by the kit's own key and the lock state of the kit's options; every kit host (`useKitHost`) installs
  those of the modules active for the tenant into `common/ui/kui/widget-kit/kit-runtime.ts` and removes the others', so a tenant without the
  module never downloads that code (the process symbols' pack files are loaded this way); a lock may carry `title`, `offer` (a "Get ..." link)
  and `picture` (the kit key of static pictures drawn instead of a locked option's own drawing), and a kit part that shows locks says so
  (`wantKitOptionLocks`). The settings drawer shows, under a builtin kind's form, each picked option of a picture-card select that is locked,
  why, and the lock's link (`LockedPicksNotice`, `common/ui/kui/widget-kit/views/LockedOption.tsx`): the card itself is the form's radio
  button, so it carries no link. `dashboard:placement_guard` (`server/placement-guard.ts`, phase 31, C4) is the server side of the locks: a guard
  pattern point whose contributions list the builtin kinds they guard (`metadata.types`) and are asked, after template validation, on every
  write that stores a kind's settings (placement create and update, `createMany` for a template apply and an import, `materialize`, a board
  copy, a preset's create, defaults edit and publish) with the kind's effective settings before and after (a preset placement's with the
  defaults of the version it draws: the pinned one, else the published one, never the live draft). A guard's refusal is a 422
  `placement_guard_refused` that the board copy rethrows instead of copying the card as stored; a guard that cannot answer is a 503, nothing
  is stored. What stays named here on purpose: the kit's component table, the core category `Process & SCADA` and the
  kit's own card texts (`dashboard.kit.scada.*`), owner decision 29. The dashboard's tests use stand-ins for the contributions
  (`server/tests/element-actions.fixtures.ts`, `ui/tests/placement-editor.fixtures.tsx`) and pass with the module absent.

## Actions, drill-down, presentation (phases 15 to 20)

What a card does and how a board is read, in the order a viewer meets them. Each item names the file that owns it; the phase files in
[`docs/phases/07-dashboard/`](../../docs/phases/07-dashboard/) hold the reasoning and the dated record.

- **Actions** (`server/instance-actions.ts`, `ui/widget-actions.ts`). A placement stores `actions` as the legacy `{ onClick }` or v2
  `{ v: 2, sources: { <source>: [entry] } }`; everything reads it through one normaliser. Sources: `cardClick`, `click` (a control),
  `headerButton`, `rowClick`, `rowDoubleClick`, `cellClick`, `actionCellButton`, `markerClick`, `elementClick`, and a contributed
  widget's own `<type>.<name>`. The action set is closed: `navigate`, `openUrl`, `refreshWidget`, `refreshBoard`, `command`,
  `setParams`, `openBoard`, `openPage` (another in-board page of the same board, D-1 (a)), `copyToClipboard`, `showNotification`, `back` (up the drill-down trail, `levels` or `toRoot`). A row source may
  use `{ $row: column }` (never a template frame, never the legacy shape); a `command` is never run from a row, element or header button.
  A navigate path, an openUrl URL (after the host only) and a message may carry `{{param_<key>}}` and, on a row source, `{{row_<column>}}`;
  `navigate` takes `newTab`. Any entry can carry a one-parameter show condition (`when`), honoured on every source except the card click
  (`cardClick`, where it is refused); on a control's `click` it is the disabled getter (the control is disabled while it does not hold). A
  `control.button` runs any action kind on a press, not only a command (`controlClick`). Every source holds several
  entries, run in stored order; the drawer edits them as lists, the card click of a card that is not a control included
  (decision 2026-10-17 #3). A `control.button`'s own click may carry
  `pressedWhen`, a condition of the same kind: the button is a toggle, drawn pressed and announced `aria-pressed` while
  it holds (decision 2026-10-17 #4). A card click never runs a command: the write schema refuses one there and the reader skips a
  stored one, because a command runs from a control, behind its confirmation. A header button can
  carry an icon. A contributed widget fires its declared sources through the `fireAction` prop or `useFireAction()`
  (`ui/fire-action.context`). `[text](action:id)` in a markdown card is a click target for the `elementClick` entry with that id.
- **Drill-down** (`ui/board-view-state.ts`, `ui/board-trail.component.tsx`). `openBoard` opens another board with `p.*` parameters
  preselected; the boards the viewer came through ride in `?trail=` (validated, titles read from the access-checked board list) and show as
  a breadcrumb. A board or card title may use `{{param_<key>}}`, shown as the parameter's label (an entity's name) or value.
- **In-board pages** (`server/board-pages.ts`, migrations `007` and `009`; phase 29: `docs/phases/07-dashboard/29`). A board may have
  up to 20 pages after its main one (`mainPage` names it). The page button next to the board title opens the page menu
  (`ui/board-page-menu.component.tsx`, `P`); the Pages window (`ui/board-pages-modal.component.tsx`) sets each page's title, icon,
  start page, whether it is in the menu (a detail page is not), its inputs (board params it works on, `*` = needed) and how an action
  opens it (page, side panel, dialog, popover). `?pg=<key>` (`~` = the main page) is the base page; `openPage` opens a page OVER the
  one the card is on as a frame (`f1`..`f8` in the URL, pushed to the history; values inherit down the stack). Each open page renders
  inside `FrameScope` (`ui/board-frame.component.tsx`), which re-provides the query context and the board nav with that frame's
  values, so widgets need no change; the batcher already sends one request per frame and the live ticket carries every frame's
  context on one socket. The state is a Zustand store per board view (`ui/board-nav.store.ts`, `ui/use-board-navigation.ts`,
  pure operations in `ui/board-nav-state.ts`). A card sits on one page (`pageKey`, null = main). A page that holds cards or that an
  action opens cannot be removed (409); an `openPage` that leaves a needed input without a value is refused (422). The display-token
  page keeps the old tabs (`ui/board-page-tabs.component.tsx`) for the menu pages.
- **Time zone** (D-11). A window that names no zone runs in the viewer's browser zone (`viewerTimezone` in the board context), not UTC.
- **Widget roles**. A tenant widget's `allowedRoles` (empty = everyone; built-in role or custom role key) decides who may place
  and see it (`server/widget-roles.acl.ts`).
- **Parameters** (`server/board-window.ts`). Up to 16; types text, number, select, multi-select, remote-select, boolean and date (a real
  `YYYY-MM-DD`). A `remote-select` with `searchKey` (and `lookupKey`) is a searchable entity picker that shows labels, not ids; both keys are
  NB-local pending kui-react. "Promote to a dashboard parameter" turns a bound query parameter into a board parameter. The filter bar folds
  and remembers it per board in the browser.
- **Data** (`server/query-runner.ts`, `server/query-paging.ts`, `server/slot-key.ts`, `server/ext-widget.ts`). One runner behind two routes
  (see the HTTP table). A table query may declare `paging` (page, sort, search validated against its declaration, a bounded answer with
  `total`; a paged query is never live, so it polls even if it also declares `live`); the sample source's `sample.paged_rows` is a 10,000-row demo of it. A slot may be `repeatable` (extra sources under `<slot>#2` to `#8`); chart series can carry a label, colour, unit and decimals,
  and units reach the axis and tooltip on both the time and band axes. A value's meta (`server/column-meta.ts`) may also declare the range the
  value takes (`min` / `max`, finite, dropped when empty): the gauge takes it as its default scale (the kit's `scaleFields`; the card's own
  min / max, a preset's and a bound min / max slot still win), and a value off the scale is marked "Above the scale" / "Below the scale", with
  a hint to set the scale while the board is edited and the value is far off it (e2e run 3 item 110, D554). The dashboard only passes the range
  on; a source fills it. A contributed widget declares `schema`, `dataSpec` and
  `actionSources` in its contribution metadata and is bound and validated against that.
- **Boards as files** (`server/board-package*.ts`). Export, import with a dry run and repairs, and duplicate a card: see "Board package".
- **Card menu** (`ui/card-menu.tsx`, phase 42.2.3a). A "⋯" menu at a board card's corner, below the expand control, that a widget fills from its own component with `useCardMenuEntry({ id, label, icon?, order?, onSelect })` (the entry lives while the component is mounted, so the widget decides when it is offered). One entry per `id` (the card's copy in the expand dialog neither doubles nor removes it), no button without an entry, none on a display screen. The design card's "Set up scene…" was its first user; since phase 46.3 the scene cards offer "Open <name>'s views" there (the subject's Views, `scene-subject-link.ts`).
- **The one card rule on a card's face** (phase 48.2, `ui/scene-card-chrome.component.tsx`). A scene card whose Picture is its own (`picture: 'own'`) on a page about a subject says "Fixed picture · <name>" (`FixedPictureLabel`; the 2D card in its header through `PlacementRuntime.fixedPicture`, the 3D card over its corner) with "Follow the device's view instead" for a viewer who may write the board: the board view hands each card of a writable board a settings writer (`BoardCardScope.patchSettings`, `useCardSettingsPatch`, the ordinary placement save with its revision lock; never in customise mode or on a display screen) and the click sets the Picture back to following, with an Undo. A following card with nothing to draw for its subject names the subject's view page (`SceneSetupLink`, `ui/scene-subject-link.ts`: a device's Scene tab, a site's drawer).
- **Presentation.** A board fullscreen overlay (Escape leaves; `?fs=1` opens it that way), a per-card expand dialog, a time zone per window
  (the chart axis follows an explicitly chosen zone only), and a landing board: the default of the standalone boards, personal first
  (`GET …/dashboard/landing`, "Make my home" in the hub, `?home=workspace` to bypass).
- **Display links** (decision 2026-10-17 #10; `server/display-*.ts`, `ui/display-*.tsx`). A shared board on a screen nobody signs in
  to: "Display links…" in the board menu (`dashboard.boards.manage`) mints a link (label, 1 to 365 days) and shows its address once;
  `/display#<token>` renders the board read-only, with no admin chrome, and stops for good on a revoked, expired or refused link.
  The token is in the URL fragment (decision 2026-10-18 #19), so it never reaches the server, a proxy log or a `Referer`: the page
  reads it, removes it from the address bar (`history.replaceState`, kept in `sessionStorage` for the tab's reloads) and sends it in
  the `X-Display-Token` header, never a query string (a request carrying a token-shaped query value is refused). Links minted
  before #19 have it in the path, `/display/<token>`, which keeps working until they expire, its page sending the token the same way.
  The link acts as the member who created it, capped by that member on every request (an engineering reading the owner may
  reverse; `POSTURE.md` §13). Only display-safe cards render (db: builtins and templates, `ext:` widgets declaring
  `metadata.displaySafe: true`); there is no live data on a screen (cards poll), controls are inert and parameter titles show raw
  values. Both pages are module `appRoutes` pages, so `/display` shadows a CMS slug `display` or `display/…`, the same trade as
  form_builder's `/s/`.
- **Not built, with the reason in the phase files:** a domain entity provider.

## Compute scripts (phase 35.5, ADR-0017)

A placement may carry a `transform` (`server/transform.dto.ts`, migration 011): `{ v: 1, enabled, script, timeoutMs?, onError }`,
an ES module whose default export is a pure, synchronous function `({ slots, params, window, now }) → { slots }` that derives what
the card draws (any of its slots, replaced; the rest stay as loaded) from the data it loaded, the effective board parameters, the
window the data ran with and the clock. It only derives: there is no message by which it can set a parameter, run a command or
open a page (`POSTURE.md` §14, decision E1).

- **Where it runs.** `BoardView` and the display screen mount one hidden, opaque-origin iframe (`ui/compute-host.tsx`) that loads
  the compute shell (`server/compute-shell.ts`, served by `GET …/compute-frame` and `…/display/compute-frame`) under its own CSP;
  the shell makes a classic Worker per placement from one Blob (the script's one `export default` bound in a strict scope, then the runner), runs it per input under
  `timeoutMs` (10 to 500, default 50) and terminates it on overrun. The host authenticates the frame by source, coalesces runs
  (one in flight per card, the latest input wins, 20 a second at most) and never runs for a card that is not shown.
- **What comes back.** `server/transform-output.ts` validates every result like a source's answer: `{ slots? }` only, each slot
  a `DataSourceResult` shape, strict, capped (5 000 rows, 64 columns, 10 KiB per string, 2 MiB in all). `ui/use-transform.ts`
  lays the returned slots over the loaded data between `useWidgetData` and the kind's runtime in `BuiltinPlacement`; on a
  failed run the card keeps the previous output or goes empty (`onError`) and shows the error (a badge over kept output, the
  query-error state over nothing).
- **Authoring.** The drawer's Data tab has a Transform section (`ui/transform-editor.component.tsx`): the script, enabled, the
  budget, `onError`, the contract, and "Run now", which runs the draft through the view's compute frame on the card's current
  data and lists what came back per slot. The transform travels in the board package as text (`transform` on a placement; an
  import drops one over the cap and reports `transform_dropped`), is copied with a card and stays on the placement when a card
  is saved as a widget.
- **The scene patch (35.5b, E15).** A script for a `scada.scene` or `viewer.model` card may return `scene` beside its slots:
  things, per-object overrides, extra connections and zones, the view, problems (POSTURE §14). The compute host validates it
  against the card's kind (`transformOutputSchemaFor`; refused by name for any other kind), `useTransform` returns it as
  `scenePatch`, and `BuiltinPlacement` passes it to the view's `scenePatch` prop and to the kind's runtime. The NB-owned
  `sceneModel` applies it after the rules; "Run now" summarises it. The server-safe schema must agree with the kit's
  `views/scene-patch.ts` once that is vendored.

## Public API

```ts
import { resolveWorkspaceWidgets } from '@kuraykaraaslan-labs/dashboard/server/widget-catalog.service';
```

`WidgetDescriptor.ref` is prefixed (`manifest:<id>`) rather than a bare id because
the catalog is a union and will stay one: tenant-authored definitions arrive as
`db:<uuid>` in phase 3, and placing, favouriting and counting usages should never
have to branch on which kind a widget is.

`w` is a width in **12** grid columns, derived from the manifest's t-shirt `size`
(`small|medium|large|full` → `3|6|9|12`). That is the old 4-column `SIZE_SPAN`
×3 — every current layout is preserved, and phase 2's drag-resize gets a finer
unit to snap to.

## Files

| File | Purpose |
|---|---|
| `server/widget-catalog.service.ts` | The catalog union + permission-filtered resolution |
| `server/dashboard-widgets-resolve.route.ts` | The resolve endpoint |
| `ui/dashboard.page.tsx` | `/admin` — header, resolved widgets, built-in overview fallback |
| `ui/widget-grid.component.tsx` | Renders a resolved descriptor list onto the board's 12- or 24-column grid (21.10) |
| `ui/recent-activity-widget.component.tsx` | The overview's activity table |

The rest follow the dotted-suffix convention (`*.route.ts`, `*.service.ts`, `*.component.tsx`, `use-*.ts`, tests beside them in `tests/`); a file's job is its name, and the phase files say which slice added it.

## Platform-published widgets (D1)

**Platform types are reserved.** A tenant cannot create or import a widget whose `type` a platform
widget already has (409 on create; skipped and named on import, even with `overwrite`). A tenant
widget of the same type would hide the platform one from that tenant's picker, and `builtin:<type>`
refs in templates and imports are looked up by that type. Widgets a tenant already has under such a
type are left alone.

A widget the platform publishes is readable by every tenant **without a copy**.
The catalogue is read through from the root tenant (`widget.root-catalog.ts`),
the same pattern `tenant_setting` uses for platform defaults.

**Why not a seeded copy.** N tenants meant N rows and N versions: the day the
platform fixed a widget, the fix reached nobody who already had it, and nothing
could tell a stale copy from a tenant's deliberate edit. A read-through is the
only shape where "the platform improved a widget" is a thing that can happen.

**Why not a nullable `tenantId`.** Rows live in per-tenant databases, so a
null-tenant row is invisible from a tenant's own connection — and `hasTenantId`
is what marketplace's data-deletion map reads to know a table is tenant-scoped.
Breaking that is a silent KVKK debt, a far worse trade than a second read.

| rule | why |
|---|---|
| only `isSystem` + `visibility: 'TENANT'` + `status: 'PUBLISHED'` rows publish | the root tenant is also a real tenant; the operator has private boards and drafts in it |
| the ROOT tenant reads nothing through | it is the source, not a consumer — a self-fallback would double its own catalogue |
| a tenant's own row WINS on a `type` collision | a tenant that copied a platform widget and changed it must keep seeing theirs |
| an unreachable root catalogue degrades to empty | the tenant loses the shared widgets, not their own boards |
| writes are already refused | platform widgets are `isSystem`, and `assertNotSystem` guards update/delete — no new guard was needed |

The cache (`dash:rootwidgets:v1`, 300s) is dropped whenever the root tenant's own
catalogue changes.

## Dependencies

`app_shell` (active workspace), `auth_abac` (permission resolution), `common`
(registry + generated component map), `limiter`, `tenant` (root-tenant check).
